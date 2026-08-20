import Anthropic from "@anthropic-ai/sdk";
import { parseModelJson } from "../utils/parseModelJson.js";

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

const MODELS_BY_TIER = {
  cheap: "claude-haiku-4-5-20251001",
  standard: "claude-sonnet-4-6",
};

// Bounds every Claude call so a network/provider stall can never hang a
// caller (e.g. content-factory generation steps) indefinitely — an unbounded
// await here left generation jobs wedged at status "RUNNING" forever with no
// error ever recorded, since the step-level catch that marks a job FAILED
// only runs once the awaited call actually rejects.
const REQUEST_TIMEOUT_MS = 90_000;

// tier: "cheap" (Haiku, for cheap/high-volume calls) or "standard" (Sonnet,
// default). Returns { text, usage, model } instead of a bare string so
// callers can track token usage/cost (needed for AI Content Factory
// budget tracking) — this is a breaking change from the previous bare-string
// return; all existing callers have been updated to destructure `.text`.
export async function callClaude({ system, prompt, maxTokens = 1024, tier = "standard" }) {
  const model = MODELS_BY_TIER[tier] || MODELS_BY_TIER.standard;
  const response = await getClient().messages.create(
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    },
    { timeout: REQUEST_TIMEOUT_MS }
  );
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  // stopReason additive to the existing {text, usage, model} shape — existing
  // callers that don't destructure it are unaffected. "max_tokens" means the
  // response was cut off mid-generation (see courseFactory truncation
  // handling) rather than finishing naturally ("end_turn").
  return { text, usage: response.usage, model, stopReason: response.stop_reason };
}

// Pull a JSON object out of a model reply that may include surrounding prose
// or markdown fences.
export const extractJson = parseModelJson;
