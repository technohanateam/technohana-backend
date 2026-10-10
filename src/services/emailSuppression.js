import crypto from "crypto";
import Subscription from "../models/subscription.model.js";

// Marketing suppression list. A Subscription doc with isActive:false means
// "never send marketing email here": unsubscribes (/unsubscribe link or
// one-click header), complaints and hard bounces all land here (see
// resendWebhook.js), and every marketing send path — campaigns, drips,
// newsletter — filters recipients through it. Transactional mail (receipts,
// password resets) is unaffected.

const CASE_INSENSITIVE = { locale: "en", strength: 2 };
const UNSUBSCRIBE_MAILTO = "<mailto:unsubscribe@technohana.in?subject=unsubscribe>";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const signEmail = (email) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(normalizeEmail(email)).digest("hex").slice(0, 32);

export const verifyUnsubscribeToken = (email, token) => {
  if (!email || typeof token !== "string") return false;
  const expected = Buffer.from(signEmail(email));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

// BASE_URL is the backend's public origin (also used for the Google OAuth
// callback). The link must hit the backend, not the static frontend, because
// RFC 8058 one-click unsubscribe is a POST from the mailbox provider.
export const buildUnsubscribeUrl = (email) => {
  if (!process.env.BASE_URL) return null;
  const params = new URLSearchParams({ e: normalizeEmail(email), t: signEmail(email) });
  return `${process.env.BASE_URL.replace(/\/$/, "")}/unsubscribe?${params}`;
};

// Appends a visible unsubscribe footer and returns the List-Unsubscribe
// headers Gmail/Yahoo require from bulk senders.
export const withUnsubscribe = (html, email) => {
  const url = buildUnsubscribeUrl(email);
  if (!url) return { html, headers: { "List-Unsubscribe": UNSUBSCRIBE_MAILTO } };

  const footer =
    `<p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center;font-family:Arial,sans-serif;">` +
    `Don't want these emails? <a href="${url}" style="color:#94a3b8;">Unsubscribe</a></p>`;
  const body = html || "";
  return {
    html: /<\/body>/i.test(body) ? body.replace(/<\/body>/i, () => `${footer}</body>`) : body + footer,
    headers: {
      "List-Unsubscribe": `<${url}>, ${UNSUBSCRIBE_MAILTO}`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
};

export const getSuppressedSet = async (emails) => {
  const list = [...new Set(emails.filter(Boolean).map(normalizeEmail))];
  if (list.length === 0) return new Set();
  const docs = await Subscription.find({ email: { $in: list }, isActive: false }, { email: 1 })
    .collation(CASE_INSENSITIVE)
    .lean();
  return new Set(docs.map((d) => normalizeEmail(d.email)));
};

export const filterSuppressed = async (recipients) => {
  const suppressed = await getSuppressedSet(recipients.map((r) => r.email));
  return recipients.filter((r) => r.email && !suppressed.has(normalizeEmail(r.email)));
};

export const isSuppressed = async (email) => (await getSuppressedSet([email])).size > 0;

export const suppressEmail = async (email, reason) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  try {
    await Subscription.updateOne(
      { email: normalized },
      {
        $set: { isActive: false, unsubscribedAt: new Date(), unsubscribeReason: reason },
        $setOnInsert: { subscribeTo: "" },
      },
      { upsert: true, collation: CASE_INSENSITIVE }
    );
  } catch (err) {
    // Two webhook events for the same address can race the upsert; the loser
    // hits the unique index, and the winner has already suppressed it.
    if (err.code !== 11000) throw err;
  }
};
