import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let messages;
let existingLead;
let upserts;
let cancelled;
let activities;

mock.module("../../src/models/whatsappMessage.model.js", {
  defaultExport: {
    exists: async (q) => messages.some((m) => m.waMessageId === q.waMessageId),
    create: async (doc) => {
      const stored = { ...doc, createdAt: new Date(), save: async () => stored };
      messages.push(stored);
      return stored;
    },
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => {
            const inbound = messages.filter((m) => m.direction === "in");
            return inbound.length ? inbound[inbound.length - 1] : null;
          },
        }),
      }),
    }),
  },
});
mock.module("../../src/models/crm/crmLead.model.js", {
  defaultExport: { findOne: () => ({ sort: () => ({ select: async () => existingLead }) }) },
});
mock.module("../../src/models/crm/crmActivity.model.js", {
  defaultExport: { create: async (doc) => { activities.push(doc); return doc; } },
});
mock.module("../../src/services/crmLeadIntake.js", {
  namedExports: {
    upsertCrmLead: async (args) => { upserts.push(args); return { lead: { _id: "lead1" }, created: !existingLead }; },
  },
});

mock.module("../../src/services/crmOutreach.js", {
  namedExports: { cancelOutreach: async (id) => { cancelled.push(id); return 1; } },
});

const { recordInbound, eventsFrom } = await import("../../src/services/whatsapp.js");

beforeEach(() => { messages = []; existingLead = null; upserts = []; cancelled = []; activities = []; });

const adMessage = (extra = {}) => ({
  id: "wamid.1", from: "919899117415", type: "text", text: { body: "Send me the session link" },
  profileName: "Asha",
  referral: { source_type: "ad", source_id: "ad-9", headline: "AI Analyst session", ctwa_clid: "clid" },
  ...extra,
});

test("a chat from a Click-to-WhatsApp ad creates a Meta ads lead", async () => {
  await recordInbound(adMessage());
  assert.equal(upserts.length, 1);
  const { fields, activityTitle } = upserts[0];
  assert.equal(fields.name, "Asha");
  assert.equal(fields.phone, "+919899117415");
  assert.equal(fields.source, "meta_ads");
  assert.match(fields.interest, /AI Analyst session/);
  assert.equal(fields.customFields.ctwaClid, "clid");
  assert.equal(activityTitle, "Lead captured from WhatsApp ad");
});

test("an unknown number without a referral does not become a lead", async () => {
  await recordInbound(adMessage({ referral: undefined }));
  assert.equal(upserts.length, 0);
  assert.equal(messages.length, 1);
});

test("a reply from an existing lead is logged on the lead and tied to its thread", async () => {
  existingLead = { _id: "lead1" };
  await recordInbound(adMessage({ referral: undefined }));
  assert.equal(upserts.length, 0, "no new lead is created for a known number");
  assert.equal(activities.length, 1);
  assert.equal(activities[0].title, "WhatsApp received");
  assert.equal(activities[0].relatedToId, "lead1");
  assert.equal(messages[0].relatedToId, "lead1");
});

test("later messages in the same 24h conversation are logged but only the first cancels outreach", async () => {
  existingLead = { _id: "lead1" };
  await recordInbound(adMessage({ id: "wamid.1", referral: undefined }));
  await recordInbound(adMessage({ id: "wamid.2", referral: undefined }));
  assert.equal(messages.length, 2);
  assert.equal(activities.length, 2);
  assert.deepEqual(cancelled, ["lead1"]);
});

test("STOP is recorded as an opt-out and never creates a lead", async () => {
  await recordInbound(adMessage({ text: { body: "STOP" } }));
  assert.equal(upserts.length, 0);
  assert.equal(messages[0].type, "opt_out");
});

test("a reply from an existing lead cancels their scheduled outreach", async () => {
  existingLead = { _id: "lead1" };
  await recordInbound(adMessage({ referral: undefined }));
  assert.deepEqual(cancelled, ["lead1"]);
});

test("STOP from an existing lead cancels their scheduled outreach", async () => {
  existingLead = { _id: "lead1" };
  await recordInbound(adMessage({ text: { body: "stop" }, referral: undefined }));
  assert.deepEqual(cancelled, ["lead1"]);
});

test("a brand-new ad lead has nothing to cancel", async () => {
  await recordInbound(adMessage());
  assert.deepEqual(cancelled, []);
});

test("webhook redeliveries are ignored", async () => {
  await recordInbound(adMessage());
  await recordInbound(adMessage());
  assert.equal(upserts.length, 1);
  assert.equal(messages.length, 1);
});

test("eventsFrom attaches the WhatsApp profile name to each message", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      contacts: [{ wa_id: "919899117415", profile: { name: "Asha" } }],
      messages: [{ id: "wamid.1", from: "919899117415", type: "text" }],
    } }] }],
  };
  assert.equal(eventsFrom(payload).messages[0].profileName, "Asha");
});
