import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_PAGES,
  DEFAULT_PAGES_BY_ROLE,
  computeEffectivePages,
  splitAbsolutePages,
} from "../../src/constants/adminPages.js";

const ROLES_WITH_PANEL_ACCESS = Object.keys(DEFAULT_PAGES_BY_ROLE);

const roundTrip = (role, pages) => {
  const { extraPages, revokedPages } = splitAbsolutePages(role, pages);
  return computeEffectivePages(role, extraPages, revokedPages).sort();
};

// The bug this guards: the Team UI used to diff the ticked boxes against its own
// copy of DEFAULT_PAGES_BY_ROLE, so any page the two registries disagreed on was
// saved as neither an extra nor a revocation — silently granting nothing.
test("an absolute page list survives the split/recompute round trip for every role", () => {
  for (const role of ROLES_WITH_PANEL_ACCESS) {
    const wanted = ["overview", "team", "coupons"];
    assert.deepEqual(roundTrip(role, wanted), [...wanted].sort(), `role: ${role}`);
  }
});

test("a page a role does not get by default is granted when ticked", () => {
  assert.ok(!DEFAULT_PAGES_BY_ROLE.marketing.includes("blogs"));
  const effective = roundTrip("marketing", [...DEFAULT_PAGES_BY_ROLE.marketing, "blogs"]);
  assert.ok(effective.includes("blogs"));
});

test("a role-default page is revoked when unticked", () => {
  const withoutCampaigns = DEFAULT_PAGES_BY_ROLE.marketing.filter((p) => p !== "campaigns");
  assert.ok(!roundTrip("marketing", withoutCampaigns).includes("campaigns"));
});

test("granting every page then revoking all of them leaves no access", () => {
  assert.deepEqual(roundTrip("analyst", []), []);
  assert.deepEqual(roundTrip("admin", []), []);
});

test("unknown page keys never survive into effective access", () => {
  const effective = roundTrip("analyst", ["seo-ops-dashboard", "not-a-real-page"]);
  assert.deepEqual(effective, ["seo-ops-dashboard"]);
});

test("every role default is a registered page key", () => {
  for (const [role, pages] of Object.entries(DEFAULT_PAGES_BY_ROLE)) {
    const unknown = pages.filter((page) => !ADMIN_PAGES.includes(page));
    assert.deepEqual(unknown, [], `role ${role} defaults to unregistered pages`);
  }
});

test("duplicate keys in the requested list do not produce duplicate access", () => {
  const effective = roundTrip("admin", ["overview", "overview", "team"]);
  assert.deepEqual(effective, ["overview", "team"]);
});
