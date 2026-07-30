import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBacklinkAlertEmail } from "../../src/utils/emailTemplate.js";

test("generateBacklinkAlertEmail escapes HTML in description (scraped third-party anchor text)", () => {
  const html = generateBacklinkAlertEmail({
    website: "partner.example",
    liveUrl: "https://partner.example/post",
    alertType: "backlink_anchor_changed",
    description: 'Was "<img src=x onerror=alert(1)>", now "<script>evil()</script>"',
  });

  assert.ok(!html.includes("<script>evil()"), "raw <script> tag must not appear unescaped");
  assert.ok(!html.includes("<img src=x onerror"), "raw <img onerror> must not appear unescaped");
  assert.ok(html.includes("&lt;script&gt;"), "script tag should be HTML-escaped");
});

test("generateBacklinkAlertEmail escapes HTML in website/liveUrl", () => {
  const html = generateBacklinkAlertEmail({
    website: '<script>alert(1)</script>',
    liveUrl: "https://partner.example/post",
    alertType: "backlink_lost",
    description: "gone",
  });

  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("generateBacklinkAlertEmail renders normally with plain-text inputs", () => {
  const html = generateBacklinkAlertEmail({
    website: "partner.example",
    liveUrl: "https://partner.example/post",
    alertType: "backlink_lost",
    description: "The link is no longer present",
  });

  assert.ok(html.includes("partner.example"));
  assert.ok(html.includes("The link is no longer present"));
});
