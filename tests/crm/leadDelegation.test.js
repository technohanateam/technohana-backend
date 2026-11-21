import { test } from "node:test";
import assert from "node:assert/strict";
import { canAssignLeadTo, userOptionsFilter } from "../../src/utils/crmQuery.js";

const req = (crmRole, extra = {}) => ({ admin: { _id: "a1", crmRole, ...extra } });

test("admin can assign to anyone", () => {
  assert.equal(canAssignLeadTo(req("admin"), "zzz"), true);
});

test("pool lead can assign to self and pool only", () => {
  const r = req("sales", { poolLead: true, teamIds: ["h1"] });
  assert.equal(canAssignLeadTo(r, "a1"), true);
  assert.equal(canAssignLeadTo(r, "h1"), true);
  assert.equal(canAssignLeadTo(r, "mufiza"), false);
});

test("plain sales rep cannot assign", () => {
  assert.equal(canAssignLeadTo(req("sales", { teamIds: ["h1"] }), "h1"), false);
});

test("team options hide other reps from pool leads", () => {
  const f = userOptionsFilter(req("sales", { poolLead: true, teamIds: ["h1"] }));
  assert.deepEqual(f.$or[1], { _id: { $in: ["a1", "h1"] } });
  assert.deepEqual(userOptionsFilter(req("admin")), { active: true });
});
