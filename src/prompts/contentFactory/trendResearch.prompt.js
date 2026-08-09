// Builds the system/user prompt for trendResearch.service.js's single
// web-search-grounded Claude call, made ONCE PER TOPIC CLUSTER (never
// per-course — see docs/AI_CONTENT_FACTORY_IMPLEMENTATION.md Milestone 5 for
// the cost-control rationale). Mirrors factChecker.prompt.js's anti-fabrication
// rules since this call also has web_search access and must never invent a
// source to satisfy the JSON contract.
export function buildTrendResearchPrompt({ cluster }) {
  const year = new Date().getFullYear();

  const system = `You are a trend researcher for Technohana, a live instructor-led tech training company. You cover the "${cluster.name}" topic cluster (categories: ${(cluster.categories || []).join(", ") || "n/a"}).

You have access to a web search tool. Use it to find genuinely current, real developments — new
product/model releases, framework updates, certification changes, notable industry news — from
roughly the last 30-60 days.

Rules:
- Search before naming a trend. Never state a trend exists without having found it via search.
- Never invent or guess a source URL. Every trend you report must include at least one real
  sourceUrl you found via search. If you cannot find a credible source, omit that trend entirely
  rather than including it with a fabricated or guessed URL.
- Do not pad the list with generic evergreen advice — only genuinely new/current developments.
- Return 0-6 trends. Returning fewer real trends is better than padding with weak ones.
- Return ONLY valid JSON. No markdown. No explanations outside the JSON.`;

  const prompt = `Current year: ${year}
Cluster: ${cluster.name}
Cluster description: ${cluster.description || "n/a"}
Relevant categories: ${(cluster.categories || []).join(", ") || "n/a"}

Search for current trending topics, news, and developments relevant to this cluster that would
matter to a corporate training company deciding what to write about next.

Return ONLY this JSON object:
{"trends":[{"topic":"short trend name","summary":"2-3 sentence summary of what's new and why it matters","sourceUrls":["https://..."]}]}`;

  return { system, prompt };
}
