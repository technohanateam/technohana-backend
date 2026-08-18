import { test } from "node:test";
import assert from "node:assert/strict";
import { requirePage } from "../../src/middleware/authenticateAdmin.js";
import { ADMIN_PAGES, DEFAULT_PAGES_BY_ROLE } from "../../src/constants/adminPages.js";

function makeReq(pages) {
  return { admin: { pages } };
}

function makeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function callsNext(pages, guard) {
  const req = makeReq(pages);
  const res = makeRes();
  let called = false;
  guard(req, res, () => { called = true; });
  return { called, res };
}

// Phase 3 permission matrix — GET /admin/blogs uses requirePage("blogs", "content-factory-blogs");
// Blog write routes are untouched and still use requirePage("blogs") only.
const blogsReadGuard = requirePage("blogs", "content-factory-blogs");
const blogsWriteGuard = requirePage("blogs");

test("A: pages=['blogs'] — Blogs read ALLOWED, Blog write ALLOWED", () => {
  assert.equal(callsNext(["blogs"], blogsReadGuard).called, true);
  assert.equal(callsNext(["blogs"], blogsWriteGuard).called, true);
});

test("B: pages=['content-factory'] — Blogs read DENIED, Blog write DENIED", () => {
  const read = callsNext(["content-factory"], blogsReadGuard);
  assert.equal(read.called, false);
  assert.equal(read.res.statusCode, 403);

  const write = callsNext(["content-factory"], blogsWriteGuard);
  assert.equal(write.called, false);
  assert.equal(write.res.statusCode, 403);
});

test("C: pages=['content-factory-blogs'] — Blogs read ALLOWED, Blog write DENIED", () => {
  assert.equal(callsNext(["content-factory-blogs"], blogsReadGuard).called, true);
  const write = callsNext(["content-factory-blogs"], blogsWriteGuard);
  assert.equal(write.called, false);
  assert.equal(write.res.statusCode, 403);
});

test("D: pages=['content-factory','content-factory-blogs'] — Blogs read ALLOWED, Blog write DENIED", () => {
  assert.equal(callsNext(["content-factory", "content-factory-blogs"], blogsReadGuard).called, true);
  assert.equal(callsNext(["content-factory", "content-factory-blogs"], blogsWriteGuard).called, false);
});

test("E: pages=['blogs','content-factory'] — Blogs read ALLOWED, Blog write ALLOWED", () => {
  assert.equal(callsNext(["blogs", "content-factory"], blogsReadGuard).called, true);
  assert.equal(callsNext(["blogs", "content-factory"], blogsWriteGuard).called, true);
});

test("pages=[] (neither) — Blogs read DENIED, Blog write DENIED", () => {
  assert.equal(callsNext([], blogsReadGuard).called, false);
  assert.equal(callsNext([], blogsWriteGuard).called, false);
});

test("content-factory-blogs is registered in the canonical ADMIN_PAGES list", () => {
  assert.ok(ADMIN_PAGES.includes("content-factory-blogs"));
});

test("content-factory-blogs is NOT automatically granted to any non-admin default role", () => {
  // admin/super_admin intentionally spread the entire ADMIN_PAGES list
  // (pre-existing behavior, unchanged) — every other role must not get the
  // new key by default; it must be explicitly assigned via extraPages.
  for (const role of Object.keys(DEFAULT_PAGES_BY_ROLE)) {
    if (role === "admin" || role === "super_admin") continue;
    assert.ok(
      !DEFAULT_PAGES_BY_ROLE[role].includes("content-factory-blogs"),
      `role "${role}" must not default-include content-factory-blogs`
    );
  }
});

test("existing 'blogs' and 'content-factory' defaults are unchanged by the new key (admin/super_admin still get everything, marketing keeps its existing set)", () => {
  assert.ok(DEFAULT_PAGES_BY_ROLE.admin.includes("blogs"));
  assert.ok(DEFAULT_PAGES_BY_ROLE.admin.includes("content-factory"));
  assert.ok(DEFAULT_PAGES_BY_ROLE.super_admin.includes("blogs"));
  assert.ok(DEFAULT_PAGES_BY_ROLE.super_admin.includes("content-factory"));
  assert.ok(DEFAULT_PAGES_BY_ROLE.marketing.includes("content-factory"));
  // Pre-existing issue, confirmed present and intentionally NOT fixed in Phase 3:
  // backend marketing defaults do not include "blogs" (frontend's do) — see report.
  assert.ok(!DEFAULT_PAGES_BY_ROLE.marketing.includes("blogs"));
});
