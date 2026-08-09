import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import SeoTopicCluster from "../../src/models/seoTopicCluster.model.js";
import { Blogs } from "../../src/models/blogs.model.js";
import SeoAuditLog from "../../src/models/seoAuditLog.model.js";
import { createCluster, updateCluster, deleteCluster, suggestClusterMembers } from "../../src/controllers/seoTopicCluster.controller.js";

function makeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

beforeEach(() => {
  mock.restoreAll();
  mock.method(SeoAuditLog, "create", async () => ({}));
});

test("createCluster requires name and pillarCategory", async () => {
  const req = { body: {}, admin: {} };
  const res = makeRes();
  await createCluster(req, res);
  assert.equal(res.statusCode, 400);
});

test("createCluster rejects a duplicate slug", async () => {
  mock.method(SeoTopicCluster, "findOne", async () => ({ _id: "existing" }));
  const req = { body: { name: "Generative AI", pillarCategory: "genai" }, admin: {} };
  const res = makeRes();
  await createCluster(req, res);
  assert.equal(res.statusCode, 409);
});

test("createCluster persists a new cluster", async () => {
  mock.method(SeoTopicCluster, "findOne", async () => null);
  mock.method(SeoTopicCluster, "create", async (doc) => ({ _id: "c1", ...doc }));
  const req = { body: { name: "Generative AI", pillarCategory: "genai" }, admin: {} };
  const res = makeRes();
  await createCluster(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.name, "Generative AI");
});

test("updateCluster only writes editable fields", async () => {
  const doc = { _id: "c1", name: "Old", pillarCategory: "genai", save: async function () { return this; } };
  mock.method(SeoTopicCluster, "findById", async () => doc);
  const req = { params: { id: "c1" }, body: { name: "New Name", notAField: "ignored" }, admin: {} };
  const res = makeRes();
  await updateCluster(req, res);
  assert.equal(res.body.success, true);
  assert.equal(doc.name, "New Name");
  assert.equal(doc.notAField, undefined);
});

test("deleteCluster 404s on an unknown id", async () => {
  mock.method(SeoTopicCluster, "findByIdAndDelete", async () => null);
  const req = { params: { id: "missing" }, admin: {} };
  const res = makeRes();
  await deleteCluster(req, res);
  assert.equal(res.statusCode, 404);
});

test("suggestClusterMembers excludes already-included blogs and non-matching categories", async () => {
  mock.method(SeoTopicCluster, "findById", () => ({
    lean: async () => ({ _id: "c1", pillarCategory: "genai", blogIds: ["already-in"] }),
  }));
  mock.method(Blogs, "find", () => ({
    limit: () => ({
      lean: async () => [
        { _id: "already-in", title: "Existing member", category: "GenAI", tags: [] },
        { _id: "match1", title: "Prompt Engineering 101", category: "GenAI Training", tags: [] },
        { _id: "nomatch1", title: "Payroll Tips", category: "HR", tags: ["hr"] },
      ],
    }),
  }));
  const req = { params: { id: "c1" } };
  const res = makeRes();
  await suggestClusterMembers(req, res);

  const suggestedIds = res.body.data.suggestedBlogs.map((b) => b.blogId);
  assert.ok(!suggestedIds.includes("already-in"));
  assert.ok(suggestedIds.includes("match1"));
  assert.ok(!suggestedIds.includes("nomatch1"));
});
