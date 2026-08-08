// revisionAgent.service.js — genuine rewrite of flagged sections, not
// synonym-swapping. `stronger` is set true on the single retry attempt after
// the sanity check fails once.
export function buildRevisionAgentPrompt({ articleDraft, flagReasons, factCheckFindings, brief, humanNote, stronger }) {
  const unverifiable = (factCheckFindings || []).filter((f) => f.verifiable === false);
  const verified = (factCheckFindings || []).filter((f) => f.verifiable === true);

  const system = `You are a senior editor performing a GENUINE rewrite of a flagged blog article
for Technohana. This is not a copy-edit pass — restructure sentences and paragraphs, change the
underlying phrasing and organization of the flagged sections. Simply swapping synonyms or
lightly rewording is NOT acceptable and will be rejected.

You MUST preserve exactly, unchanged in meaning:
- The "sources" array entries
- The "faqs" array entries
- Any existing internal links (<a href="/courses/...">, <a href="/blog/...">) already in the
  content — do not remove or break them
- Any fact already confirmed verifiable by the fact-checker (listed below) — do not alter or
  remove those facts, only reference for restating with different phrasing/structure if useful

For any claim flagged as unverifiable, either remove/soften it to a qualitative statement or
rephrase it so it is not stated as a hard fact.

${stronger ? `IMPORTANT: A previous revision attempt was rejected for being too similar to the
original (near-identical wording). This time you MUST substantially restructure the flagged
paragraphs — different sentence order, different framing, different examples/structure where
possible. A light rewording will be rejected again.` : ""}

Return ONLY valid JSON with the same shape as the original article draft. No markdown. No
explanations outside the JSON.`;

  const flagReasonsBlock = (flagReasons || []).map((r) => `- ${r}`).join("\n") || "(none specified)";
  const unverifiableBlock = unverifiable.map((f) => `- "${f.claim}" — ${f.note || "could not be verified"}`).join("\n") || "(none)";
  const verifiedBlock = verified.map((f) => `- "${f.claim}"${f.sourceUrl ? ` (source: ${f.sourceUrl})` : ""}`).join("\n") || "(none)";

  const prompt = `Current article draft (JSON):
${JSON.stringify({
    title: articleDraft?.title,
    slug: articleDraft?.slug,
    content: articleDraft?.content,
    excerpt: articleDraft?.excerpt,
    metaTitle: articleDraft?.metaTitle,
    metaDescription: articleDraft?.metaDescription,
    tags: articleDraft?.tags,
    readTimeMin: articleDraft?.readTimeMin,
    sources: articleDraft?.sources,
    faqs: articleDraft?.faqs,
    focusKeyword: articleDraft?.focusKeyword,
    author: articleDraft?.author,
    category: articleDraft?.category,
  })}

Flag reasons requiring a rewrite:
${flagReasonsBlock}

${humanNote ? `Human reviewer's note (address this too):\n${humanNote}\n` : ""}

Facts already confirmed verifiable — keep these, do not remove:
${verifiedBlock}

Facts that could NOT be verified — remove, soften, or rephrase as non-factual:
${unverifiableBlock}

Original brief context — primary keyword: ${brief?.primaryKeyword || "n/a"}, topic angle:
${brief?.topicAngle || "n/a"}

Return ONLY this JSON object (same fields as the input draft, content and any other flagged
fields substantially rewritten):
{"title":"","slug":"","content":"","excerpt":"","metaTitle":"","metaDescription":"","tags":[],"readTimeMin":0,"sources":[],"faqs":[{"question":"","answer":""}],"focusKeyword":"","author":"","category":""}`;

  return { system, prompt };
}
