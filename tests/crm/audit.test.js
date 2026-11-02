import { test, mock } from "node:test";
import assert from "node:assert/strict";

const created = [];
mock.module("../../src/models/crm/auditLog.model.js", {
  defaultExport: { create: async (doc) => { created.push(doc); } },
});

const { buildAuditEntry, crmAudit } = await import("../../src/middleware/crmAudit.js");
const { hasCrmPermission } = await import("../../src/middleware/crmPermission.js");

const reqOf = (over = {}) => ({
  method: "PUT",
  baseUrl: "/api/crm",
  path: "/leads/65f1c2a4e4b0a1b2c3d4e5f6",
  body: { name: "A", password: "secret-value" },
  admin: { uid: "u1", crmRole: "sales" },
  ip: "1.2.3.4",
  get: () => "jest",
  ...over,
});

test("audit entry stores field names but never values", () => {
  const e = buildAuditEntry(reqOf(), 200);
  assert.equal(e.resource, "leads");
  assert.equal(e.resourceId, "65f1c2a4e4b0a1b2c3d4e5f6");
  assert.deepEqual(e.changedFields, ["name", "password"]);
  assert.ok(!JSON.stringify(e).includes("secret-value"));
});

test("crmAudit logs successful writes and skips reads and failures", async () => {
  created.length = 0;
  const run = (req, status) => {
    let finish;
    const res = { statusCode: status, on: (_e, cb) => { finish = cb; } };
    crmAudit(req, res, () => {});
    finish?.();
  };
  run(reqOf({ method: "GET" }), 200);
  run(reqOf(), 500);
  run(reqOf(), 200);
  await new Promise((r) => setImmediate(r));
  assert.equal(created.length, 1);
});

test("new resources are restricted", () => {
  assert.equal(hasCrmPermission("admin", "exec"), true);
  assert.equal(hasCrmPermission("sales", "exec"), false);
  assert.equal(hasCrmPermission("readonly", "audit"), false);
  assert.equal(hasCrmPermission("sales", "kpi", "read"), true);
  assert.equal(hasCrmPermission("sales", "kpi", "write"), false);
});
