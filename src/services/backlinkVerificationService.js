import * as cheerio from "cheerio";
import SeoMonitoring from "../models/seoMonitoring.model.js";
import SeoAlert from "../models/seoAlert.model.js";
import SeoContact from "../models/seoContact.model.js";
import SeoSettings from "../models/seoSettings.model.js";
import SeoIntelligenceSettings from "../models/seoIntelligenceSettings.model.js";
import { isFetchAllowed } from "../utils/robotsCache.js";
import { throttledFetch } from "../utils/domainRateLimiter.js";
import { sendEmail } from "../config/emailService.js";
import { generateBacklinkAlertEmail } from "../utils/emailTemplate.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

const DEFAULT_VERIFICATION_SETTINGS = {
  rateLimitMs: 3000,
  userAgent: "TechnohanaBacklinkBot/1.0 (+https://technohana.com/bot)",
  requestTimeoutMs: 10000,
  maxRedirects: 5,
};

async function getVerificationSettings() {
  const settings = await SeoSettings.findOne().lean();
  return { ...DEFAULT_VERIFICATION_SETTINGS, ...(settings?.backlinkVerification || {}) };
}

// Compares href against the recorded target page by host+path, tolerant of a
// trailing slash and relative/absolute protocol differences.
export function isSameTargetLink(href, targetUrl) {
  if (!href || !targetUrl) return false;
  try {
    const a = new URL(href, targetUrl);
    const b = new URL(targetUrl);
    const normalize = (u) => `${u.host}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
    return normalize(a) === normalize(b);
  } catch {
    return false;
  }
}

// Parses a fetched HTML body for the first <a> tag pointing at targetUrl,
// returning its visible text and whether it carries rel="nofollow".
export function findLinkInHtml(html, targetUrl) {
  const $ = cheerio.load(html || "");
  let found = null;
  $("a").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href");
    if (isSameTargetLink(href, targetUrl)) {
      const rel = ($(el).attr("rel") || "").toLowerCase();
      found = { text: $(el).text().trim(), dofollow: !rel.includes("nofollow") };
    }
  });
  return found;
}

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function createAlertIfNew({ type, severity, title, description, relatedUrl }) {
  const cutoff = new Date(Date.now() - ALERT_COOLDOWN_MS);
  const existing = await SeoAlert.findOne({
    type,
    relatedUrl,
    acknowledged: false,
    triggeredAt: { $gte: cutoff },
  });
  if (existing) return null;

  const alert = await SeoAlert.create({ type, severity, title, description, relatedUrl });

  try {
    const intelSettings = await SeoIntelligenceSettings.findOne().lean();
    if (intelSettings?.alertEmailRecipients?.length) {
      await sendEmail({
        from: "SEO Alerts <corporate@technohana.in>",
        to: intelSettings.alertEmailRecipients,
        subject: `[Backlink Alert] ${title}`,
        html: generateBacklinkAlertEmail({
          website: relatedUrl,
          liveUrl: relatedUrl,
          alertType: type,
          description,
          dashboardLink: `${process.env.FRONTEND_URL || ""}/admin/seo/monitoring`,
        }),
      });
      alert.emailSent = true;
      await alert.save();
    }
  } catch (err) {
    console.error("[Backlink Verification] alert email failed:", err.message);
  }

  return alert;
}

// Verifies a single SeoMonitoring record by fetching its liveUrl (robots.txt
// respecting, rate-limited) and diffing the observed state against what's
// stored. Creates a SeoAlert only on a genuine state transition (not on every
// re-check of an unchanged link). Mutates and saves `record`.
export async function verifyMonitoringRecord(record) {
  const cfg = await getVerificationSettings();
  const alertsCreated = [];
  const previousStatus = record.linkStatus;
  const previousDofollow = record.dofollow;
  const previousAnchor = record.anchorTextObserved;
  const previousRedirectedTo = record.redirectedTo;

  const finish = async (patch) => {
    Object.assign(record, patch, { lastChecked: new Date(), verificationMethod: "automated-fetch" });
    if (patch.lastVerificationError) {
      record.consecutiveFailedChecks = (record.consecutiveFailedChecks || 0) + 1;
    } else {
      record.consecutiveFailedChecks = 0;
    }
    await record.save();
    return { record, alertsCreated };
  };

  if (!record.liveUrl) {
    return finish({ lastVerificationError: "No liveUrl set — cannot verify" });
  }

  const allowed = await isFetchAllowed(record.liveUrl, cfg.userAgent);
  if (!allowed) {
    return finish({ lastVerificationError: "Blocked by robots.txt" });
  }

  let response;
  try {
    response = await throttledFetch(
      record.liveUrl,
      { headers: { "User-Agent": cfg.userAgent }, timeout: cfg.requestTimeoutMs, maxRedirects: cfg.maxRedirects },
      { minIntervalMs: cfg.rateLimitMs }
    );
  } catch (err) {
    await finish({ linkStatus: "broken", lastVerificationError: err.message });
    if (previousStatus !== "broken" && previousStatus !== "lost") {
      alertsCreated.push(
        await createAlertIfNew({
          type: "backlink_lost",
          severity: "warning",
          title: `Backlink unreachable: ${record.website}`,
          description: err.message,
          relatedUrl: record.liveUrl,
        })
      );
    }
    return { record, alertsCreated: alertsCreated.filter(Boolean) };
  }

  const finalUrl = response.request?.res?.responseUrl || response.config?.url;
  const redirectedTo = finalUrl && finalUrl !== record.liveUrl ? finalUrl : undefined;

  if (response.status >= 400) {
    await finish({
      linkStatus: "broken",
      httpStatus: response.status,
      redirectedTo,
      lastVerificationError: `HTTP ${response.status}`,
    });
    if (previousStatus !== "broken") {
      alertsCreated.push(
        await createAlertIfNew({
          type: "backlink_lost",
          severity: "warning",
          title: `Backlink broken (HTTP ${response.status}): ${record.website}`,
          description: `${record.liveUrl} returned HTTP ${response.status}`,
          relatedUrl: record.liveUrl,
        })
      );
    }
    return { record, alertsCreated: alertsCreated.filter(Boolean) };
  }

  const found = findLinkInHtml(response.data, record.targetPage);

  if (!found) {
    await finish({
      linkStatus: "lost",
      httpStatus: response.status,
      redirectedTo,
      lastVerificationError: undefined,
    });
    if (previousStatus !== "lost") {
      alertsCreated.push(
        await createAlertIfNew({
          type: "backlink_lost",
          severity: "critical",
          title: `Backlink removed: ${record.website}`,
          description: `The link to ${record.targetPage} is no longer present on ${record.liveUrl}`,
          relatedUrl: record.liveUrl,
        })
      );
      if (record.opportunityId) {
        await SeoContact.updateMany({ opportunityId: record.opportunityId }, { $set: { status: "lost-link" } });
      }
    }
    return { record, alertsCreated: alertsCreated.filter(Boolean) };
  }

  const anchorTextChanged = Boolean(previousAnchor) && previousAnchor !== found.text;
  await finish({
    linkStatus: "live",
    httpStatus: response.status,
    redirectedTo,
    dofollow: found.dofollow,
    anchorTextObserved: found.text,
    anchorTextChanged,
    lastVerificationError: undefined,
  });

  if (anchorTextChanged) {
    alertsCreated.push(
      await createAlertIfNew({
        type: "backlink_anchor_changed",
        severity: "info",
        title: `Anchor text changed: ${record.website}`,
        description: `Was "${previousAnchor}", now "${found.text}"`,
        relatedUrl: record.liveUrl,
      })
    );
  }
  if (previousDofollow === true && found.dofollow === false) {
    alertsCreated.push(
      await createAlertIfNew({
        type: "backlink_nofollow_changed",
        severity: "warning",
        title: `Link switched to nofollow: ${record.website}`,
        description: `${record.liveUrl} now marks the link rel="nofollow"`,
        relatedUrl: record.liveUrl,
      })
    );
  }
  // Only alert on a genuinely new/changed redirect, not on every re-check of
  // an already-known, unchanged redirect (which would otherwise re-alert on
  // every weekly run for the lifetime of a permanently redirected link).
  if (redirectedTo && redirectedTo !== previousRedirectedTo) {
    alertsCreated.push(
      await createAlertIfNew({
        type: "backlink_redirect_detected",
        severity: "info",
        title: `Redirect detected: ${record.website}`,
        description: `${record.liveUrl} now redirects to ${redirectedTo}`,
        relatedUrl: record.liveUrl,
      })
    );
  }

  return { record, alertsCreated: alertsCreated.filter(Boolean) };
}

// Finds monitoring records due for a check and verifies each, grouped and
// throttled per-hostname via the shared rate limiter (sequential within a
// hostname, so bursts to one domain never happen even across records).
export async function runVerificationBatch({ ids, staleBeforeHours = 24 * 7 } = {}) {
  const staleCutoff = new Date(Date.now() - staleBeforeHours * 60 * 60 * 1000);
  const filter = ids?.length
    ? { _id: { $in: ids } }
    : {
        linkStatus: { $in: ["live", "published", "pending-verification"] },
        $or: [{ lastChecked: null }, { lastChecked: { $lt: staleCutoff } }],
      };

  const records = await SeoMonitoring.find(filter);
  const summary = { checked: 0, live: 0, lost: 0, broken: 0, anchorChanged: 0, errors: 0 };

  for (const record of records) {
    try {
      const { alertsCreated } = await verifyMonitoringRecord(record);
      summary.checked += 1;
      if (record.linkStatus === "live") summary.live += 1;
      if (record.linkStatus === "lost") summary.lost += 1;
      if (record.linkStatus === "broken") summary.broken += 1;
      if (alertsCreated.some((a) => a.type === "backlink_anchor_changed")) summary.anchorChanged += 1;
    } catch (err) {
      console.error(`[Backlink Verification] failed for ${record.liveUrl}:`, err.message);
      summary.errors += 1;
    }
  }

  await logSeoAudit({ admin: { email: "system" }, ip: "system" }, "monitoring.verification_run", "SeoMonitoring", null, summary);
  return summary;
}
