import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENROLLMENT_TOKEN_KEY = "test-key-for-zoho-tests";
process.env.ZOHO_CLIENT_ID = "cid";
process.env.ZOHO_CLIENT_SECRET = "secret";
process.env.ZOHO_REDIRECT_URI = "http://localhost:5000/api/crm/zoho/callback";
delete process.env.ZOHO_MEETING_ENABLED;
delete process.env.ZOHO_DC;

const zoho = await import("../../src/config/zohoClient.js");
const { extractEmail } = await import("../../src/services/zohoMailSync.js");
const { sendZohoMail } = await import("../../src/services/zohoService.js");

const realFetch = globalThis.fetch;
let calls;
const mockFetch = (handler) => {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const { status = 200, body = {} } = await handler(String(url), opts);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
};
beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

const connection = (extra = {}) => ({
  _id: `conn-${Math.random()}`,
  encryptedRefreshToken: zoho.encryptRefreshToken("refresh-123"),
  zohoMailAccountId: "999",
  emailAddress: "rep@technohana.in",
  ...extra,
});

test("extractEmail handles display names, escaped brackets and bare addresses", () => {
  assert.equal(extractEmail('Asha K <Asha@Example.com>'), "asha@example.com");
  assert.equal(extractEmail("&quot;Asha&quot; &lt;asha@example.com&gt;"), "asha@example.com");
  assert.equal(extractEmail("  bare@x.in "), "bare@x.in");
  assert.equal(extractEmail(""), "");
});

test("consent URL uses the India DC and Mail-only scopes by default", () => {
  const url = new URL(zoho.buildConsentUrl("state-abc"));
  assert.equal(url.origin, "https://accounts.zoho.in");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-abc");
  const scopes = url.searchParams.get("scope");
  assert.match(scopes, /ZohoMail\.messages\.CREATE/);
  assert.doesNotMatch(scopes, /ZohoMeeting/);
});

test("ZOHO_MEETING_ENABLED adds the Meeting scopes", () => {
  process.env.ZOHO_MEETING_ENABLED = "true";
  try {
    assert.match(zoho.buildConsentUrl("s"), /ZohoMeeting\.meeting\.CREATE/);
  } finally {
    delete process.env.ZOHO_MEETING_ENABLED;
  }
});

test("refresh token round-trips encrypted and is not stored in plain text", () => {
  const c = connection();
  assert.ok(!c.encryptedRefreshToken.includes("refresh-123"));
  assert.equal(zoho.decryptRefreshToken(c), "refresh-123");
});

test("access token is cached across calls", async () => {
  mockFetch((url) => url.includes("/oauth/v2/token")
    ? { body: { access_token: "at-1", expires_in: 3600 } }
    : { body: { data: [] } });
  const c = connection();
  await zoho.zohoFetch(c, "mail", "/api/accounts");
  await zoho.zohoFetch(c, "mail", "/api/accounts");
  assert.equal(calls.filter((x) => x.url.includes("/oauth/v2/token")).length, 1);
  assert.equal(calls.at(-1).opts.headers.Authorization, "Zoho-oauthtoken at-1");
});

test("sendZohoMail posts the expected body and returns the message id", async () => {
  mockFetch((url) => url.includes("/oauth/v2/token")
    ? { body: { access_token: "at-2", expires_in: 3600 } }
    : { body: { data: { messageId: 12345 } } });
  const out = await sendZohoMail(connection(), { to: "lead@x.com", subject: "Hi", html: "<p>Hello</p>" });
  assert.equal(out.messageId, "12345");
  const send = calls.find((x) => x.url.includes("/messages"));
  assert.equal(send.url, "https://mail.zoho.in/api/accounts/999/messages");
  assert.equal(send.opts.method, "POST");
  assert.deepEqual(JSON.parse(send.opts.body), {
    fromAddress: "rep@technohana.in", toAddress: "lead@x.com", subject: "Hi", content: "<p>Hello</p>", mailFormat: "html",
  });
});

test("a 401 from Zoho surfaces as ZohoAuthError", async () => {
  mockFetch((url) => url.includes("/oauth/v2/token")
    ? { body: { access_token: "at-3", expires_in: 3600 } }
    : { status: 401, body: {} });
  await assert.rejects(() => zoho.zohoFetch(connection(), "mail", "/api/accounts"), (e) => e instanceof zoho.ZohoAuthError);
});

test("a non-auth HTTP error carries the status and Zoho's message", async () => {
  mockFetch((url) => url.includes("/oauth/v2/token")
    ? { body: { access_token: "at-4", expires_in: 3600 } }
    : { status: 403, body: { data: { moreInfo: "Plan does not allow API access" } } });
  await assert.rejects(() => zoho.zohoFetch(connection(), "mail", "/api/accounts"), (e) => e.status === 403 && /Plan does not allow/.test(e.message));
});
