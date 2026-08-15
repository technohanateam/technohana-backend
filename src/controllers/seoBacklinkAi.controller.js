import { backlinkDiscoveryQueue } from "../services/backlinkQueue.js";
import { buildOutreachDraftPrompt, parseOutreachDraftResponse } from "../services/backlinkOutreachAiService.js";
import {
  getDiscoverySettings,
  buildManualDiscoveryPromptForCategory,
  parseManualDiscoveryResponseForCategory,
} from "../services/backlinkDiscoveryService.js";
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

// Manual Claude Pro workflow, bypassing the Bull queue (see
// backlinkDiscoveryService.js's "Manual Claude Pro workflow" section for
// why: a queue worker has no human present to paste a response mid-run).
// POST /admin/seo/discovery/manual/start — selects the category queue and
// returns the first category's prompt. The client walks the returned
// `queue` (array of category strings) one at a time via /manual/step below,
// mirroring the manual trend-research queue pattern.
export const startManualDiscovery = async (req, res) => {
  try {
    const { categories } = req.body || {};
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ success: false, message: "categories must be a non-empty array" });
    }
    const { candidatesPerRun } = await getDiscoverySettings();
    const { system, prompt } = buildManualDiscoveryPromptForCategory(categories[0], candidatesPerRun);
    return res.json({
      success: true,
      data: { queue: categories, index: 0, count: candidatesPerRun, awaitingInput: true, prompts: [{ label: categories[0], system, prompt }] },
    });
  } catch (error) {
    console.error("Error starting manual SEO backlink discovery:", error);
    return res.status(500).json({ success: false, message: "Error starting discovery" });
  }
};

// POST /admin/seo/discovery/manual/step — parses the admin's pasted
// response for queue[index], fetches/scores those candidates, then either
// returns the next category's prompt or, if that was the last category,
// the final accumulated tally. `queue`/`index`/`count`/`summarySoFar` are
// round-tripped from the client (stateless, mirrors the blog admin
// endpoints' pastedResponse pattern).
export const submitManualDiscoveryStep = async (req, res) => {
  try {
    const { queue, index, count, summarySoFar, pastedResponse } = req.body || {};
    if (!Array.isArray(queue) || typeof index !== "number" || !queue[index]) {
      return res.status(400).json({ success: false, message: "Invalid queue/index." });
    }

    const tally = await parseManualDiscoveryResponseForCategory(queue[index], pastedResponse, count);
    const prior = summarySoFar || { proposed: 0, created: 0, skipped: 0, errors: 0 };
    const accumulated = {
      proposed: prior.proposed + tally.proposed,
      created: prior.created + tally.created,
      skipped: prior.skipped + tally.skipped,
      errors: prior.errors + tally.errors,
    };

    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      await logSeoAudit(req, "discovery.run", "SeoOpportunity", null, { ...accumulated, categories: queue, triggeredBy: req.admin?.email || "admin-manual" });
      return res.json({ success: true, data: { done: true, summary: accumulated } });
    }

    const { system, prompt } = buildManualDiscoveryPromptForCategory(queue[nextIndex], count);
    return res.json({
      success: true,
      data: {
        queue,
        index: nextIndex,
        count,
        summarySoFar: accumulated,
        awaitingInput: true,
        prompts: [{ label: queue[nextIndex], system, prompt }],
      },
    });
  } catch (error) {
    console.error("Error submitting manual SEO backlink discovery step:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to parse the pasted response." });
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

// Manual Claude Pro workflow: first call (no pastedResponse) returns the
// prompt for the admin to run manually; second call (pastedResponse set)
// parses it and appends the draft, same as the old live-API path did.
export const generateAiDraft = async (req, res) => {
  try {
    const { pastedResponse } = req.body || {};
    if (!pastedResponse) {
      const { system, prompt } = await buildOutreachDraftPrompt({ contactId: req.params.id });
      return res.json({ success: true, awaitingInput: true, prompts: [{ label: "Outreach draft", system, prompt }] });
    }
    const draft = await parseOutreachDraftResponse({ contactId: req.params.id, text: pastedResponse });
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
