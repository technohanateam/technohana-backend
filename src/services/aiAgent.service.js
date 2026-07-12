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

export async function callClaude({ system, prompt, maxTokens = 1024 }) {
  const response = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

// Pull a JSON object out of a model reply that may include surrounding prose
// or markdown fences.
export const extractJson = parseModelJson;
