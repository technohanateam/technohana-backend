import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let users;
let failWrites;

const fakeUser = {
  findOneAndUpdate: async (filter, fields) => {
    if (failWrites) throw new Error("db down");
    const u = users.find((x) => x.orderId === filter.orderId);
    if (u) Object.assign(u, fields);
    return u || null;
  },
  create: async (doc) => { if (failWrites) throw new Error("db down"); users.push({ ...doc }); return doc; },
  exists: async (filter) => (users.some((x) => x.orderId === filter.orderId && x.status === filter.status) ? { _id: 1 } : null),
};
mock.module("../../src/models/user.model.js", { namedExports: { User: fakeUser } });

const { enrolPaidOrder, healUnenrolledPaidOrder } = await import("../../src/services/orderEnrolment.js");
const { tryEncryptToken } = await import("../../src/utils/tokenCrypto.js");

const order = {
  orderId: "ord_1", expectedTotalMinor: 4319910, currency: "inr", enrollmentType: "individual",
  learner: { fullName: "Asha", email: "asha@example.com", phone: "9999999999", trainingLocation: "Online" },
  courseInfo: { title: "Claude Code for Engineering Teams" },
};

beforeEach(() => { users = []; failWrites = false; delete process.env.ENROLLMENT_TOKEN_KEY; });

test("a missing ENROLLMENT_TOKEN_KEY no longer stops the enrolment: the learner is enrolled without a token", async () => {
  users.push({ orderId: "ord_1", status: "pending-payment" });
  assert.equal(await enrolPaidOrder(order), true);
  assert.equal(users[0].status, "enrolled");
  assert.equal(users[0].price, "43199.10");
  assert.equal("enrollmentToken" in users[0], false);
});

test("tryEncryptToken returns undefined instead of throwing when the key is missing", () => {
  assert.equal(tryEncryptToken({ a: 1 }), undefined);
});

// tokenCrypto keeps the key once it has read it, so the test that sets a key runs after the ones without.
test("with the key set, the enrolment carries a recovery token", async () => {
  process.env.ENROLLMENT_TOKEN_KEY = "test-key-for-tokens";
  users.push({ orderId: "ord_1", status: "pending-payment" });
  await enrolPaidOrder(order);
  assert.ok(users[0].enrollmentToken);
  assert.ok(tryEncryptToken({ a: 1 }));
});

test("a learner with no record yet is created as enrolled, with the instalment plan kept", async () => {
  assert.equal(await enrolPaidOrder(order, { paymentPlan: "two_instalment" }), true);
  assert.equal(users.length, 1);
  assert.equal(users[0].status, "enrolled");
  assert.equal(users[0].paymentPlan, "two_instalment");
  assert.equal(users[0].email, "asha@example.com");
});

test("a database error is reported as false and never thrown, because the payment is already taken", async () => {
  failWrites = true;
  assert.equal(await enrolPaidOrder(order), false);
});

test("a paid order whose learner is still pending gets enrolled by the next confirmation", async () => {
  users.push({ orderId: "ord_1", status: "pending-payment" });
  assert.equal(await healUnenrolledPaidOrder(order), true);
  assert.equal(users[0].status, "enrolled");
});

test("a paid order with no learner record at all is also healed", async () => {
  assert.equal(await healUnenrolledPaidOrder(order), true);
  assert.equal(users[0].status, "enrolled");
});

test("an already-enrolled learner is left alone", async () => {
  users.push({ orderId: "ord_1", status: "enrolled", enrolledAt: "first" });
  assert.equal(await healUnenrolledPaidOrder(order), false);
  assert.equal(users[0].enrolledAt, "first", "enrolment date is not rewritten");
});
