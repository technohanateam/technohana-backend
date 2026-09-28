import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Batch from "../../src/models/batch.model.js";
import Session from "../../src/models/session.model.js";
import CourseMaterial from "../../src/models/courseMaterial.model.js";
import {
  loadOwnedBatch,
  loadOwnedSession,
  loadOwnedMaterial,
  resolveOwnedBatchFromBody,
} from "../../src/middleware/instructorOwnsResource.js";

// The models are patched rather than hitting a database: what is under test is the
// authorization logic, specifically that instructorId is part of every query and
// that session ownership is resolved through the parent Batch.

const INSTRUCTOR_A = new mongoose.Types.ObjectId();
const INSTRUCTOR_B = new mongoose.Types.ObjectId();
const BATCH_ID = new mongoose.Types.ObjectId();
const SESSION_ID = new mongoose.Types.ObjectId();
const MATERIAL_ID = new mongoose.Types.ObjectId();

const original = {};
beforeEach(() => {
  original.batchFindOne = Batch.findOne;
  original.sessionFindById = Session.findById;
  original.materialFindOne = CourseMaterial.findOne;
});
afterEach(() => {
  Batch.findOne = original.batchFindOne;
  Session.findById = original.sessionFindById;
  CourseMaterial.findOne = original.materialFindOne;
});

const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const run = async (mw, req) => {
  const res = mockRes();
  let nextCalled = false;
  await mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

// ── loadOwnedBatch ────────────────────────────────────────────────────────────

test("loadOwnedBatch puts instructorId in the query, not a later comparison", async () => {
  let observedQuery = null;
  Batch.findOne = (q) => { observedQuery = q; return Promise.resolve({ _id: BATCH_ID }); };

  const req = { params: { batchId: String(BATCH_ID) }, instructor: { id: String(INSTRUCTOR_A) } };
  const { nextCalled } = await run(loadOwnedBatch, req);

  assert.equal(nextCalled, true);
  assert.equal(String(observedQuery._id), String(BATCH_ID));
  assert.equal(String(observedQuery.instructorId), String(INSTRUCTOR_A),
    "instructorId must be part of the filter so a miss is indistinguishable from absence");
  assert.ok(req.batch);
});

test("loadOwnedBatch returns 404 — not 403 — for another instructor's batch", async () => {
  // A filtered query simply finds nothing.
  Batch.findOne = () => Promise.resolve(null);

  const req = { params: { batchId: String(BATCH_ID) }, instructor: { id: String(INSTRUCTOR_B) } };
  const { res, nextCalled } = await run(loadOwnedBatch, req);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404, "403 would confirm the id exists and make batches enumerable");
  assert.match(res.body.message, /not found/i);
});

test("loadOwnedBatch rejects a malformed id before querying", async () => {
  let queried = false;
  Batch.findOne = () => { queried = true; return Promise.resolve(null); };

  const req = { params: { batchId: "not-an-objectid" }, instructor: { id: String(INSTRUCTOR_A) } };
  const { res, nextCalled } = await run(loadOwnedBatch, req);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(queried, false);
});

// ── loadOwnedSession — the stale-denormalization trap ─────────────────────────

test("loadOwnedSession authorizes through the parent Batch, not Session.instructorId", async () => {
  // The session still carries A as its denormalized instructor (a stale copy left
  // by a reassignment), but the batch now belongs to B. A must be locked out.
  Session.findById = () => Promise.resolve({
    _id: SESSION_ID, batchId: BATCH_ID, instructorId: INSTRUCTOR_A,
  });
  let batchQuery = null;
  Batch.findOne = (q) => { batchQuery = q; return Promise.resolve(null); };

  const req = { params: { sessionId: String(SESSION_ID) }, instructor: { id: String(INSTRUCTOR_A) } };
  const { res, nextCalled } = await run(loadOwnedSession, req);

  assert.equal(nextCalled, false, "a stale denormalized instructorId must not grant access");
  assert.equal(res.statusCode, 404);
  assert.equal(String(batchQuery.instructorId), String(INSTRUCTOR_A),
    "the decisive query is against Batch, filtered by the caller");
});

test("loadOwnedSession succeeds and exposes both session and batch", async () => {
  Session.findById = () => Promise.resolve({ _id: SESSION_ID, batchId: BATCH_ID });
  Batch.findOne = () => Promise.resolve({ _id: BATCH_ID, instructorId: INSTRUCTOR_A });

  const req = { params: { sessionId: String(SESSION_ID) }, instructor: { id: String(INSTRUCTOR_A) } };
  const { nextCalled } = await run(loadOwnedSession, req);

  assert.equal(nextCalled, true);
  assert.ok(req.classSession, "handlers read req.classSession, avoiding the express-session name");
  assert.ok(req.batch, "the batch is needed to scope the attendance roster whitelist");
});

test("loadOwnedSession 404s a session that does not exist", async () => {
  Session.findById = () => Promise.resolve(null);
  const req = { params: { sessionId: String(SESSION_ID) }, instructor: { id: String(INSTRUCTOR_A) } };
  const { res, nextCalled } = await run(loadOwnedSession, req);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
});

// ── loadOwnedMaterial ─────────────────────────────────────────────────────────

test("loadOwnedMaterial filters by owner and excludes soft-deleted rows", async () => {
  let observedQuery = null;
  CourseMaterial.findOne = (q) => { observedQuery = q; return Promise.resolve({ _id: MATERIAL_ID }); };

  const req = { params: { id: String(MATERIAL_ID) }, instructor: { id: String(INSTRUCTOR_A) } };
  const { nextCalled } = await run(loadOwnedMaterial, req);

  assert.equal(nextCalled, true);
  assert.equal(String(observedQuery.instructorId), String(INSTRUCTOR_A));
  assert.equal(observedQuery.deletedAt, null, "a removed material must not be downloadable");
});

test("loadOwnedMaterial 404s another instructor's material", async () => {
  CourseMaterial.findOne = () => Promise.resolve(null);
  const req = { params: { id: String(MATERIAL_ID) }, instructor: { id: String(INSTRUCTOR_B) } };
  const { res, nextCalled } = await run(loadOwnedMaterial, req);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
});

// ── resolveOwnedBatchFromBody ─────────────────────────────────────────────────

test("a body-supplied batchId is only honoured after an ownership check", async () => {
  let observedQuery = null;
  Batch.findOne = (q) => { observedQuery = q; return Promise.resolve(null); };

  const result = await resolveOwnedBatchFromBody(String(BATCH_ID), String(INSTRUCTOR_B));

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(String(observedQuery.instructorId), String(INSTRUCTOR_B));
});

test("an absent batchId means course-wide scope, not an error", async () => {
  const result = await resolveOwnedBatchFromBody(undefined, String(INSTRUCTOR_A));
  assert.deepEqual(result, { ok: true, batch: null });
});

test("a malformed body batchId is rejected without a query", async () => {
  let queried = false;
  Batch.findOne = () => { queried = true; return Promise.resolve(null); };
  const result = await resolveOwnedBatchFromBody("bogus", String(INSTRUCTOR_A));
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(queried, false);
});
