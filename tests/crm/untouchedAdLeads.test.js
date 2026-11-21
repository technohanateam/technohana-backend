import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let leads;
let contactedIds;
let admins;
let claimed;
let notified;
let leadQuery;

mock.module("../../src/models/crm/crmLead.model.js", {
  defaultExport: {
    find: (q) => {
      leadQuery = q;
      const chain = { sort: () => chain, limit: () => chain, select: () => chain, lean: async () => leads };
      return chain;
    },
    updateOne: async (filter) => {
      if (claimed.has(String(filter._id))) return { modifiedCount: 0 };
      claimed.add(String(filter._id));
      return { modifiedCount: 1 };
    },
  },
});
mock.module("../../src/models/crm/crmActivity.model.js", {
  defaultExport: { distinct: async () => contactedIds },
});
mock.module("../../src/models/crmUser.model.js", {
  defaultExport: { find: () => ({ select: () => ({ lean: async () => admins }) }) },
});
mock.module("../../src/services/crmLeadNotify.js", {
  namedExports: { notifyLeadAssigned: (args) => notified.push(args) },
});

const { sendUntouchedAdLeadAlerts } = await import("../../src/services/crmLeadSla.js");

// 10:30 IST on a normal day, and 23:30 IST.
const DAYTIME = new Date("2026-11-21T05:00:00Z");
const NIGHT = new Date("2026-11-21T18:00:00Z");

const lead = (id, assignedTo = "amer") => ({ _id: id, name: `Lead ${id}`, assignedTo, createdAt: new Date(DAYTIME.getTime() - 45 * 60 * 1000) });

beforeEach(() => {
  leads = [lead("l1")];
  contactedIds = [];
  admins = [{ _id: "founder" }];
  claimed = new Set();
  notified = [];
  leadQuery = null;
});

test("an uncontacted ad lead alerts the assignee and the admins once", async () => {
  const res = await sendUntouchedAdLeadAlerts(DAYTIME);
  assert.equal(res.sent, 1);
  assert.deepEqual(notified.map((n) => n.assigneeId).sort(), ["amer", "founder"]);
  assert.ok(notified.every((n) => n.reason === "untouched" && n.waitedMinutes === 45));
});

test("a second run does not alert the same lead again", async () => {
  await sendUntouchedAdLeadAlerts(DAYTIME);
  notified = [];
  const res = await sendUntouchedAdLeadAlerts(DAYTIME);
  assert.equal(res.sent, 0);
  assert.equal(notified.length, 0);
});

test("a lead the rep has already contacted is skipped", async () => {
  contactedIds = ["l1"];
  const res = await sendUntouchedAdLeadAlerts(DAYTIME);
  assert.equal(res.sent, 0);
  assert.equal(notified.length, 0);
});

test("when the assignee is also an admin they are alerted once", async () => {
  leads = [lead("l1", "founder")];
  await sendUntouchedAdLeadAlerts(DAYTIME);
  assert.deepEqual(notified.map((n) => n.assigneeId), ["founder"]);
});

test("nothing is sent between 9pm and 9am IST", async () => {
  const res = await sendUntouchedAdLeadAlerts(NIGHT);
  assert.equal(res.sent, 0);
  assert.equal(notified.length, 0);
  assert.equal(leadQuery, null);
});

test("only open, assigned, un-alerted ad leads inside the window are queried", async () => {
  await sendUntouchedAdLeadAlerts(DAYTIME);
  assert.equal(leadQuery.isDeleted, false);
  assert.equal(leadQuery.slaAlertedAt, null);
  assert.deepEqual(leadQuery.status, { $nin: ["won", "lost", "junk"] });
  assert.ok(leadQuery.$or, "limited to ad-pool sources");
  assert.equal(DAYTIME - leadQuery.createdAt.$lte, 30 * 60 * 1000);
  assert.equal(DAYTIME - leadQuery.createdAt.$gte, 24 * 60 * 60 * 1000);
});
