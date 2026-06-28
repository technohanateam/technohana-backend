import Anthropic from "@anthropic-ai/sdk";

// Shared Claude client for backend AI agents (lead scoring, recovery emails).
// Callers must handle thrown errors and fall back to non-AI behaviour.

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function callClaude({ system, prompt, maxTokens = 1024, model = "claude-sonnet-4-6" }) {
  const response = await getClient().beta.promptCaching.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });
  const u = response.usage;
  console.log(`[AI] model=${model} in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`);
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

// Pull a JSON object out of a model reply that may include surrounding prose
// or markdown fences.
export function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(text.slice(start, end + 1));
}
