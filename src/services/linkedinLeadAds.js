// LinkedIn Lead Gen Form responses → CRM leads (polled; LinkedIn has no page-style webhook for this app).
import CrmLinkedinConnection from "../models/crm/crmLinkedinConnection.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { upsertCrmLead } from "./crmLeadIntake.js";
import { listFormResponses, listCampaigns } from "./linkedinService.js";
import { LinkedinAuthError } from "../config/linkedinClient.js";

const STANDARD_KEYS = new Set([
  "first_name", "firstname", "last_name", "lastname", "full_name", "name", "email", "work_email", "phone", "phone_number",
  "company", "company_name", "job_title", "title", "city", "state", "country", "zip_code",
]);
const humanize = (key) => key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
const safeKey = (key) => key.replace(/\./g, "_").replace(/^\$/, "_").slice(0, 80);
const idOf = (urn) => String(urn || "").split(":").pop();

// Lead Gen Form response → CRM lead fields + a one-line summary for the activity log.
export function mapLinkedInLead(raw, campaignName) {
  const answers = Object.fromEntries((raw.formResponse?.answers || []).map((a) => [String(a.name || "").toLowerCase(), String(a.value || "").trim()]));
  const take = (...keys) => keys.map((k) => answers[k]).find((v) => v);

  const custom = Object.entries(answers).filter(([k, v]) => v && !STANDARD_KEYS.has(k));
  const teamAnswer = custom.find(([k]) => /team|employee|people|participant|headcount|size/.test(k))?.[1];
  const teamSize = teamAnswer ? parseInt(teamAnswer.match(/\d+/)?.[0], 10) : undefined;
  const campaignId = idOf(raw.associatedCampaign);
  const formId = idOf(raw.form);

  const fields = {
    name: take("full_name", "name") || [take("first_name", "firstname"), take("last_name", "lastname")].filter(Boolean).join(" ") || take("email", "work_email") || "LinkedIn lead",
    email: take("email", "work_email"),
    phone: take("phone_number", "phone"),
    company: take("company_name", "company"),
    designation: take("job_title", "title"),
    city: take("city"),
    state: take("state"),
    country: take("country"),
    teamSize: Number.isFinite(teamSize) ? teamSize : undefined,
    interest: custom.map(([k, v]) => `${humanize(k)}: ${v}`).join("; ").slice(0, 1000) || undefined,
    source: "linkedin_ads",
    priority: teamSize >= 10 ? "high" : "medium",
    utm: {
      utm_source: "linkedin",
      utm_medium: "paid_social",
      utm_campaign: campaignName || (campaignId ? `campaign-${campaignId}` : undefined),
      utm_content: raw.associatedCreative ? idOf(raw.associatedCreative) : undefined,
      linkedin_form_id: formId,
      linkedin_campaign_id: campaignId || undefined,
      linkedin_creative_id: raw.associatedCreative ? idOf(raw.associatedCreative) : undefined,
    },
    customFields: {
      origin: "linkedin_lead_gen",
      linkedinFormId: formId,
      linkedinCampaignId: campaignId,
      ...Object.fromEntries(custom.map(([k, v]) => [safeKey(k), v])),
    },
  };
  const summary = `Campaign: ${campaignName || campaignId || "-"} · Form: ${formId || "-"}`;
  return { fields, summary };
}

export async function processLinkedInLead(raw, campaignName) {
  const leadId = String(raw.id);
  if (await CRMActivity.exists({ "metadata.linkedinLeadId": leadId })) return { duplicate: true };

  const { fields, summary } = mapLinkedInLead(raw, campaignName);
  try {
    const { lead, created } = await upsertCrmLead({
      fields,
      externalId: leadId,
      externalField: "linkedinLeadId",
      activityTitle: "Lead captured from LinkedIn Lead Gen",
      activityBody: summary,
      repeatTitle: "Submitted again via LinkedIn Lead Gen",
      metadata: { linkedinLeadId: leadId, formId: idOf(raw.form), campaignId: idOf(raw.associatedCampaign) },
    });
    return { leadId: lead._id, created };
  } catch (err) {
    if (err?.code === 11000) return { duplicate: true };
    throw err;
  }
}

// First sync only looks back 7 days so connecting doesn't flood reps with old leads.
const FIRST_SYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export async function syncLinkedInLeads() {
  const conn = await CrmLinkedinConnection.findOne({ key: "default", isActive: true });
  if (!conn?.adAccountUrn) return { skipped: true };

  const startedAt = Date.now();
  const sinceMs = conn.lastLeadSyncAt ? conn.lastLeadSyncAt.getTime() - 60_000 : startedAt - FIRST_SYNC_LOOKBACK_MS;
  let imported = 0;
  let failed = 0;
  try {
    const [responses, campaigns] = await Promise.all([listFormResponses(conn, sinceMs), listCampaigns(conn).catch(() => new Map())]);
    for (const raw of responses.sort((a, b) => a.submittedAt - b.submittedAt)) {
      try {
        const result = await processLinkedInLead(raw, campaigns.get(idOf(raw.associatedCampaign))?.name);
        if (result.created) imported++;
      } catch (err) {
        failed++;
        console.error(`[linkedin-leads] lead ${raw.id} failed:`, err.message);
      }
    }
    // Hold the cursor back if any lead failed so the next run retries it (dedupe makes that safe).
    await CrmLinkedinConnection.updateOne({ _id: conn._id }, {
      $set: { lastSyncStatus: failed ? "error" : "success", lastSyncError: failed ? `${failed} lead(s) failed to import` : undefined, ...(failed ? {} : { lastLeadSyncAt: new Date(startedAt) }) },
    });
  } catch (err) {
    if (!(err instanceof LinkedinAuthError)) {
      await CrmLinkedinConnection.updateOne({ _id: conn._id }, { lastSyncStatus: "error", lastSyncError: err.message });
    }
    throw err;
  }
  return { imported, failed };
}
