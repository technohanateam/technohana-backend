import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import SeoAlert from "../../src/models/seoAlert.model.js";
import SeoContact from "../../src/models/seoContact.model.js";
import SeoSettings from "../../src/models/seoSettings.model.js";
import SeoIntelligenceSettings from "../../src/models/seoIntelligenceSettings.model.js";
import { clearRobotsCache } from "../../src/utils/robotsCache.js";
import { clearRateLimiterState } from "../../src/utils/domainRateLimiter.js";
import { verifyMonitoringRecord, findLinkInHtml, isSameTargetLink } from "../../src/services/backlinkVerificationService.js";

const TARGET = "https://technohana.com/courses";
const LIVE_URL = "https://partner.example/blog/post";

const htmlWithLink = (anchorText, relAttr = "") =>
  `<html><body><p>Great course.</p><a href="${TARGET}"${relAttr ? ` rel="${relAttr}"` : ""}>${anchorText}</a></body></html>`;

const htmlWithoutLink = () => `<html><body><p>No mention of it anymore.</p></body></html>`;

function makeRecord(overrides = {}) {
  return {
    website: "partner.example",
    liveUrl: LIVE_URL,
    targetPage: TARGET,
    linkStatus: "live",
    anchorTextObserved: "Explore Courses",
    dofollow: true,
    consecutiveFailedChecks: 0,
    save: async function () {
      return this;
    },
    ...overrides,
  };
}

function mockAxios(mainResponse) {
  mock.method(axios, "get", async (url) => {
    if (url.endsWith("/robots.txt")) {
      return { status: 200, data: "User-agent: *\nAllow: /\n" };
    }
    return mainResponse;
  });
}

beforeEach(() => {
  clearRobotsCache();
  clearRateLimiterState();
  mock.restoreAll();
  mock.method(SeoSettings, "findOne", () => ({ lean: async () => null }));
  mock.method(SeoIntelligenceSettings, "findOne", () => ({ lean: async () => null }));
  mock.method(SeoContact, "updateMany", async () => ({}));
  mock.method(SeoAlert, "findOne", async () => null);
  mock.method(SeoAlert, "create", async (doc) => ({ ...doc, save: async () => {} }));
});

test("findLinkInHtml finds a matching link and reports dofollow by default", () => {
  const found = findLinkInHtml(htmlWithLink("Explore Courses"), TARGET);
  assert.ok(found);
  assert.equal(found.text, "Explore Courses");
  assert.equal(found.dofollow, true);
});

test("findLinkInHtml reports nofollow when rel attribute is present", () => {
  const found = findLinkInHtml(htmlWithLink("Explore Courses", "nofollow"), TARGET);
  assert.equal(found.dofollow, false);
});

test("isSameTargetLink tolerates a trailing slash", () => {
  assert.equal(isSameTargetLink(`${TARGET}/`, TARGET), true);
});

test("unchanged live link: no alert, linkStatus stays live", async () => {
  mockAxios({ status: 200, data: htmlWithLink("Explore Courses") });
  const record = makeRecord();

  const { record: updated, alertsCreated } = await verifyMonitoringRecord(record);

  assert.equal(updated.linkStatus, "live");
  assert.equal(updated.anchorTextChanged, false);
  assert.equal(alertsCreated.length, 0);
});

test("anchor text change is detected and alerted", async () => {
  mockAxios({ status: 200, data: htmlWithLink("New Anchor Text") });
  const record = makeRecord({ anchorTextObserved: "Old Anchor Text" });

  const { record: updated, alertsCreated } = await verifyMonitoringRecord(record);

  assert.equal(updated.anchorTextChanged, true);
  assert.equal(alertsCreated.length, 1);
  assert.equal(alertsCreated[0].type, "backlink_anchor_changed");
});

test("dofollow -> nofollow transition is detected and alerted", async () => {
  mockAxios({ status: 200, data: htmlWithLink("Explore Courses", "nofollow") });
  const record = makeRecord({ dofollow: true });

  const { alertsCreated } = await verifyMonitoringRecord(record);

  assert.ok(alertsCreated.some((a) => a.type === "backlink_nofollow_changed"));
});

test("404 marks the link broken and creates a lost alert", async () => {
  mockAxios({ status: 404, data: "" });
  const record = makeRecord({ linkStatus: "live" });

  const { record: updated, alertsCreated } = await verifyMonitoringRecord(record);

  assert.equal(updated.linkStatus, "broken");
  assert.equal(updated.httpStatus, 404);
  assert.equal(alertsCreated.length, 1);
  assert.equal(alertsCreated[0].type, "backlink_lost");
});

test("link removed from the page (200 but no matching <a>) is marked lost", async () => {
  mockAxios({ status: 200, data: htmlWithoutLink() });
  const record = makeRecord({ linkStatus: "live" });

  const { record: updated, alertsCreated } = await verifyMonitoringRecord(record);

  assert.equal(updated.linkStatus, "lost");
  assert.equal(alertsCreated.length, 1);
  assert.equal(alertsCreated[0].type, "backlink_lost");
});

test("redirect is detected and alerted", async () => {
  mockAxios({
    status: 200,
    data: htmlWithLink("Explore Courses"),
    request: { res: { responseUrl: "https://partner.example/new-location" } },
  });
  const record = makeRecord();

  const { record: updated, alertsCreated } = await verifyMonitoringRecord(record);

  assert.equal(updated.redirectedTo, "https://partner.example/new-location");
  assert.ok(alertsCreated.some((a) => a.type === "backlink_redirect_detected"));
});

test("an already-known, unchanged redirect does not re-alert on every subsequent run", async () => {
  mockAxios({
    status: 200,
    data: htmlWithLink("Explore Courses"),
    request: { res: { responseUrl: "https://partner.example/new-location" } },
  });
  // Simulates a record where a prior run already recorded this exact redirect.
  const record = makeRecord({ redirectedTo: "https://partner.example/new-location" });

  const { alertsCreated } = await verifyMonitoringRecord(record);

  assert.ok(!alertsCreated.some((a) => a.type === "backlink_redirect_detected"));
});

test("a redirect changing to a new target does re-alert", async () => {
  mockAxios({
    status: 200,
    data: htmlWithLink("Explore Courses"),
    request: { res: { responseUrl: "https://partner.example/another-location" } },
  });
  const record = makeRecord({ redirectedTo: "https://partner.example/new-location" });

  const { alertsCreated } = await verifyMonitoringRecord(record);

  assert.ok(alertsCreated.some((a) => a.type === "backlink_redirect_detected"));
});

test("robots.txt disallow skips the fetch entirely and records the reason", async () => {
  mock.method(axios, "get", async (url) => {
    if (url.endsWith("/robots.txt")) {
      return { status: 200, data: "User-agent: *\nDisallow: /blog/\n" };
    }
    throw new Error("should not fetch the disallowed page");
  });
  const record = makeRecord();

  const { record: updated, alertsCreated } = await verifyMonitoringRecord(record);

  assert.equal(updated.lastVerificationError, "Blocked by robots.txt");
  assert.equal(alertsCreated.length, 0);
});

test("re-running against unchanged state does not create a duplicate alert", async () => {
  // First run: link is lost, cooldown check finds nothing yet -> alert created.
  mock.method(SeoAlert, "findOne", async () => null);
  mockAxios({ status: 200, data: htmlWithoutLink() });
  const record = makeRecord({ linkStatus: "lost" }); // already lost from a prior run

  const { alertsCreated } = await verifyMonitoringRecord(record);
  // previousStatus was already "lost", so no *new* transition-triggered alert.
  assert.equal(alertsCreated.length, 0);
});

test("dedup: an existing unacknowledged alert within the cooldown window blocks a new one", async () => {
  mock.method(SeoAlert, "findOne", async () => ({ _id: "existing" }));
  const createCalls = mock.method(SeoAlert, "create", async () => {
    throw new Error("should not be called — an alert already exists");
  });
  mockAxios({ status: 404, data: "" });
  const record = makeRecord({ linkStatus: "live" });

  const { alertsCreated } = await verifyMonitoringRecord(record);

  assert.equal(alertsCreated.length, 0);
  assert.equal(createCalls.mock.callCount(), 0);
});
