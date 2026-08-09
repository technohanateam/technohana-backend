// Builds the system/user prompt for factChecker.service.js's single
// web-search-grounded Claude call. The model must never fabricate a source —
// any claim it can't verify via search gets `verifiable:false` with a note.
export function buildFactCheckerPrompt({ articleDraft }) {
  const year = new Date().getFullYear();

  const system = `You are a meticulous fact-checker for Technohana's published blog content.

You have access to a web search tool. Use it to verify factual/current claims in the article
below — dates, version numbers, pricing, certification/product details, statistics, model
names, and similar claims that could go stale or be wrong.

Rules:
- Search before deciding a claim is verifiable. Never mark a claim verifiable without having
  actually searched for it.
- Never invent or guess a source URL. If you cannot find a supporting source via search, mark
  the claim verifiable:false and explain why in "note" — do not fabricate a citation to make
  the claim look verified.
- Only include claims that are genuinely checkable facts (not opinions, not generic advice).
- Keep the list focused — the 5-12 most check-worthy claims, not every sentence.
- Return ONLY valid JSON. No markdown. No explanations outside the JSON.`;

  const plainText = String(articleDraft?.content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  const prompt = `Current year: ${year}

Article title: ${articleDraft?.title || "(untitled)"}

Article content (plain text):
${plainText}

Identify factual/current claims (dates, versions, pricing, certification/product details,
statistics, named models/tools) and verify each via web search.

Return ONLY this JSON object:
{"findings":[{"claim":"","verifiable":true,"note":"","sourceUrl":""}]}

For unverifiable claims, set "verifiable":false, leave "sourceUrl" empty, and explain in "note"
why it couldn't be confirmed (e.g. "no search result addresses this specific figure").`;

  return { system, prompt };
}
