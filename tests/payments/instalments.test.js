import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const DAY = 86400000;
let order;
let userCalls;
let emails;
let userDocs;

// A tiny stand-in for the bits of Mongo the instalment service uses on one order document.
const matches = (el, cond) => Object.entries(cond).every(([k, v]) => {
  if (v && typeof v === "object" && "$ne" in v) {
    const field = el[k];
    return Array.isArray(field) ? !field.includes(v.$ne) : field !== v.$ne;
  }
  return el[k] === v;
});

const fakeOrder = {
  findOne: () => ({ select: () => ({ lean: async () => order }), lean: async () => order }),
  find: () => ({ limit: () => ({ lean: async () => (order && order.status === "partially_paid" ? [order] : []) }) }),
  updateOne: async (filter, update) => {
    if (!order || filter.orderId !== order.orderId) return { modifiedCount: 0 };
    let el;
    if (filter.instalments?.$elemMatch) {
      el = order.instalments.find((i) => matches(i, filter.instalments.$elemMatch));
      if (!el) return { modifiedCount: 0 };
    } else if (filter["instalments.seq"]) {
      el = order.instalments.find((i) => i.seq === filter["instalments.seq"]);
    }
    for (const [k, v] of Object.entries(update.$set || {})) {
      if (k.startsWith("instalments.$.")) el[k.slice("instalments.$.".length)] = v;
      else order[k] = v;
    }
    for (const [k, v] of Object.entries(update.$addToSet || {})) {
      const f = k.slice("instalments.$.".length);
      el[f] = [...(el[f] || []), v];
    }
    for (const [k, v] of Object.entries(update.$pull || {})) {
      const f = k.slice("instalments.$.".length);
      el[f] = (el[f] || []).filter((x) => x !== v);
    }
    return { modifiedCount: 1 };
  },
};

mock.module("../../src/models/order.model.js", { namedExports: { Order: fakeOrder } });
mock.module("../../src/models/user.model.js", {
  namedExports: {
    User: {
      updateMany: async (filter, update) => { userCalls.push({ filter, update }); return { modifiedCount: 1 }; },
      find: () => ({ select: () => ({ lean: async () => userDocs }) }),
    },
  },
});
mock.module("../../src/config/emailService.js", {
  namedExports: {
    fromAddresses: { sales: "sales@example.com" },
    sendEmail: async (msg) => { emails.push(msg); return {}; },
  },
});

const {
  midpointDueAt, initialDueAt, markInstalmentPaid, handleRazorpayWebhook, runInstalmentChecks,
  ensureSecondInstalmentLink, recomputeDueForEnrollments,
} = await import("../../src/services/instalments.js");
const { instalmentEligible, splitInstalments, INSTALMENT_MIN_INR_MINOR } = await import("../../src/utils/pricing.js");

const NOW = new Date("2026-12-15T04:00:00Z");

const makeOrder = (over = {}) => ({
  orderId: "ord_1", invoiceNumber: "INV-202611-ABC123", currency: "inr", expectedTotalMinor: 2000000, status: "partially_paid",
  courseId: "101", courseInfo: { title: "Scrum Master" }, learner: { fullName: "Asha", email: "asha@example.com", phone: "9999999999" },
  instalments: [
    { seq: 1, amountMinor: 1000000, status: "paid", paidAt: new Date(NOW.getTime() - 20 * DAY) },
    { seq: 2, amountMinor: 1000000, status: "due", dueAt: new Date(NOW.getTime() + 3 * DAY), remindersSent: [] },
  ],
  ...over,
});

beforeEach(() => { order = makeOrder(); userCalls = []; emails = []; userDocs = []; delete process.env.RAZORPAY_WEBHOOK_SECRET; });

test("instalments are for single INR learners at or above the minimum only", () => {
  const ok = { currency: "INR", enrollmentType: "individual", participants: 1, totalMinor: INSTALMENT_MIN_INR_MINOR };
  assert.equal(INSTALMENT_MIN_INR_MINOR, 1000000);
  assert.equal(instalmentEligible(ok), true);
  assert.equal(instalmentEligible({ ...ok, totalMinor: INSTALMENT_MIN_INR_MINOR - 1 }), false);
  assert.equal(instalmentEligible({ ...ok, currency: "usd" }), false);
  assert.equal(instalmentEligible({ ...ok, enrollmentType: "group" }), false);
  assert.equal(instalmentEligible({ ...ok, participants: 2 }), false);
});

test("the two instalments always add up to the exact price", () => {
  for (const total of [1000000, 1000001, 1599900, 2345677]) {
    const { first, second } = splitInstalments(total);
    assert.equal(first + second, total);
    assert.ok(first >= second && first - second <= 1);
  }
});

test("the balance is due at the batch midpoint, never inside the refund window", () => {
  const first = new Date("2026-11-01T00:00:00Z").getTime();
  const due = midpointDueAt({ startDate: "2026-12-01T00:00:00Z", endDate: "2026-12-31T00:00:00Z" }, first);
  assert.equal(due.toISOString(), "2026-12-16T00:00:00.000Z");
  const early = midpointDueAt({ startDate: "2026-11-02T00:00:00Z", endDate: "2026-11-04T00:00:00Z" }, first);
  assert.equal(early.getTime(), first + 7 * DAY);
  assert.equal(midpointDueAt({ startDate: "2026-12-31", endDate: "2026-12-01" }, first), null);
  assert.equal(initialDueAt(first, {}).getTime(), first + 30 * DAY);
  assert.equal(initialDueAt(first, { INSTALMENT_FALLBACK_DUE_DAYS: "10" }).getTime(), first + 10 * DAY);
});

test("paying the balance completes the order, issues a second invoice and lifts any hold", async () => {
  const res = await markInstalmentPaid({ orderId: "ord_1", paymentId: "pay_2", amountMinor: 1000000, paidAtMs: NOW.getTime() });
  assert.equal(res.updated, true);
  assert.equal(order.status, "paid");
  assert.equal(order.amountPaidMinor, 2000000);
  assert.equal(order.instalments[1].status, "paid");
  assert.equal(order.instalments[1].invoiceNumber, "INV-202611-ABC123-2");
  assert.deepEqual(userCalls[0].update, { $set: { accessHold: false }, $unset: { holdSince: "" } });
  assert.equal(emails.length, 1);
});

test("paying twice (webhook retry) changes nothing the second time", async () => {
  await markInstalmentPaid({ orderId: "ord_1", paymentId: "pay_2", amountMinor: 1000000 });
  emails = []; userCalls = [];
  const again = await markInstalmentPaid({ orderId: "ord_1", paymentId: "pay_2", amountMinor: 1000000 });
  assert.equal(again.updated, false);
  assert.equal(emails.length, 0);
  assert.equal(userCalls.length, 0);
});

test("a payment for the wrong amount is not accepted as the balance", async () => {
  const res = await markInstalmentPaid({ orderId: "ord_1", paymentId: "pay_x", amountMinor: 999999 });
  assert.equal(res.updated, false);
  assert.equal(res.reason, "amount-mismatch");
  assert.equal(order.status, "partially_paid");
});

const webhookReq = (body, secret = "whsec") => {
  const raw = Buffer.from(JSON.stringify(body));
  return { body: raw, headers: { "x-razorpay-signature": crypto.createHmac("sha256", secret).update(raw).digest("hex") } };
};
const fakeRes = () => { const r = { code: 200, json(b) { r.body = b; return r; }, status(c) { r.code = c; return r; } }; return r; };
const paidEvent = (amount = 1000000) => ({
  event: "payment_link.paid",
  payload: { payment_link: { entity: { reference_id: "ord_1-2-1700000000", notes: { orderId: "ord_1" } } }, payment: { entity: { id: "pay_9", amount, created_at: 1760000000 } } },
});

test("the webhook rejects a bad signature and an unconfigured secret", async () => {
  const noSecret = fakeRes();
  await handleRazorpayWebhook(webhookReq(paidEvent()), noSecret);
  assert.equal(noSecret.code, 503);

  process.env.RAZORPAY_WEBHOOK_SECRET = "whsec";
  const bad = fakeRes();
  await handleRazorpayWebhook(webhookReq(paidEvent(), "other-secret"), bad);
  assert.equal(bad.code, 400);
  assert.equal(order.status, "partially_paid");
});

test("a signed payment_link.paid webhook marks the balance paid; other events are ignored", async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = "whsec";
  const res = fakeRes();
  await handleRazorpayWebhook(webhookReq(paidEvent()), res);
  assert.equal(res.code, 200);
  assert.equal(order.status, "paid");

  order = makeOrder();
  const ignored = fakeRes();
  await handleRazorpayWebhook(webhookReq({ event: "payment.captured", payload: {} }), ignored);
  assert.equal(ignored.body.ignored, true);
  assert.equal(order.status, "partially_paid");
});

const link = async () => ({ url: "https://rzp.io/l/test" });

test("a reminder goes out once in the 5 days before the due date, with no fee mentioned", async () => {
  const stats = await runInstalmentChecks(NOW, { ensureLink: link });
  assert.equal(stats.reminded, 1);
  assert.equal(emails.length, 1);
  assert.match(emails[0].html, /no interest, late fee or extra charge/i);
  assert.match(emails[0].html, /rzp\.io\/l\/test/);
  const again = await runInstalmentChecks(NOW, { ensureLink: link });
  assert.equal(again.reminded, 0);
  assert.equal(emails.length, 1);
});

test("a balance more than 5 days away gets no reminder yet", async () => {
  order.instalments[1].dueAt = new Date(NOW.getTime() + 10 * DAY);
  const stats = await runInstalmentChecks(NOW, { ensureLink: link });
  assert.deepEqual(stats, { reminded: 0, due: 0, held: 0 });
  assert.equal(emails.length, 0);
});

test("on the due date the balance is marked overdue and a due notice is sent", async () => {
  order.instalments[1].dueAt = new Date(NOW.getTime() - 1 * DAY);
  const stats = await runInstalmentChecks(NOW, { ensureLink: link });
  assert.equal(stats.due, 1);
  assert.equal(order.instalments[1].status, "overdue");
  assert.equal(userCalls.length, 0, "no access hold inside the grace period");
});

test("after the 7-day grace period access is held, once, and nothing is charged", async () => {
  order.instalments[1].dueAt = new Date(NOW.getTime() - 8 * DAY);
  const stats = await runInstalmentChecks(NOW, { ensureLink: link });
  assert.equal(stats.held, 1);
  assert.equal(userCalls[0].update.$set.accessHold, true);
  assert.match(emails[0].html, /no interest, late fee or extra charge/i);
  assert.doesNotMatch(emails[0].html, /late fee of|penalty of|interest of/i);
  const again = await runInstalmentChecks(NOW, { ensureLink: link });
  assert.equal(again.held, 0);
  assert.equal(emails.length, 1);
});

test("a payment link is created for exactly the balance and reused until it nears expiry", async () => {
  const created = [];
  const razorpay = { paymentLink: { create: async (body) => { created.push(body); return { id: "plink_1", short_url: "https://rzp.io/l/abc" }; } } };
  const first = await ensureSecondInstalmentLink("ord_1", { razorpay, now: NOW });
  assert.equal(first.url, "https://rzp.io/l/abc");
  assert.equal(created[0].amount, 1000000);
  assert.equal(created[0].currency, "INR");
  assert.equal(created[0].accept_partial, false);
  assert.equal(created[0].customer.email, "asha@example.com");
  const second = await ensureSecondInstalmentLink("ord_1", { razorpay, now: NOW });
  assert.equal(second.url, "https://rzp.io/l/abc");
  assert.equal(created.length, 1);
  const later = await ensureSecondInstalmentLink("ord_1", { razorpay, now: new Date(NOW.getTime() + 61 * DAY) });
  assert.equal(created.length, 2, "an expired link is replaced");
  assert.ok(later.url);
});

test("there is no link when nothing is owed", async () => {
  order.instalments[1].status = "paid";
  const res = await ensureSecondInstalmentLink("ord_1", { razorpay: {}, now: NOW });
  assert.ok(res.error);
});

test("attaching a learner to a batch moves their balance to the batch midpoint", async () => {
  userDocs = [{ orderId: "ord_1" }];
  const changed = await recomputeDueForEnrollments(["u1"], { startDate: "2026-12-20T00:00:00Z", endDate: "2027-01-20T00:00:00Z" });
  assert.equal(changed, 1);
  const first = order.instalments[0].paidAt.getTime();
  const expected = Math.max(new Date("2027-01-04T12:00:00Z").getTime(), first + 7 * DAY);
  assert.equal(new Date(order.instalments[1].dueAt).getTime(), expected);
  assert.equal(await recomputeDueForEnrollments(["u1"], { startDate: null, endDate: null }), 0);
});
