import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let leads;
let orders;
let deals;
let courseCosts;
let enrolments;
let batches;
let perf;
let perfError;
let upserts;

const chain = (rows) => { const c = { select: () => c, lean: async () => rows() }; return c; };

mock.module("../../src/models/order.model.js", { namedExports: { Order: { find: () => chain(() => orders), aggregate: async () => [] } } });
mock.module("../../src/models/crm/crmLead.model.js", { defaultExport: { find: () => chain(() => leads), aggregate: async () => [] } });
mock.module("../../src/models/crm/crmDeal.model.js", { defaultExport: { find: () => chain(() => deals), aggregate: async () => [] } });
mock.module("../../src/models/crm/crmPipeline.model.js", { defaultExport: { find: () => chain(() => []) } });
mock.module("../../src/models/crm/crmActivity.model.js", { defaultExport: { distinct: async () => [] } });
mock.module("../../src/models/crm/settlementCourseCost.model.js", {
  defaultExport: {
    find: () => chain(() => courseCosts),
    findOneAndUpdate: (filter, update) => { upserts.push({ filter, update }); return { lean: async () => ({ ...filter, ...update.$set }) }; },
  },
});
mock.module("../../src/models/batch.model.js", { defaultExport: { find: () => chain(() => batches) } });
mock.module("../../src/models/user.model.js", { namedExports: { User: { find: () => chain(() => enrolments) } } });
mock.module("../../src/services/crmLeadIntake.js", { namedExports: { AD_POOL_QUERY: {} } });
mock.module("../../src/services/metaAdInsights.js", {
  namedExports: { getAdPerformance: async () => { if (perfError) throw new Error("boom"); return perf; } },
});

const { getSettlementReport, setCourseCost, groupOf, settlementDueDate } = await import("../../src/services/settlementService.js");

const NOV = { from: "2026-11-01", to: "2026-11-30" };
const day = (d, m = "11") => new Date(`2026-${m}-${d}T06:00:00Z`);
const lead = (email, source, createdAt) => ({ _id: `lead-${email}`, email, source, createdAt });
let n = 0;
const order = (email, minor, d, extra = {}) => ({
  orderId: `o${++n}`, courseId: "101", courseInfo: { title: "Scrum Master" }, currency: "INR",
  expectedTotalMinor: minor, participants: 1, learner: { email }, paidAt: day(d).getTime(), ...extra,
});
const batchFor = (ord, endDate, status = "completed") => {
  const id = `b-${ord.orderId}`;
  enrolments.push({ orderId: ord.orderId, batchId: id });
  batches.push({ _id: id, status, endDate });
};
const run = (params, env = { SETTLEMENT_OVERHEAD_PERCENT: "10" }) => getSettlementReport(params, { env });
const row = (report, key, currency = "INR") => report.groups.find((g) => g.key === key).currencies.find((c) => c.currency === currency);

beforeEach(() => {
  leads = []; orders = []; deals = []; courseCosts = []; enrolments = []; batches = []; upserts = [];
  perf = { configured: true, currency: "INR", totals: { spend: 1000 } };
  perfError = false;
});

test("groupOf maps lead sources to ad groups", () => {
  assert.equal(groupOf({ source: "meta_ads" }), "meta");
  assert.equal(groupOf({ source: "social", utm: { utm_source: "instagram" } }), "meta");
  assert.equal(groupOf({ source: "google_ads" }), "google");
  assert.equal(groupOf({ source: "linkedin_ads" }), "linkedin");
  assert.equal(groupOf({ source: "referral" }), null);
});

test("orders are matched to ad leads by email and only count after the lead existed", async () => {
  leads = [lead("Asha@Example.com", "meta_ads", day("02")), lead("late@example.com", "meta_ads", day("20"))];
  orders = [order("asha@example.com", 500000, "10"), order("late@example.com", 300000, "10"), order("direct@example.com", 900000, "11")];
  const r = await run(NOV);
  assert.equal(row(r, "meta").collectedMinor, 500000);
  assert.equal(row(r, "meta").orders, 1);
});

test("trainer cost is the course cost per learner, counted when the batch is delivered", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02"))];
  const o = order("a@example.com", 1000000, "10", { participants: 2 });
  orders = [o];
  courseCosts = [{ courseId: "101", currency: "INR", costPerLearnerMinor: 150000 }];
  batchFor(o, day("25"));
  const r = await run(NOV);
  const m = row(r, "meta");
  assert.equal(m.costMinor, 300000);
  assert.equal(m.costLearners, 2);
  assert.equal(m.spendMinor, 100000);
  assert.equal(m.overheadMinor, 100000);
  assert.equal(m.netMinor, 1000000 - 300000 - 100000 - 100000);
  assert.equal(m.pendingLearners, 0);
  assert.deepEqual(r.totals, [{ currency: "INR", collectedMinor: 1000000, costMinor: 300000, overheadMinor: 100000, spendMinor: 100000, netMinor: 500000 }]);
  assert.equal(r.totalsComplete, true);
});

test("an order counts only after its 7-day refund window; earlier ones are holding", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02")), lead("b@example.com", "meta_ads", day("02"))];
  orders = [order("a@example.com", 500000, "22"), order("b@example.com", 300000, "28")]; // clears Nov 29 vs Dec 5
  const r = await run(NOV);
  const m = row(r, "meta");
  assert.equal(m.collectedMinor, 500000);
  assert.equal(m.orders, 1);
  assert.equal(m.holdingOrders, 1);
  assert.equal(m.holdingMinor, 300000);
  assert.ok(r.notes.some((x) => /7-day refund window/.test(x)));
});

test("an order paid at the end of the previous period clears in this one", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02", "10"))];
  const o = order("a@example.com", 400000, "02");
  o.paidAt = day("28", "10").getTime(); // paid Oct 28, clears Nov 4
  orders = [o];
  assert.equal(row(await run(NOV), "meta").collectedMinor, 400000);
});

test("without an overhead percentage, overhead and net are not calculated", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02"))];
  const o = order("a@example.com", 1000000, "10");
  orders = [o];
  courseCosts = [{ courseId: "101", currency: "INR", costPerLearnerMinor: 100000 }];
  batchFor(o, day("25"));
  const unset = await run(NOV, {});
  assert.equal(row(unset, "meta").overheadMinor, null);
  assert.equal(row(unset, "meta").netMinor, null);
  assert.equal(unset.overheadPercent, null);
  assert.ok(unset.notes.some((x) => /overhead percentage is not set/.test(x)));
  const bad = await run(NOV, { SETTLEMENT_OVERHEAD_PERCENT: "150" });
  assert.equal(row(bad, "meta").netMinor, null);
  assert.ok(bad.notes.some((x) => /not a number between 0 and 100/.test(x)));
});

test("the settlement due date is the pay day of the month after the period", async () => {
  assert.equal(settlementDueDate("2026-11-30", {}), "2026-12-10");
  assert.equal(settlementDueDate("2026-12-31", {}), "2027-01-10");
  assert.equal(settlementDueDate("2026-11-30", { SETTLEMENT_PAY_DAY: "5" }), "2026-12-05");
  assert.equal(settlementDueDate("2026-11-30", { SETTLEMENT_PAY_DAY: "40" }), "2026-12-10");
  assert.equal((await run(NOV)).settlementDueDate, "2026-12-10");
});

test("cost lands in the delivery month, not the payment month", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02", "10"))];
  const o = order("a@example.com", 800000, "05");
  o.paidAt = day("20", "10").getTime(); // paid in October
  orders = [o];
  courseCosts = [{ courseId: "101", currency: "INR", costPerLearnerMinor: 200000 }];
  batchFor(o, day("14")); // delivered in November
  const r = await run(NOV);
  const m = row(r, "meta");
  assert.equal(m.collectedMinor, 0, "paid last month");
  assert.equal(m.costMinor, 200000, "delivered this month");
});

test("learners without a delivered batch are pending, with the expected cost shown separately", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02")), lead("b@example.com", "meta_ads", day("02"))];
  const a = order("a@example.com", 500000, "10");
  const b = order("b@example.com", 500000, "11");
  orders = [a, b];
  courseCosts = [{ courseId: "101", currency: "INR", costPerLearnerMinor: 100000 }];
  batchFor(a, day("28"), "in-progress"); // not completed yet; b has no batch at all
  const r = await run(NOV);
  const m = row(r, "meta");
  assert.equal(m.costMinor, 0);
  assert.equal(m.pendingLearners, 2);
  assert.equal(m.pendingCostMinor, 200000);
  assert.ok(r.notes.some((x) => /Pending learners/.test(x)));
});

test("a delivered learner on a course with no cost set makes cost and net unknown and lists the course", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02"))];
  const o = order("a@example.com", 500000, "10");
  orders = [o];
  batchFor(o, day("25"));
  const r = await run(NOV);
  const m = row(r, "meta");
  assert.equal(m.costMinor, null);
  assert.equal(m.netMinor, null);
  assert.equal(r.totalsComplete, false);
  assert.deepEqual(r.courses.map((c) => [c.courseId, c.missing, c.costPerLearnerMinor]), [["101", true, null]]);
  assert.ok(r.notes.some((x) => /no trainer cost set/.test(x)));
});

test("when Meta spend is unavailable the Meta net is null", async () => {
  perf = { configured: false, totals: { spend: null } };
  leads = [lead("a@example.com", "meta_ads", day("02"))];
  const o = order("a@example.com", 1000000, "10");
  orders = [o];
  courseCosts = [{ courseId: "101", currency: "INR", costPerLearnerMinor: 100000 }];
  batchFor(o, day("25"));
  const r = await run(NOV);
  assert.equal(row(r, "meta").spendMinor, null);
  assert.equal(row(r, "meta").netMinor, null);
});

test("a failing Meta spend fetch does not break the report", async () => {
  perfError = true;
  leads = [lead("a@example.com", "meta_ads", day("02"))];
  orders = [order("a@example.com", 1000000, "10")];
  const r = await run(NOV);
  assert.equal(row(r, "meta").collectedMinor, 1000000);
  assert.equal(row(r, "meta").netMinor, null);
  assert.ok(r.notes.some((x) => /could not be fetched/.test(x)));
});

test("spend with no revenue shows as a loss, and other currencies are not converted", async () => {
  perf = { configured: true, currency: "AED", totals: { spend: 200 } };
  leads = [lead("a@example.com", "meta_ads", day("02"))];
  orders = [order("a@example.com", 1000000, "10")];
  const r = await run(NOV);
  assert.equal(row(r, "meta", "AED").netMinor, -20000);
  assert.equal(row(r, "meta", "INR").netMinor, null);
  assert.ok(r.notes.some((x) => /not converted/.test(x)));
});

test("Google and LinkedIn revenue is reported but has no net, so totals are incomplete", async () => {
  leads = [lead("g@example.com", "google_ads", day("02"))];
  orders = [order("g@example.com", 400000, "10")];
  const r = await run(NOV);
  assert.equal(row(r, "google").collectedMinor, 400000);
  assert.equal(row(r, "google").netMinor, null);
  assert.equal(r.totalsComplete, false);
  assert.ok(r.notes.some((x) => /Google and LinkedIn/.test(x)));
});

test("won deals are listed as booked only when the lead has no paid order", async () => {
  leads = [lead("a@example.com", "meta_ads", day("02")), lead("b@example.com", "meta_ads", day("03"))];
  orders = [order("a@example.com", 100000, "10")];
  deals = [{ value: 5000, currency: "INR" }, { value: 2500, currency: "inr" }];
  const r = await run(NOV);
  assert.deepEqual(r.bookedNotCollected, [{ currency: "INR", amountMinor: 750000, count: 2 }]);
});

test("a bad date range is rejected", async () => {
  assert.ok((await run({ from: "2026-11-30", to: "2026-11-01" })).error);
});

test("setCourseCost stores minor units per course and currency, and rejects bad input", async () => {
  const ok = await setCourseCost({ courseId: "101", currency: "inr", courseTitle: "Scrum Master", costPerLearner: "1500.5" }, "u1");
  assert.deepEqual(upserts[0].filter, { courseId: "101", currency: "INR" });
  assert.equal(upserts[0].update.$set.costPerLearnerMinor, 150050);
  assert.equal(ok.data.costPerLearnerMinor, 150050);
  assert.ok((await setCourseCost({ courseId: "", currency: "INR", costPerLearner: 1 }, "u1")).error);
  assert.ok((await setCourseCost({ courseId: "1", currency: "INRR", costPerLearner: 1 }, "u1")).error);
  assert.ok((await setCourseCost({ courseId: "1", currency: "INR", costPerLearner: -5 }, "u1")).error);
  assert.equal(upserts.length, 1);
});
