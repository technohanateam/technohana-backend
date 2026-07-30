import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import SeoSettings from "../../src/models/seoSettings.model.js";
import { updateSettings } from "../../src/controllers/seoSettings.controller.js";

function makeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

beforeEach(() => {
  mock.restoreAll();
});

test("updateSettings persists backlinkVerification and discovery (Phase 6 config)", async () => {
  const doc = {
    scoringWeights: {},
    save: async function () { return this; },
  };
  mock.method(SeoSettings, "findOne", async () => doc);

  const req = {
    body: {
      backlinkVerification: { rateLimitMs: 5000, userAgent: "CustomBot/1.0" },
      discovery: { candidatesPerRun: 20, categoriesSeedList: ["custom-category"] },
    },
    admin: { email: "admin@technohana.in" },
  };
  const res = makeRes();

  await updateSettings(req, res);

  assert.deepEqual(doc.backlinkVerification, { rateLimitMs: 5000, userAgent: "CustomBot/1.0" });
  assert.deepEqual(doc.discovery, { candidatesPerRun: 20, categoriesSeedList: ["custom-category"] });
  assert.equal(res.body.success, true);
});

test("updateSettings ignores unknown fields", async () => {
  const doc = { save: async function () { return this; } };
  mock.method(SeoSettings, "findOne", async () => doc);

  const req = { body: { notARealField: "should not be set" }, admin: {} };
  const res = makeRes();

  await updateSettings(req, res);

  assert.equal(doc.notARealField, undefined);
});
