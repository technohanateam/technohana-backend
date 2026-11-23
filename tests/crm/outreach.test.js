import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let busyLeadIds;
let inserted;
let leadUpdates;
let activities;

mock.module("../../src/models/crm/crmTask.model.js", {
  defaultExport: {
    find: () => ({ select: () => ({ lean: async () => busyLeadIds.map((id) => ({ relatedToId: id })) }) }),
    insertMany: async (docs) => { inserted.push(...docs); return docs; },
    updateMany: async () => ({ modifiedCount: 0 }),
  },
});
mock.module("../../src/models/crm/crmLead.model.js", {
  defaultExport: { updateOne: async (...args) => { leadUpdates.push(args); } },
});
mock.module("../../src/models/crm/crmActivity.model.js", {
  defaultExport: { create: async (doc) => { activities.push(doc); } },
});

const { planOutreach, startOutreach, OUTREACH_SEQUENCE } = await import("../../src/services/crmOutreach.js");

beforeEach(() => { busyLeadIds = []; inserted = []; leadUpdates = []; activities = []; });

// 25 Oct 2026, 11:00 IST
const START = new Date("2026-10-25T05:30:00Z");
const SESSION = "2026-11-01";
const istDay = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

test("a sequence started a week before the session has all five steps at 10:00 IST", () => {
  const plan = planOutreach(START, SESSION);
  assert.deepEqual(plan.map((s) => s.key), ["intro", "reminder", "day_before", "session_day", "post_session"]);
  assert.deepEqual(plan.map((s) => istDay(s.dueDate)), ["2026-10-25", "2026-10-27", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.ok(plan.every((s) => new Date(s.dueDate.getTime() + 5.5 * 3600e3).getUTCHours() === 10));
});

test("starting the day before the session skips the reminder and keeps the rest", () => {
  const plan = planOutreach(new Date("2026-10-31T05:30:00Z"), SESSION);
  assert.deepEqual(plan.map((s) => s.key), ["intro", "session_day", "post_session"]);
});

test("steps already in the past are never scheduled", () => {
  const plan = planOutreach(new Date("2026-11-03T05:30:00Z"), SESSION);
  assert.deepEqual(plan.map((s) => s.key), ["intro"]);
});

const lead = (over = {}) => ({
  _id: "l1", name: "AI Analyst Lead 919899117415", phone: "+919899117415", status: "new",
  assignedTo: { _id: "rep1", name: "Heena Shaikh" }, ...over,
});

test("startOutreach creates tagged tasks for the assigned rep with a ready wa.me message", async () => {
  const res = await startOutreach([lead()], "admin1", START);
  assert.equal(res.started, 1);
  assert.equal(inserted.length, 5);
  const first = inserted[0];
  assert.equal(first.sequenceKey, OUTREACH_SEQUENCE);
  assert.equal(first.assignedTo, "rep1");
  assert.equal(first.relatedToId, "l1");
  assert.match(first.description, /Hi there, this is Heena from Technohana/);
  assert.match(first.description, /https:\/\/wa\.me\/919899117415\?text=/);
  assert.match(inserted[1].description, /utm_medium%3Doutreach|utm_medium=outreach/);
  assert.equal(activities[0].title, "Outreach sequence started");
  assert.equal(leadUpdates[0][1].nextFollowUp, first.dueDate);
});

test("a real first name is used in the greeting", async () => {
  await startOutreach([lead({ name: "Asha Rao" })], "admin1", START);
  assert.match(inserted[0].description, /Hi Asha,/);
});

test("closed leads, leads without a phone and leads already in a sequence are skipped", async () => {
  busyLeadIds = ["l3"];
  const res = await startOutreach([
    lead({ _id: "l1", status: "junk" }),
    lead({ _id: "l2", phone: "" }),
    lead({ _id: "l3" }),
  ], "admin1", START);
  assert.equal(res.started, 0);
  assert.deepEqual(res.skipped.map((s) => s.reason), ["Lead is junk", "No valid phone", "Sequence already running"]);
  assert.equal(inserted.length, 0);
});

test("a lead marked do not contact never enters the sequence", async () => {
  const res = await startOutreach([lead({ tags: [{ name: "legacy-2024" }, { name: "do-not-contact" }] })], "admin1", START);
  assert.equal(res.started, 0);
  assert.deepEqual(res.skipped.map((s) => s.reason), ["Marked do not contact"]);
  assert.equal(inserted.length, 0);
});

test("other tags don't block the sequence", async () => {
  const res = await startOutreach([lead({ tags: [{ name: "legacy-2024" }] })], "admin1", START);
  assert.equal(res.started, 1);
});
