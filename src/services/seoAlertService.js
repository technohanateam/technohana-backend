import SeoAlert from "../models/seoAlert.model.js";
import SeoGscMetric from "../models/seoGscMetric.model.js";
import SeoGa4Metric from "../models/seoGa4Metric.model.js";
import SeoIntelligenceSettings from "../models/seoIntelligenceSettings.model.js";
import { sendEmail } from "../config/emailService.js";

async function getSettings() {
  let settings = await SeoIntelligenceSettings.findOne();
  if (!settings) settings = await SeoIntelligenceSettings.create({});
  return settings;
}

async function createAlert(alert) {
  const created = await SeoAlert.create(alert);
  if (created.severity === "critical") {
    const settings = await getSettings();
    if (settings.alertEmailRecipients?.length) {
      try {
        await sendEmail({
          from: "SEO Alerts <corporate@technohana.in>",
          to: settings.alertEmailRecipients,
          subject: `[SEO Alert] ${created.title}`,
          html: `<p>${created.description || created.title}</p>`,
        });
        created.emailSent = true;
        await created.save();
      } catch (err) {
        console.error("[SeoAlert] failed to send alert email:", err.message);
      }
    }
  }
  return created;
}

function sumMetric(rows, field) {
  return rows.reduce((sum, r) => sum + (r[field] || 0), 0);
}

export async function checkGscAlerts(propertyId) {
  const settings = await getSettings();
  const now = new Date();
  const recentStart = new Date(now - 7 * 86400000);
  const priorStart = new Date(now - 14 * 86400000);

  const recent = await SeoGscMetric.find({ propertyId, dimensionType: "date", date: { $gte: recentStart } }).lean();
  const prior = await SeoGscMetric.find({ propertyId, dimensionType: "date", date: { $gte: priorStart, $lt: recentStart } }).lean();

  const recentClicks = sumMetric(recent, "clicks");
  const priorClicks = sumMetric(prior, "clicks");
  if (priorClicks > 0) {
    const changePercent = ((recentClicks - priorClicks) / priorClicks) * 100;
    if (changePercent <= -settings.alertThresholds.trafficDropPercent) {
      await createAlert({
        type: "traffic_drop",
        severity: "critical",
        title: `GSC clicks dropped ${Math.abs(changePercent).toFixed(1)}% for ${propertyId}`,
        description: `Clicks fell from ${priorClicks} to ${recentClicks} over the last 7 days vs the prior 7.`,
        metricBefore: priorClicks,
        metricAfter: recentClicks,
        changePercent,
      });
    }
  }
}

export async function checkGa4Alerts(propertyId) {
  const settings = await getSettings();
  const now = new Date();
  const recentStart = new Date(now - 7 * 86400000);
  const priorStart = new Date(now - 14 * 86400000);

  const recent = await SeoGa4Metric.find({ propertyId, dimensionType: "date", date: { $gte: recentStart } }).lean();
  const prior = await SeoGa4Metric.find({ propertyId, dimensionType: "date", date: { $gte: priorStart, $lt: recentStart } }).lean();

  const recentSessions = sumMetric(recent, "sessions");
  const priorSessions = sumMetric(prior, "sessions");
  if (priorSessions > 0) {
    const changePercent = ((recentSessions - priorSessions) / priorSessions) * 100;
    if (changePercent <= -settings.alertThresholds.trafficDropPercent) {
      await createAlert({
        type: "traffic_drop",
        severity: "critical",
        title: `GA4 sessions dropped ${Math.abs(changePercent).toFixed(1)}% for ${propertyId}`,
        description: `Sessions fell from ${priorSessions} to ${recentSessions} over the last 7 days vs the prior 7.`,
        metricBefore: priorSessions,
        metricAfter: recentSessions,
        changePercent,
      });
    }
  }
}

export async function checkCrawlAlerts(previousRun, currentRun) {
  if (!previousRun) return;
  if (currentRun.pagesErrored > previousRun.pagesErrored && currentRun.pagesErrored > 0) {
    await createAlert({
      type: "crawl_error_spike",
      severity: "warning",
      title: `Crawl errors increased from ${previousRun.pagesErrored} to ${currentRun.pagesErrored}`,
      metricBefore: previousRun.pagesErrored,
      metricAfter: currentRun.pagesErrored,
    });
  }
  if (currentRun.summary.brokenLinks > previousRun.summary.brokenLinks) {
    await createAlert({
      type: "new_broken_link",
      severity: "warning",
      title: `Broken links increased from ${previousRun.summary.brokenLinks} to ${currentRun.summary.brokenLinks}`,
      metricBefore: previousRun.summary.brokenLinks,
      metricAfter: currentRun.summary.brokenLinks,
    });
  }
  if (currentRun.summary.noindexPages > previousRun.summary.noindexPages) {
    await createAlert({
      type: "indexing_issue",
      severity: "warning",
      title: `Noindex pages increased from ${previousRun.summary.noindexPages} to ${currentRun.summary.noindexPages}`,
      metricBefore: previousRun.summary.noindexPages,
      metricAfter: currentRun.summary.noindexPages,
    });
  }
}

export { createAlert };
