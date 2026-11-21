import Enquiry from "../models/enquiry.model.js";

// Pipeline fields only staff set through the admin API; a public submission naming
// one keeps it as a detail instead.
const STAFF_ONLY_FIELDS = new Set([
  "status", "lostReason", "notes", "activities", "assignedTo", "nextFollowUp",
  "aiScore", "aiScoreBand", "aiReasoning", "aiDraftReply", "aiSuggestedFollowUp", "aiScoredAt",
  "createdAt", "crmLeadId",
]);
// Forms send these under different spellings; the admin type filter is an exact match.
const ENQUIRY_TYPE_ALIASES = {
  "request a callback": "Call Back Request",
  "corporate-training": "Corporate Training",
  "hire-from-us": "Hire From Us",
  "training-partner": "Training Partner",
  "career-path-finder": "Career Path Finder",
  "learning-path-consultation": "Learning Path Consultation",
};
export const normalizeEnquiryType = (type) => {
  const trimmed = typeof type === "string" ? type.trim() : "";
  return ENQUIRY_TYPE_ALIASES[trimmed.toLowerCase()] || trimmed || "Website Enquiry";
};

export const MAX_DETAILS = 30;
export const MAX_DETAIL_LENGTH = 2000;

// Mongoose silently drops keys the schema doesn't define, which lost landing-page
// answers like budget and team size; those go to `details` instead.
export const splitSubmission = (body) => {
  const fields = {};
  const details = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "_id" || key === "details" || key === "__v") continue;
    if (Enquiry.schema.path(key) && !STAFF_ONLY_FIELDS.has(key)) {
      fields[key] = value;
      continue;
    }
    // Map keys can't contain "." or start with "$".
    if (Object.keys(details).length >= MAX_DETAILS || key.length > 60 || key.startsWith("$") || key.includes(".")) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    details[key] = text.slice(0, MAX_DETAIL_LENGTH);
  }
  return { fields, details };
};
