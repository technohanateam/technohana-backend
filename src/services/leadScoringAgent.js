import Enquiry from "../models/enquiry.model.js";
import { callClaude, extractJson } from "./aiAgent.service.js";

const SYSTEM_PROMPT = `You are a sales lead qualifier for Technohana, a live instructor-led tech training company selling individual, group (2-9), and corporate (10+) training in India, UAE, US, UK, and EU.

Given an enquiry, score how likely it is to convert to a paid engagement.

Scoring guidance:
- Corporate/group enquiries with team size, budget signals, or concrete requirements score high (70-100, "hot").
- Named-course quote requests from professionals score mid (40-69, "warm").
- Syllabus downloads, vague general enquiries, or student enquiries with no buying signals score low (0-39, "cold").

Output ONLY a JSON object:
{"score": 0-100, "band": "hot"|"warm"|"cold", "reasoning": "2-3 sentences", "suggestedFollowUpDays": 0-7, "draftReply": "plain-text first-reply email body for the sales team, under 130 words, warm and specific to the enquiry, signed 'Team Technohana'"}`;

// Scores an enquiry asynchronously and stores the result on the document.
// Never throws — enquiry submission must not depend on this.
export async function scoreEnquiry(enquiryId) {
  try {
    const enquiry = await Enquiry.findById(enquiryId);
    if (!enquiry) return null;

    const prompt = JSON.stringify({
      name: enquiry.name,
      company: enquiry.company || null,
      userType: enquiry.userType || null,
      enquiryType: enquiry.enquiryType || null,
      courseTitle: enquiry.courseTitle || null,
      trainingType: enquiry.trainingType || null,
      teamSize: enquiry.teamSize || null,
      numOpenings: enquiry.numOpenings || null,
      domain: enquiry.domain || null,
      requirements: enquiry.requirements || null,
      description: enquiry.description || null,
      timeline: enquiry.timeline || null,
      selectedPackage: enquiry.selectedPackage || null,
      currency: enquiry.currency || null,
      source: enquiry.source || null,
      campaign: enquiry.campaign || null,
      utm: enquiry.utm || null,
    });

    const raw = await callClaude({ system: SYSTEM_PROMPT, prompt, maxTokens: 512, model: "claude-haiku-4-5-20251001" });
    const result = extractJson(raw);

    const score = Math.min(100, Math.max(0, Number(result.score) || 0));
    const band = ["hot", "warm", "cold"].includes(result.band) ? result.band : "cold";
    const followUpDays = Math.min(7, Math.max(0, Number(result.suggestedFollowUpDays) || 1));

    enquiry.aiScore = score;
    enquiry.aiScoreBand = band;
    enquiry.aiReasoning = String(result.reasoning || "").slice(0, 2000);
    enquiry.aiDraftReply = String(result.draftReply || "").slice(0, 5000);
    enquiry.aiSuggestedFollowUp = new Date(Date.now() + followUpDays * 24 * 60 * 60 * 1000);
    enquiry.aiScoredAt = new Date();
    await enquiry.save();

    return enquiry;
  } catch (err) {
    console.error(`[LeadScoring] Failed for enquiry ${enquiryId}:`, err.message);
    return null;
  }
}
