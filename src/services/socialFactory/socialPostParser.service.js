import { parseModelJson } from "../../utils/parseModelJson.js";

// Parses text the admin pasted in from a manual Claude.ai Pro run (see
// socialPromptBuilder.service.js for the prompt that requests this shape).
// Deliberately has zero dependency on aiAgent.service.js / the Anthropic SDK —
// this app never calls Claude for the Social Post Factory, it only parses
// what a human pasted back in.
const REQUIRED_STRING_FIELDS = ["caption", "cta", "imagePromptSuggestion", "altText"];

// isCarousel/slideCount: passed by the caller (socialPost.controller.js),
// derived from PLATFORM_RULES[post.platform] — LINKEDIN_CAROUSEL and
// INSTAGRAM_CAROUSEL only. When absent, behavior is byte-identical to the
// original single-image parsing (every existing LINKEDIN/INSTAGRAM/X/
// WHATSAPP_STATUS call site is unaffected).
export function parseSocialPostResponse(rawText, { isCarousel = false, slideCount = null } = {}) {
  let parsed;
  try {
    parsed = parseModelJson(rawText);
  } catch (err) {
    const wrapped = new Error(`Could not parse a JSON object out of the pasted text: ${err.message}`);
    wrapped.statusCode = 422;
    throw wrapped;
  }

  const requiredFields = isCarousel ? REQUIRED_STRING_FIELDS.filter((f) => f !== "imagePromptSuggestion") : REQUIRED_STRING_FIELDS;
  for (const field of requiredFields) {
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

  let slides = [];
  if (isCarousel) {
    if (!Array.isArray(parsed.slides) || parsed.slides.length !== slideCount) {
      const err = new Error(`Pasted response must include a "slides" array with exactly ${slideCount} entries`);
      err.statusCode = 422;
      throw err;
    }
    slides = parsed.slides.map((slide, i) => {
      if (!slide || typeof slide.heading !== "string" || !slide.heading.trim() || typeof slide.body !== "string" || !slide.body.trim()) {
        const err = new Error(`Slide ${i + 1} is missing a required "heading" or "body"`);
        err.statusCode = 422;
        throw err;
      }
      return {
        heading: slide.heading.trim(),
        body: slide.body.trim(),
        imagePromptSuggestion: typeof slide.imagePromptSuggestion === "string" ? slide.imagePromptSuggestion.trim() : "",
      };
    });
  }

  return {
    caption: parsed.caption.trim(),
    hashtags,
    cta: parsed.cta.trim(),
    imagePromptSuggestion: isCarousel ? "" : parsed.imagePromptSuggestion.trim(),
    altText: parsed.altText.trim(),
    characterCount: parsed.caption.trim().length,
    slides,
  };
}
