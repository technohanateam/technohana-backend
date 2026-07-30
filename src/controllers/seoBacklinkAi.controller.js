import { backlinkDiscoveryQueue } from "../services/backlinkQueue.js";
import { generateOutreachDraft } from "../services/backlinkOutreachAiService.js";
import { sendEmail } from "../config/emailService.js";
import SeoContact from "../models/seoContact.model.js";
import { logSeoAudit } from "../utils/seoAuditLogger.js";

export const runDiscovery = async (req, res) => {
  try {
    const { categories } = req.body || {};
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ success: false, message: "categories must be a non-empty array" });
    }
    const job = await backlinkDiscoveryQueue.add({ categories, triggeredBy: req.admin?.email || "admin" });
    await logSeoAudit(req, "discovery.queued", "SeoOpportunity", null, { categories });
    return res.json({ success: true, message: "Discovery queued", data: { queued: true, jobId: job.id } });
  } catch (error) {
    console.error("Error queuing SEO backlink discovery:", error);
    return res.status(500).json({ success: false, message: "Error queuing discovery" });
  }
};

export const getDiscoveryStatus = async (req, res) => {
  try {
    const job = await backlinkDiscoveryQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    const state = await job.getState();
    return res.json({ success: true, data: { state, result: job.returnvalue || null, failedReason: job.failedReason || null } });
  } catch (error) {
    console.error("Error fetching discovery job status:", error);
    return res.status(500).json({ success: false, message: "Error fetching job status" });
  }
};

export const generateAiDraft = async (req, res) => {
  try {
    const draft = await generateOutreachDraft({ contactId: req.params.id });
    await logSeoAudit(req, "outreach.ai_draft_generated", "SeoContact", req.params.id, { subject: draft.subject });
    return res.json({ success: true, message: "Draft generated", data: draft });
  } catch (error) {
    console.error("Error generating AI outreach draft:", error);
    return res.status(500).json({ success: false, message: error.message || "Error generating draft" });
  }
};

// The only place a Phase 6 outreach email actually leaves the system — every
// other code path only ever creates/edits a draft.
export const sendAiDraft = async (req, res) => {
  try {
    const contact = await SeoContact.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    const draft = contact.aiDrafts[Number(req.params.draftIndex)];
    if (!draft) return res.status(404).json({ success: false, message: "Draft not found" });
    if (!contact.email) return res.status(400).json({ success: false, message: "Contact has no email address" });

    await sendEmail({
      from: "Technohana Partnerships <corporate@technohana.in>",
      to: contact.email,
      subject: draft.subject,
      html: `<p>${draft.personalizedEmail.replace(/\n/g, "<br/>")}</p>`,
    });

    draft.status = "sent";
    draft.sentAt = new Date();
    draft.sentBy = req.admin?.email;
    contact.status = "email-sent";
    contact.lastContact = new Date();
    await contact.save();

    await logSeoAudit(req, "outreach.ai_draft_sent", "SeoContact", req.params.id, { subject: draft.subject });
    return res.json({ success: true, message: "Email sent", data: contact });
  } catch (error) {
    console.error("Error sending AI outreach draft:", error);
    return res.status(500).json({ success: false, message: "Error sending draft" });
  }
};

export const discardAiDraft = async (req, res) => {
  try {
    const contact = await SeoContact.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
    const draft = contact.aiDrafts[Number(req.params.draftIndex)];
    if (!draft) return res.status(404).json({ success: false, message: "Draft not found" });
    draft.status = "discarded";
    await contact.save();
    return res.json({ success: true, message: "Draft discarded", data: contact });
  } catch (error) {
    console.error("Error discarding AI outreach draft:", error);
    return res.status(500).json({ success: false, message: "Error discarding draft" });
  }
};
