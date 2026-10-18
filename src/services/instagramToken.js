// Keeps the Instagram long-lived token (60 days) alive: a daily job refreshes it
// before it expires and stores the new one encrypted in MongoDB. INSTAGRAM_ACCESS_TOKEN
// in the env is the seed; a different env token (pasted by hand) always wins.
import crypto from "crypto";
import IntegrationToken from "../models/integrationToken.model.js";
import { encryptToken, decryptToken } from "../utils/tokenCrypto.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { getDailyReportRecipients } from "./crmDailyReport.js";

const KEY = "instagram";
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_WHEN_LEFT_MS = 20 * DAY_MS;
const ALERT_WHEN_LEFT_MS = 10 * DAY_MS;
const ALERT_AFTER_FAILURES = 2;
const CACHE_MS = 60 * 1000;

let cache = null;

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Token to use for Instagram API calls: the stored refreshed one, else the env seed.
export async function getInstagramToken() {
  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.token;

  let token = envToken;
  try {
    const doc = await IntegrationToken.findOne({ key: KEY }).lean();
    if (doc?.tokenEncrypted && (!envToken || doc.seedHash === hash(envToken))) token = decryptToken(doc.tokenEncrypted);
  } catch (err) {
    console.error("[instagram-token] could not read stored token, using env:", err.message);
  }
  cache = { token, at: Date.now() };
  return token;
}

async function requestRefresh(token) {
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(body?.error?.message || `Instagram refresh responded ${res.status}`);
  return { token: body.access_token, expiresInMs: Number(body.expires_in) * 1000 };
}

async function alertAdmins(subject, text) {
  const recipients = await getDailyReportRecipients();
  if (!recipients?.length) return false;
  await sendEmail({ from: fromAddresses.sales, to: recipients, subject, text });
  return true;
}

const HOW_TO_FIX = [
  "How to fix it (about 3 minutes):",
  "1. developers.facebook.com > your app > Instagram > API setup with Instagram login > Generate access tokens.",
  "2. Click Generate token for @technohana and copy it.",
  "3. In Railway > backend service > Variables, replace INSTAGRAM_ACCESS_TOKEN with the new token. It redeploys by itself.",
  "The backend picks up the new token automatically and keeps refreshing it from then on.",
].join("\n");

/**
 * Daily check. Refreshes when the stored token has <20 days left (or when we have
 * never refreshed), and emails admins if refreshing keeps failing or expiry is near.
 */
export async function checkInstagramToken() {
  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!envToken) return { skipped: "no INSTAGRAM_ACCESS_TOKEN" };

  const doc = await IntegrationToken.findOne({ key: KEY });
  const seedChanged = doc?.seedHash && doc.seedHash !== hash(envToken);
  const current = doc?.tokenEncrypted && !seedChanged ? doc : null;
  const msLeft = current?.expiresAt ? current.expiresAt.getTime() - Date.now() : null;

  if (current && msLeft > REFRESH_WHEN_LEFT_MS) return { ok: true, daysLeft: Math.floor(msLeft / DAY_MS) };

  try {
    const source = current ? decryptToken(current.tokenEncrypted) : envToken;
    const fresh = await requestRefresh(source);
    await IntegrationToken.findOneAndUpdate({ key: KEY }, {
      key: KEY,
      tokenEncrypted: encryptToken(fresh.token),
      seedHash: hash(envToken),
      expiresAt: new Date(Date.now() + fresh.expiresInMs),
      refreshedAt: new Date(),
      failCount: 0,
      lastError: null,
    }, { upsert: true });
    cache = null;
    console.log(`[instagram-token] refreshed, valid for ${Math.floor(fresh.expiresInMs / DAY_MS)} more days`);
    return { refreshed: true };
  } catch (err) {
    const failCount = (seedChanged ? 0 : doc?.failCount || 0) + 1;
    const nearExpiry = msLeft != null && msLeft < ALERT_WHEN_LEFT_MS;
    const alertedRecently = doc?.lastAlertAt && Date.now() - doc.lastAlertAt.getTime() < DAY_MS;
    console.error(`[instagram-token] refresh failed (${failCount}x):`, err.message);

    let alerted = false;
    if ((failCount >= ALERT_AFTER_FAILURES || nearExpiry) && !alertedRecently) {
      alerted = await alertAdmins(
        "Action needed: Instagram token for comment-to-DM may stop working",
        [
          "The automatic refresh of the Instagram token for @technohana failed.",
          `Reason: ${err.message}`,
          msLeft != null ? `Current token expires in about ${Math.max(0, Math.floor(msLeft / DAY_MS))} days.` : "The current token's expiry is unknown.",
          "",
          "Until this is fixed, comment replies and DMs will stop when the token expires.",
          "",
          HOW_TO_FIX,
        ].join("\n"),
      ).catch((e) => { console.error("[instagram-token] alert email failed:", e.message); return false; });
    }

    await IntegrationToken.findOneAndUpdate({ key: KEY }, {
      key: KEY,
      failCount,
      lastError: err.message.slice(0, 300),
      ...(alerted && { lastAlertAt: new Date() }),
    }, { upsert: true });
    return { failed: true, failCount, alerted };
  }
}
