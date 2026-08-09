import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Author from "../../src/models/author.model.js";
import { createAuthor, updateAuthor, deleteAuthor } from "../../src/controllers/author.controller.js";

function makeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

beforeEach(() => {
  mock.restoreAll();
});

test("createAuthor requires a name", async () => {
  const req = { body: {} };
  const res = makeRes();
  await createAuthor(req, res);
  assert.equal(res.statusCode, 400);
});

test("createAuthor rejects a duplicate name/slug", async () => {
  mock.method(Author, "findOne", async () => ({ _id: "existing" }));
  const req = { body: { name: "Jane Doe" } };
  const res = makeRes();
  await createAuthor(req, res);
  assert.equal(res.statusCode, 409);
});

test("createAuthor persists a new author with defaults for optional fields", async () => {
  mock.method(Author, "findOne", async () => null);
  mock.method(Author, "create", async (doc) => ({ _id: "a1", ...doc }));
  const req = { body: { name: "Jane Doe", bio: "AI trainer" } };
  const res = makeRes();
  await createAuthor(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.name, "Jane Doe");
  assert.deepEqual(res.body.data.expertise, []);
});

test("updateAuthor 404s on an unknown id", async () => {
  mock.method(Author, "findById", async () => null);
  const req = { params: { id: "missing" }, body: {} };
  const res = makeRes();
  await updateAuthor(req, res);
  assert.equal(res.statusCode, 404);
});

test("updateAuthor writes only whitelisted fields", async () => {
  const doc = { name: "Old Name", save: async function () { return this; } };
  mock.method(Author, "findById", async () => doc);
  const req = { params: { id: "a1" }, body: { name: "New Name", isReviewer: true, notAField: "x" } };
  const res = makeRes();
  await updateAuthor(req, res);
  assert.equal(doc.name, "New Name");
  assert.equal(doc.isReviewer, true);
  assert.equal(doc.notAField, undefined);
});

test("deleteAuthor 404s on an unknown id", async () => {
  mock.method(Author, "findByIdAndDelete", async () => null);
  const req = { params: { id: "missing" } };
  const res = makeRes();
  await deleteAuthor(req, res);
  assert.equal(res.statusCode, 404);
});
