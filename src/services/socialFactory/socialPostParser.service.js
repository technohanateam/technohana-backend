import { parseModelJson } from "../../utils/parseModelJson.js";

// Parses text the admin pasted in from a manual Claude.ai Pro run (see
// socialPromptBuilder.service.js for the prompt that requests this shape).
// Deliberately has zero dependency on aiAgent.service.js / the Anthropic SDK —
// this app never calls Claude for the Social Post Factory, it only parses
// what a human pasted back in.
const REQUIRED_STRING_FIELDS = ["caption", "cta", "imagePromptSuggestion", "altText"];

export function parseSocialPostResponse(rawText) {
  let parsed;
  try {
    parsed = parseModelJson(rawText);
  } catch (err) {
    const wrapped = new Error(`Could not parse a JSON object out of the pasted text: ${err.message}`);
    wrapped.statusCode = 422;
    throw wrapped;
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      const err = new Error(`Pasted response is missing required field "${field}"`);
      err.statusCode = 422;
      throw err;
    }
  }
  if (!Array.isArray(parsed.hashtags) || !parsed.hashtags.every((h) => typeof h === "string")) {
    const err = new Error('Pasted response is missing a valid "hashtags" array of strings');
    err.statusCode = 422;
    throw err;
  }

  const hashtags = parsed.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean);

  return {
    caption: parsed.caption.trim(),
    hashtags,
    cta: parsed.cta.trim(),
    imagePromptSuggestion: parsed.imagePromptSuggestion.trim(),
    altText: parsed.altText.trim(),
    characterCount: parsed.caption.trim().length,
  };
}
