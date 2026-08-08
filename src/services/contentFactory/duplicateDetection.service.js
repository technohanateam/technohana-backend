// Deterministic, no-network duplicate/cannibalization risk scoring.
// `existingCorpus` must be pre-fetched by the caller: an array of
// { title, slug, focusKeyword, clusterId, searchIntent, source: 'blog'|'opportunity', id }

const DEFAULT_THRESHOLDS = { titleSimilarity: 0.75, keywordOverlap: 0.6 };

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return new Set(normalizeTitle(text).split(" ").filter(Boolean));
}

// Jaccard similarity of token sets.
function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function normalizeKeyword(kw) {
  return String(kw || "").toLowerCase().trim();
}

export function scoreDuplicateRisk(candidate, existingCorpus = [], thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  const candidateTitleTokens = tokenize(candidate.title);
  const candidateSlug = String(candidate.slug || "").toLowerCase().trim();
  const candidateKeyword = normalizeKeyword(candidate.focusKeyword);

  const signals = [];
  let maxScore = 0;

  for (const item of existingCorpus) {
    const matchedAgainstType = item.source === "blog" ? "BLOG" : "OPPORTUNITY";
    const matchedAgainstId = item.id ? String(item.id) : null;

    // EXACT_DUPLICATE — same slug or exact same focus keyword.
    const itemSlug = String(item.slug || "").toLowerCase().trim();
    const itemKeyword = normalizeKeyword(item.focusKeyword);
    if ((candidateSlug && itemSlug && candidateSlug === itemSlug) || (candidateKeyword && itemKeyword && candidateKeyword === itemKeyword)) {
      signals.push({ type: "EXACT_DUPLICATE", matchedAgainstType, matchedAgainstId, score: 100 });
      maxScore = Math.max(maxScore, 100);
      continue;
    }

    // TITLE_SIMILARITY — Jaccard token overlap on normalized titles.
    const titleSim = jaccard(candidateTitleTokens, tokenize(item.title));
    if (titleSim >= t.titleSimilarity) {
      const score = Math.round(titleSim * 100);
      signals.push({ type: "TITLE_SIMILARITY", matchedAgainstType, matchedAgainstId, score });
      maxScore = Math.max(maxScore, score);
    }

    // SEARCH_INTENT_OVERLAP — same topic cluster + same search intent.
    if (candidate.clusterId && item.clusterId && String(candidate.clusterId) === String(item.clusterId) && candidate.searchIntent && item.searchIntent === candidate.searchIntent) {
      const score = 40;
      signals.push({ type: "SEARCH_INTENT_OVERLAP", matchedAgainstType, matchedAgainstId, score });
      maxScore = Math.max(maxScore, score);
    }

    // KEYWORD_CANNIBALIZATION — secondary/focus keyword token overlap above threshold.
    const keywordOverlap = jaccard(tokenize(candidateKeyword), tokenize(itemKeyword));
    if (keywordOverlap >= t.keywordOverlap) {
      const score = Math.round(keywordOverlap * 100);
      signals.push({ type: "KEYWORD_CANNIBALIZATION", matchedAgainstType, matchedAgainstId, score });
      maxScore = Math.max(maxScore, score);
    }
  }

  const cannibalizationRisk = maxScore >= 90 ? "HIGH" : maxScore >= 60 ? "MEDIUM" : maxScore >= 30 ? "LOW" : "NONE";

  return { duplicateScore: maxScore, cannibalizationRisk, signals };
}
