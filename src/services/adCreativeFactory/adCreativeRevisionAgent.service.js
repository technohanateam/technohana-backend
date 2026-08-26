import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildAdRevisionPrompt } from "../../prompts/adCreativeFactory/adRevision.prompt.js";

// Above this Dice-coefficient (bigram) similarity, a "revision" is judged to
// be a synonym-swap rather than a genuine rewrite. Mirrors revisionAgent.service.js.
const SIMILARITY_FAIL_THRESHOLD = 0.9;

function normalizeText(creativeDraft) {
  return [
    ...(creativeDraft?.headlines || []),
    ...(creativeDraft?.primaryTexts || []),
    ...(creativeDraft?.descriptions || []),
  ]
    .map((v) => v.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function bigramCounts(str) {
  const s = str.replace(/\s+/g, "");
  const counts = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    counts.set(bg, (counts.get(bg) || 0) + 1);
  }
  return counts;
}

export function diceSimilarity(a, b) {
  if (!a && !b) return 1;
  const A = bigramCounts(a);
  const B = bigramCounts(b);
  if (A.size === 0 || B.size === 0) return A.size === B.size ? 1 : 0;
  let intersection = 0;
  for (const [bg, count] of A) {
    if (B.has(bg)) intersection += Math.min(count, B.get(bg));
  }
  const totalA = [...A.values()].reduce((s, c) => s + c, 0);
  const totalB = [...B.values()].reduce((s, c) => s + c, 0);
  return (2 * intersection) / (totalA + totalB);
}

export function buildRevisionPrompt({ creativeDraft, flagReasons, humanNote, stronger = false }) {
  return buildAdRevisionPrompt({ creativeDraft, flagReasons, humanNote, stronger });
}

function normalizeVariants(list, fallbackPlatform) {
  if (!Array.isArray(list)) return [];
  return list.filter((v) => v?.text).map((v) => ({ text: String(v.text).trim(), platform: v.platform || fallbackPlatform }));
}

// Parses a manually-pasted revision response and checks it isn't a
// near-identical synonym-swap of the original.
export function parseRevisionResponse(text, creativeDraft, fallbackPlatform) {
  const parsed = parseModelJson(text);
  const revised = {
    headlines: normalizeVariants(parsed.headlines, fallbackPlatform),
    primaryTexts: normalizeVariants(parsed.primaryTexts, fallbackPlatform),
    descriptions: normalizeVariants(parsed.descriptions, fallbackPlatform),
    ctas: normalizeVariants(parsed.ctas, fallbackPlatform),
  };
  const similarity = diceSimilarity(normalizeText(creativeDraft), normalizeText(revised));
  return { revised, similarity, tooSimilar: similarity >= SIMILARITY_FAIL_THRESHOLD };
}
