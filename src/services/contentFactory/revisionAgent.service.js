import { trackedCallClaude } from "./aiUsageTracker.service.js";
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
function diceSimilarity(a, b) {
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

// Genuine rewrite of a flagged draft. `qualityScoreResult` = the result of
// runQualityGate (or an equivalent shape) with { flagReasons,
// factCheckFindings }. `opts.humanNote` merges in a human reviewer's
// additional instruction (request-revision flow) alongside any automatic
// flag reasons. Retries ONCE with a stronger instruction if the sanity check
// finds the first attempt too similar to the original; gives up gracefully
// (returns the best attempt + a note) rather than looping forever.
export async function reviseArticle(articleDraft, qualityScoreResult, brief, opts = {}) {
  const flagReasons = qualityScoreResult?.flagReasons || [];
  const factCheckFindings = qualityScoreResult?.factCheckFindings || [];
  const humanNote = opts.humanNote || null;

  const originalNormalized = normalizeText(articleDraft.content);

  const runAttempt = async (stronger) => {
    const { system, prompt } = buildRevisionAgentPrompt({
      articleDraft,
      flagReasons,
      factCheckFindings,
      brief,
      humanNote,
      stronger,
    });
    const { text, usage, model } = await trackedCallClaude({ system, prompt, maxTokens: 4096, tier: "standard", callType: "revision", opportunityId: brief?.opportunityId || null });
    const parsed = parseModelJson(text);
    const revised = mergeRevision(articleDraft, parsed);
    const similarity = diceSimilarity(originalNormalized, normalizeText(revised.content));
    return { revised, usage, model, similarity };
  };

  const first = await runAttempt(false);
  if (first.similarity < SIMILARITY_FAIL_THRESHOLD) {
    return { articleDraft: first.revised, usage: first.usage, model: first.model, attempts: 1, gaveUp: false, note: null };
  }

  const second = await runAttempt(true);
  if (second.similarity < SIMILARITY_FAIL_THRESHOLD) {
    return { articleDraft: second.revised, usage: second.usage, model: second.model, attempts: 2, gaveUp: false, note: null };
  }

  // Both attempts read as near-identical to the original — give up gracefully
  // rather than retrying indefinitely, return whichever attempt changed more.
  const best = second.similarity <= first.similarity ? second : first;
  return {
    articleDraft: best.revised,
    usage: best.usage,
    model: best.model,
    attempts: 2,
    gaveUp: true,
    note: "Automatic revision could not produce a substantially different rewrite after 2 attempts. Returning the best available attempt — manual editing is recommended.",
  };
}
