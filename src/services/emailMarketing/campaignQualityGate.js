import Campaign from "../../models/campaign.model.js";
import { callClaude, extractJson } from "../aiAgent.service.js";

// Quality Gate for AI-drafted campaign copy (analog of the blog Content
// Factory's qualityGate.service.js: a compliance pass plus an AI style
// check, one automatic revision on failure, then routes to a human).

const MAX_AUTO_REVISIONS = 1;

// Hard-fail patterns — same guardrail the copywriter already strips at
// generation time, re-checked here in case a human hand-edited the copy
// after AI generation and reintroduced one of these.
function findComplianceIssues(campaign) {
  const issues = [];
  const text = `${campaign.subject || ""} ${campaign.previewText || ""} ${campaign.htmlContent || ""}`;

  if (/https?:\/\/\S+/i.test(text)) issues.push("Contains a raw URL — links must go through the approved CTA only");
  if (/\b(₹|INR|USD|\$|AED|£|€)\s*[\d,]+/i.test(text)) issues.push("Contains a specific price — prices must come from computeQuote(), never hardcoded");
  if (/\b[A-Z]{4,}\d{1,2}\b/.test(text)) issues.push("Contains a coupon-code-like pattern — coupon codes must be queried from MongoDB, never hardcoded in copy");
  if (!campaign.subject || campaign.subject.length > 150) issues.push("Subject line missing or over 150 characters");
  if (!campaign.htmlContent || campaign.htmlContent.trim().length < 20) issues.push("Body content missing or too short");

  return issues;
}

const STYLE_SYSTEM_PROMPT = `You review marketing email copy for a B2B training company for tone quality.
Flag copy that sounds generically AI-written (empty superlatives, "unlock your potential", excessive exclamation points, listicle padding) or uses manipulative urgency ("last chance", fake scarcity).
Respond ONLY with JSON: {"passed": true|false, "issues": ["short issue description", ...]}`;

async function runStyleCheck(campaign) {
  try {
    const prompt = JSON.stringify({
      subject: campaign.subject,
      previewText: campaign.previewText,
      htmlContent: campaign.htmlContent,
    });
    const { text: raw } = await callClaude({
      system: STYLE_SYSTEM_PROMPT,
      prompt,
      maxTokens: 400,
      tier: "cheap",
    });
    const result = extractJson(raw);
    return {
      passed: result?.passed !== false,
      issues: Array.isArray(result?.issues) ? result.issues.slice(0, 10) : [],
    };
  } catch (err) {
    // Style check is advisory — never let it block a campaign that already
    // passed the hard compliance checks.
    console.error("[QualityGate] Style check failed, skipping:", err.message);
    return { passed: true, issues: [] };
  }
}

// Runs the quality gate on a campaign's current copy. On the first failure
// it triggers one automatic revision pass via campaignCopywriterAgent, then
// re-checks compliance only (not the AI style check, to bound cost). Sets
// campaign.reviewStatus to "approved" or "needs_revision".
export async function runCampaignQualityGate(campaignId) {
  let campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  campaign.copyGeneration.step = "COMPLIANCE_CHECK";
  await campaign.save();

  let complianceIssues = findComplianceIssues(campaign);
  const styleResult = complianceIssues.length === 0 ? await runStyleCheck(campaign) : { passed: true, issues: [] };
  let allIssues = [...complianceIssues, ...(styleResult.passed ? [] : styleResult.issues)];
  const revisionCountBefore = campaign.copyGeneration.revisionCount;

  if (allIssues.length > 0 && revisionCountBefore < MAX_AUTO_REVISIONS) {
    try {
      const { generateCampaignCopy } = await import("../campaignCopywriterAgent.js");
      const revisionBrief = `${campaign.copyGeneration.brief || campaign.description || campaign.name}\n\nRevision required — fix these issues from the last draft: ${allIssues.join("; ")}`;
      await generateCampaignCopy(campaignId, revisionBrief);

      // generateCampaignCopy wrote directly to the DB (subject/htmlContent/etc,
      // and reset copyGeneration.brief/step) — re-fetch instead of patching the
      // stale in-memory doc, so nothing gets silently overwritten on save below.
      campaign = await Campaign.findById(campaignId);
      campaign.copyGeneration.revisionCount = revisionCountBefore + 1;
      allIssues = findComplianceIssues(campaign); // second pass: compliance only, no AI style re-check
    } catch (err) {
      console.error(`[QualityGate] Auto-revision failed for campaign ${campaignId}:`, err.message);
    }
  }

  campaign.copyGeneration.qualityIssues = allIssues;
  campaign.copyGeneration.lastRunAt = new Date();
  campaign.copyGeneration.step = "DONE";
  campaign.reviewStatus = allIssues.length === 0 ? "approved" : "needs_revision";
  await campaign.save();

  return { passed: allIssues.length === 0, issues: allIssues, reviewStatus: campaign.reviewStatus };
}
