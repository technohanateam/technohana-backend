import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PAGES_BY_ROLE, ADMIN_PAGES } from "../../src/constants/adminPages.js";

test("analyst gets read-only view access to the new topic-cluster and internal-link pages", () => {
  assert.ok(DEFAULT_PAGES_BY_ROLE.analyst.includes("seo-topic-clusters"));
  assert.ok(DEFAULT_PAGES_BY_ROLE.analyst.includes("seo-internal-links"));
});

test("analyst is not granted the authors page (content-authorship, not backlink SEO ops)", () => {
  assert.ok(!DEFAULT_PAGES_BY_ROLE.analyst.includes("authors"));
});

test("marketing role has full access to all new SEO authority pages", () => {
  for (const page of ["seo-topic-clusters", "seo-internal-links", "authors"]) {
    assert.ok(DEFAULT_PAGES_BY_ROLE.marketing.includes(page), `marketing should have ${page}`);
  }
});

test("new page keys are registered in the canonical ADMIN_PAGES list", () => {
  for (const page of ["seo-topic-clusters", "seo-internal-links", "authors"]) {
    assert.ok(ADMIN_PAGES.includes(page), `${page} should be in ADMIN_PAGES`);
  }
});
