import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let orderRows;
let dealCalls;
let dealRows;
let syncedLeadIds;
let leadRows;

mock.module("../../src/models/order.model.js", {
  namedExports: { Order: { aggregate: async () => orderRows, find: () => ({}), countDocuments: async () => 0 } },
});
mock.module("../../src/models/crm/crmDeal.model.js", {
  defaultExport: {
    aggregate: async (pipeline) => { dealCalls.push(pipeline[0].$match); return dealRows.shift() || []; },
  },
});
mock.module("../../src/models/crm/crmLead.model.js", { defaultExport: { aggregate: async () => leadRows } });
mock.module("../../src/models/crm/crmPipeline.model.js", { defaultExport: { find: () => ({ select: () => ({ lean: async () => [] }) }) } });
mock.module("../../src/models/crm/crmActivity.model.js", { defaultExport: { distinct: async () => syncedLeadIds } });

const { getExecSummary, parseRange, buildFilters, mergeCurrencyRows, buildFunnel, UNAVAILABLE_METRICS } =
  await import("../../src/services/metricsService.js");

beforeEach(() => {
  orderRows = []; dealCalls = []; dealRows = []; syncedLeadIds = []; leadRows = [];
});

test("parseRange defaults to the last 30 IST days and rejects bad ranges", () => {
  const r = parseRange(undefined, "2026-11-30", new Date("2026-11-30T10:00:00Z"));
  assert.equal(r.from, "2026-11-01");
  assert.equal(r.to, "2026-11-30");
  assert.ok(parseRange("2026-12-01", "2026-11-01").error);
  assert.ok(parseRange("2024-01-01", "2026-11-01").error);
});

test("buildFilters validates the unit and supports Unassigned", () => {
  const range = parseRange("2026-11-01", "2026-11-30");
  assert.ok(buildFilters({ range, businessUnit: "retail" }).error);
  assert.deepEqual(buildFilters({ range, businessUnit: "unassigned" }).dealOpen.businessUnit, null);
  assert.equal(buildFilters({ range, businessUnit: "b2b" }).order.businessUnit, "b2b");
  assert.equal(buildFilters({ range, owner: "65f1c2a4e4b0a1b2c3d4e5f6" }).ordersApply, false);
});

test("mergeCurrencyRows sums per currency and never across currencies", () => {
  const merged = mergeCurrencyRows(
    [{ currency: "INR", amountMinor: 100 }, { currency: "USD", amountMinor: 5 }],
    [{ currency: "INR", amountMinor: 50 }]
  );
  assert.deepEqual(merged, [{ currency: "INR", amountMinor: 150 }, { currency: "USD", amountMinor: 5 }]);
});

test("summary keeps collected and booked separate and excludes order-synced deals", async () => {
  syncedLeadIds = ["lead-a"];
  orderRows = [{ _id: "INR", amountMinor: 500000, orders: 2, enrolments: 3, customers: ["a@x.com", "b@x.com", ""] }];
  dealRows = [
    [{ _id: "INR", amountMinor: 2000000, weightedMinor: 0, count: 1, companies: ["c1"] }],
    [{ _id: "INR", amountMinor: 9000000, weightedMinor: 4500000, count: 3, companies: [] }],
  ];
  leadRows = [{ total: 10, qualified: 4, won: 2, lost: 1 }];

  const s = await getExecSummary({ from: "2026-11-01", to: "2026-11-30" });

  assert.deepEqual(dealCalls[0].lead, { $nin: ["lead-a"] });
  assert.deepEqual(s.revenue.collected, [{ currency: "INR", amountMinor: 500000 }]);
  assert.deepEqual(s.revenue.booked, [{ currency: "INR", amountMinor: 2000000 }]);
  assert.deepEqual(s.revenue.combined, [{ currency: "INR", amountMinor: 2500000 }]);
  assert.deepEqual(s.pipeline.weightedValue, [{ currency: "INR", amountMinor: 4500000 }]);
  assert.equal(s.pipeline.openDeals, 3);
  assert.equal(s.customers.websiteBuyers, 2);
  assert.equal(s.enrolments.learners, 3);
  assert.equal(s.leads.conversionRate, 20);
});

test("empty data returns zeros and a null conversion rate, never invented numbers", async () => {
  const s = await getExecSummary({ from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(s.revenue.combined, []);
  assert.equal(s.leads.created, 0);
  assert.equal(s.leads.conversionRate, null);
  assert.ok(s.unavailable.length === UNAVAILABLE_METRICS.length && s.unavailable.some((u) => u.key === "grossProfit"));
});

test("owner filter excludes website orders and says so", async () => {
  orderRows = [{ _id: "INR", amountMinor: 999, orders: 1, enrolments: 1, customers: ["a@x.com"] }];
  const s = await getExecSummary({ from: "2026-11-01", to: "2026-11-30", owner: "65f1c2a4e4b0a1b2c3d4e5f6" });
  assert.deepEqual(s.revenue.collected, []);
  assert.ok(s.notes.some((n) => /owner or source/.test(n)));
});

const stg = (key, label, order, extra = {}) => ({ key, label, order, ...extra });
const corp = {
  _id: "p1", name: "Corporate", type: "corporate",
  stages: [
    stg("lead", "Lead", 1, { alias: "prospect_identified" }),
    stg("needs_analysis", "Needs Analysis", 3, { alias: "requirement_analysis" }),
    stg("skill_gap", "Skill Gap", 4, { alias: "requirement_analysis" }),
    stg("contacted", "Contacted", 1.5, { alias: "contacted" }),
    stg("won", "Won", 10, { isWon: true }),
    stg("lost", "Lost", 11, { isLost: true }),
  ],
};
const row = (pipeline, stage, currency, count, amountMinor) => ({ _id: { pipeline, stage, currency }, count, amountMinor });

test("funnel merges stages sharing an alias, orders by stage order, keeps empty stages, drops terminal ones", () => {
  const [f] = buildFunnel([corp], [
    row("p1", "needs_analysis", "INR", 2, 300),
    row("p1", "skill_gap", "INR", 1, 50),
    row("p1", "skill_gap", "USD", 1, 7),
    row("p1", "lead", "INR", 4, 100),
  ]);
  assert.deepEqual(f.stages.map((s) => s.alias), ["prospect_identified", "contacted", "requirement_analysis"]);
  const req = f.stages.find((s) => s.alias === "requirement_analysis");
  assert.equal(req.count, 4); // 2 needs_analysis + 1 INR skill_gap + 1 USD skill_gap
  assert.deepEqual(req.byCurrency, [{ currency: "INR", amountMinor: 350 }, { currency: "USD", amountMinor: 7 }]);
  assert.equal(f.stages.find((s) => s.alias === "contacted").count, 0);
  assert.equal(f.businessUnit, "b2b");
});

test("funnel respects the business unit filter", () => {
  const ai = { _id: "p2", name: "AI", type: "ai_projects", stages: [stg("prospect", "Prospect", 1)] };
  assert.deepEqual(buildFunnel([corp, ai], [], "ai").map((p) => p.type), ["ai_projects"]);
  assert.deepEqual(buildFunnel([corp, ai], [], "b2c"), []);
  assert.equal(buildFunnel([corp, ai], []).length, 2);
});
