import { parseModelJson } from "../utils/parseModelJson.js";

// Parses text an admin pasted back from a manual Claude.ai Pro run for the
// Enquiry Prompt Pack (see enquiryPromptBuilder.service.js). No dependency on
// aiAgent.service.js / the Anthropic SDK — this only parses what a human
// pasted back in.

function requireString(parsed, field) {
  if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
    const err = new Error(`Pasted response is missing required field "${field}"`);
    err.statusCode = 422;
    throw err;
  }
  return parsed[field].trim();
}

function parseJsonOrThrow(rawText) {
  try {
    return parseModelJson(rawText);
  } catch (err) {
    const wrapped = new Error(`Could not parse a JSON object out of the pasted text: ${err.message}`);
    wrapped.statusCode = 422;
    throw wrapped;
  }
}

export function parseTrainerSearchResponse(rawText) {
  const parsed = parseJsonOrThrow(rawText);
  return { postText: requireString(parsed, "postText") };
}

export function parseBlogPostResponse(rawText) {
  const parsed = parseJsonOrThrow(rawText);
  const title = requireString(parsed, "title");
  const content = requireString(parsed, "content");
  const excerpt = requireString(parsed, "excerpt");
  const metaTitle = requireString(parsed, "metaTitle");
  const metaDescription = requireString(parsed, "metaDescription");
  const focusKeyword = requireString(parsed, "focusKeyword");
  if (!Array.isArray(parsed.tags) || !parsed.tags.every((t) => typeof t === "string")) {
    const err = new Error('Pasted response is missing a valid "tags" array of strings');
    err.statusCode = 422;
    throw err;
  }
  return { title, content, excerpt, metaTitle, metaDescription, focusKeyword, tags: parsed.tags.filter(Boolean) };
}
