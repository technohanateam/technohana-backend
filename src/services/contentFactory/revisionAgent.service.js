import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildRevisionAgentPrompt } from "../../prompts/contentFactory/revisionAgent.prompt.js";

// Above this Dice-coefficient (bigram) similarity, a "revision" is judged to
// be a synonym-swap rather than a genuine rewrite.
const SIMILARITY_FAIL_THRESHOLD = 0.9;

function normalizeText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
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

// Cheap, dependency-free textual-similarity sanity check (Sorensen-Dice over
// character bigrams) — good enough to catch "basically unchanged" revisions
// without needing a diff library.
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

export function normalizeArticleText(html) {
  return normalizeText(html);
}

// Builds the revision prompt. `stronger` requests a more aggressive rewrite —
// used on the second manual attempt if the first pasted revision reads as
// near-identical to the original.
export function buildRevisionPrompt({ articleDraft, qualityScoreResult, brief, humanNote, stronger = false }) {
  const flagReasons = qualityScoreResult?.flagReasons || [];
  const factCheckFindings = qualityScoreResult?.factCheckFindings || [];
  return buildRevisionAgentPrompt({ articleDraft, flagReasons, factCheckFindings, brief, humanNote, stronger });
}

// Applies the model's revision on top of the original draft, force-preserving
// sources/faqs/suggestedInternalLinks regardless of what the model returned
// (belt-and-suspenders on top of the prompt instruction — never trust the
// model alone to leave these untouched).
function mergeRevision(original, parsed) {
  return {
    ...original,
    title: parsed.title || original.title,
    slug: parsed.slug || original.slug,
    content: parsed.content || original.content,
    excerpt: parsed.excerpt || original.excerpt,
    metaTitle: parsed.metaTitle || original.metaTitle,
    metaDescription: parsed.metaDescription || original.metaDescription,
    tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : original.tags,
    readTimeMin: parsed.readTimeMin || original.readTimeMin,
    focusKeyword: parsed.focusKeyword || original.focusKeyword,
    author: parsed.author || original.author,
    category: parsed.category || original.category,
    // Explicitly preserved, never taken from the model's output.
    sources: original.sources,
    faqs: original.faqs,
    suggestedInternalLinks: original.suggestedInternalLinks,
  };
}

// Parses a manually-pasted revision response and checks it isn't a
// near-identical synonym-swap of the original.
export function parseRevisionResponse(text, articleDraft) {
  const parsed = parseModelJson(text);
  const revised = mergeRevision(articleDraft, parsed);
  const similarity = diceSimilarity(normalizeText(articleDraft.content), normalizeText(revised.content));
  return { revised, similarity, tooSimilar: similarity >= SIMILARITY_FAIL_THRESHOLD };
}
