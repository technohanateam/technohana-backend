import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import AdminUser from "../../src/models/adminUser.model.js";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../../src/middleware/authenticateAdmin.js";

process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "test-secret-for-authenticateAdmin-tests";

function makeReq(payload, baseUrl = "/admin") {
  const token = jwt.sign(payload, process.env.ADMIN_JWT_SECRET, { expiresIn: "1h" });
  return { headers: { authorization: `Bearer ${token}` }, baseUrl, ip: "127.0.0.1" };
}

function makeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

beforeEach(() => {
  mock.restoreAll();
});

test("Phase 6: analyst role can pass authenticateAdmin and requirePage on /admin/*", async () => {
  const req = makeReq({ role: "analyst", pages: ["seo-ops-dashboard"] });
  const res = makeRes();
  let nextCalled = false;
  await authenticateAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, "analyst should reach next() through authenticateAdmin");
  assert.equal(res.statusCode, undefined);

  let pageNextCalled = false;
  requirePage("seo-ops-dashboard")(req, res, () => { pageNextCalled = true; });
  assert.equal(pageNextCalled, true, "analyst with the right page grant should pass requirePage");
});

test("Phase 6: analyst role is blocked by requireMarketing and requireAdmin (read-only enforcement)", () => {
  const req = { admin: { role: "analyst" } };

  const res1 = makeRes();
  let called1 = false;
  requireMarketing(req, res1, () => { called1 = true; });
  assert.equal(called1, false);
  assert.equal(res1.statusCode, 403);

  const res2 = makeRes();
  let called2 = false;
  requireAdmin(req, res2, () => { called2 = true; });
  assert.equal(called2, false);
  assert.equal(res2.statusCode, 403);
});

test("Regression: sales role remains fully blocked from /admin/*", async () => {
  const req = makeReq({ role: "sales", pages: [] });
  const res = makeRes();
  let nextCalled = false;
  await authenticateAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, "sales must never reach next() on /admin/*");
  assert.equal(res.statusCode, 403);
});

test("Regression: a CRM-only crmRole remains blocked from /admin/* regardless of legacy role", async () => {
  const req = makeReq({ role: "admin", crmRole: "readonly", pages: ["overview"] });
  const res = makeRes();
  let nextCalled = false;
  await authenticateAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("Regression: admin role is unaffected by the ADMIN_PANEL_ROLES change", async () => {
  const req = makeReq({ role: "admin", pages: ["overview"] });
  const res = makeRes();
  let nextCalled = false;
  await authenticateAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test("Deactivated DB-backed analyst account is blocked even with a valid token", async () => {
  mock.method(AdminUser, "findById", () => ({ select: () => ({ lean: async () => ({ active: false }) }) }));
  const req = makeReq({ role: "analyst", uid: "someid", pages: ["seo-ops-dashboard"] });
  const res = makeRes();
  let nextCalled = false;
  await authenticateAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
