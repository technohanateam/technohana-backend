import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let users;
let loads;

mock.module("../../src/models/crmUser.model.js", {
  defaultExport: {
    find: () => ({ select: () => ({ lean: async () => users }) }),
  },
});
mock.module("../../src/models/crm/crmLead.model.js", {
  defaultExport: { aggregate: async () => loads },
});
mock.module("../../src/models/crm/crmActivity.model.js", { defaultExport: {} });
mock.module("../../src/services/crmLeadNotify.js", { namedExports: { notifyLeadAssigned: () => {} } });

const { createAssigner, isAdPoolLead } = await import("../../src/services/crmLeadIntake.js");

const AMER = "a1";
const HEENA = "a2";
const REP = "d1";
const FOUNDER = "f1";

beforeEach(() => {
  users = [
    { _id: AMER, crmRole: "sales", leadPool: "ads", poolLead: true },
    { _id: HEENA, crmRole: "sales", leadPool: "ads", poolLead: false },
    { _id: REP, crmRole: "sales", leadPool: "direct", poolLead: false },
    { _id: FOUNDER, crmRole: "super_admin" },
  ];
  loads = [];
});

test("paid-ad sources are ad-pool leads, organic ones are not", () => {
  assert.equal(isAdPoolLead({ source: "meta_ads" }), true);
  assert.equal(isAdPoolLead({ source: "google_ads" }), true);
  assert.equal(isAdPoolLead({ source: "linkedin_ads" }), true);
  assert.equal(isAdPoolLead({ source: "social", utm: { utm_source: "instagram" } }), true);
  assert.equal(isAdPoolLead({ source: "social", utm: { utm_source: "newsletter" } }), false);
  assert.equal(isAdPoolLead({ source: "referral" }), false);
  assert.equal(isAdPoolLead({ source: "campaign" }), false);
  assert.equal(isAdPoolLead(undefined), false);
});

test("every ad lead goes to the ads pool lead, however loaded", async () => {
  loads = [{ _id: AMER, open: 50 }];
  const next = await createAssigner();
  for (let i = 0; i < 5; i++) assert.equal(next({ source: "meta_ads" }), AMER);
});

test("direct leads go to direct-pool reps and never the ads pool", async () => {
  const next = await createAssigner();
  for (const source of ["referral", "website_enquiry", "other", undefined]) {
    assert.equal(next({ source }), REP);
  }
});

test("ad leads fall back to the rest of the ads pool, then direct reps, then admins", async () => {
  users = users.filter((u) => u._id !== AMER);
  assert.equal((await createAssigner())({ source: "meta_ads" }), HEENA);

  users = users.filter((u) => u._id !== HEENA);
  assert.equal((await createAssigner())({ source: "meta_ads" }), REP);

  users = users.filter((u) => u._id !== REP);
  assert.equal((await createAssigner())({ source: "meta_ads" }), FOUNDER);
});

test("direct leads fall back to admins, not the ads pool, when no direct rep is active", async () => {
  users = users.filter((u) => u._id !== REP);
  assert.equal((await createAssigner())({ source: "referral" }), FOUNDER);
});

test("with no users there is no assignee", async () => {
  users = [];
  assert.equal((await createAssigner())({ source: "meta_ads" }), undefined);
});
