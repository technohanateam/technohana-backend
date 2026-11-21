import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const ID = "a".repeat(24);
let leadRecord;
let contactRecord;
let sends;
let logged;

const query = (value) => {
  const q = { select: () => q, populate: () => q, lean: async () => value() };
  return q;
};

mock.module("../../src/models/crm/crmLead.model.js", {
  defaultExport: { findOne: () => query(() => leadRecord) },
});
mock.module("../../src/models/crm/crmContact.model.js", {
  defaultExport: { findOne: () => query(() => contactRecord) },
});
mock.module("../../src/models/crm/crmActivity.model.js", {
  defaultExport: {
    exists: async () => null,
    create: async (doc) => { logged.push(doc); return { _id: "activity1", ...doc }; },
    updateOne: async () => {},
  },
});
mock.module("../../src/models/subscription.model.js", {
  defaultExport: { exists: () => ({ collation: async () => null }) },
});
mock.module("../../src/config/emailService.js", {
  namedExports: {
    sendEmail: async (message) => { sends.push(message); return { data: { id: "resend1" } }; },
    fromAddresses: { sales: "sales@test.local" },
  },
});
mock.module("../../src/services/zohoService.js", {
  namedExports: { getActiveConnection: async () => null, sendZohoMail: async () => {} },
});

const { sendCrmEmail } = await import("../../src/controllers/crmActivity.controller.js");

const send = async (body) => {
  const res = {
    status(code) { this.code = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const admin = { _id: "user1", crmRole: "super_admin", name: "Rep", email: "rep@test.local" };
  await sendCrmEmail({ body: { subject: "Hello", body: "Hi there", ...body }, admin }, res);
  return res;
};

const hold = [{ name: "legacy-2024" }, { name: "do-not-contact" }];

beforeEach(() => {
  sends = [];
  logged = [];
  leadRecord = { _id: "lead1", name: "Asha Rao", email: "asha@test.local" };
  contactRecord = { _id: "contact1", firstName: "Ravi", lastName: "Iyer", email: "ravi@test.local" };
});

test("a lead marked do not contact is not emailed and nothing is logged", async () => {
  leadRecord.tags = hold;
  const res = await send({ leadId: ID });
  assert.equal(res.code, 409);
  assert.match(res.payload.message, /Asha Rao is marked do not contact/);
  assert.equal(sends.length, 0);
  assert.equal(logged.length, 0);
});

test("a contact marked do not contact is not emailed", async () => {
  contactRecord.tags = hold;
  const res = await send({ contactId: ID });
  assert.equal(res.code, 409);
  assert.match(res.payload.message, /Ravi Iyer is marked do not contact/);
  assert.equal(sends.length, 0);
});

test("a record with other tags is emailed as usual", async () => {
  leadRecord.tags = [{ name: "legacy-2024" }];
  const res = await send({ leadId: ID });
  assert.equal(res.code, 201);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, "asha@test.local");
});

test("a record with no tags is emailed as usual", async () => {
  const res = await send({ contactId: ID });
  assert.equal(res.code, 201);
  assert.equal(sends.length, 1);
});
