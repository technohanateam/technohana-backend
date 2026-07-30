import SeoContact from "../models/seoContact.model.js";
import SeoOpportunity from "../models/seoOpportunity.model.js";
import { callClaude, extractJson } from "./aiAgent.service.js";

const REQUIRED_KEYS = [
  "subject",
  "personalizedEmail",
  "reasonForOutreach",
  "suggestedPage",
  "suggestedAnchorText",
  "followUp1",
  "followUp2",
];

// Generates an AI outreach draft for a contact and appends it to
// SeoContact.aiDrafts[]. Never sends anything — a human must call the
// separate "send" endpoint for an email to actually leave the system.
export async function generateOutreachDraft({ contactId, callClaudeFn = callClaude, extractJsonFn = extractJson }) {
  const contact = await SeoContact.findById(contactId);
  if (!contact) throw new Error("Contact not found");

  let opportunity = null;
  if (contact.opportunityId) {
    opportunity = await SeoOpportunity.findById(contact.opportunityId).lean();
  } else if (contact.website) {
    opportunity = await SeoOpportunity.findOne({ referringDomain: contact.website }).lean();
  }

  const system =
    "You write concise, non-spammy backlink outreach emails for Technohana, an IT/cloud/cybersecurity/agile " +
    "training provider. Emails must sound human, specific to the recipient's site, and never use generic " +
    "mass-outreach language. Respond with strict JSON only, no prose, no markdown fences.";

  const context = [
    `Contact: ${contact.contactName || "Unknown"} at ${contact.company || contact.website || "their organization"}`,
    contact.role ? `Role: ${contact.role}` : null,
    opportunity?.organizationName ? `Organization: ${opportunity.organizationName}` : null,
    opportunity?.targetPage ? `Suggested Technohana page to link to: ${opportunity.targetPage}` : null,
    opportunity?.anchorTextSuggestion ? `Suggested anchor text: ${opportunity.anchorTextSuggestion}` : null,
    opportunity?.rationale || opportunity?.discoveryRawNotes ? `Why this is a fit: ${opportunity.rationale || opportunity.discoveryRawNotes}` : null,
  ].filter(Boolean).join("\n");

  const prompt =
    `Draft a backlink outreach email using this context:\n${context}\n\n` +
    `Return a JSON object with exactly these keys: subject, personalizedEmail (the full email body), ` +
    `reasonForOutreach (one sentence, for internal reference, not sent to the recipient), suggestedPage, ` +
    `suggestedAnchorText, followUp1 (a short follow-up email if there's no reply after ~1 week), ` +
    `followUp2 (a final short follow-up after ~2 more weeks).`;

  const text = await callClaudeFn({ system, prompt, maxTokens: 2048 });
  const parsed = extractJsonFn(text);

  for (const key of REQUIRED_KEYS) {
    if (typeof parsed?.[key] !== "string") {
      throw new Error(`AI outreach draft response missing required field: ${key}`);
    }
  }

  const draft = {
    generatedAt: new Date(),
    subject: parsed.subject,
    personalizedEmail: parsed.personalizedEmail,
    reasonForOutreach: parsed.reasonForOutreach,
    suggestedPage: parsed.suggestedPage,
    suggestedAnchorText: parsed.suggestedAnchorText,
    followUp1: parsed.followUp1,
    followUp2: parsed.followUp2,
    status: "draft",
  };

  contact.aiDrafts.push(draft);
  await contact.save();

  return contact.aiDrafts[contact.aiDrafts.length - 1];
}
