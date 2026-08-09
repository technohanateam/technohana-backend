import axios from "axios";

// Shared agentic web-search loop (Milestone 3 extraction). Mechanically lifted
// from admin.routes.js's `POST /admin/blogs/generate-from-course` handler —
// same request shape, same turn limit, same stop-reason handling — so that
// route's behavior is byte-identical before/after switching to this util.
// factChecker.service.js (M3) is the second consumer. articleWriter.service.js
// (M2) deliberately keeps its own inline copy — see
// docs/AI_CONTENT_FACTORY_IMPLEMENTATION.md "As-built — Milestone 3" for why.
//
// Returns { finalText, usage: {input_tokens, output_tokens}, model, turns }.
// Never throws for a non-end_turn stop reason — mirrors the original route's
// "break out, finalText stays empty" behavior, letting the caller decide how
// to report that.
export async function runClaudeWebSearchLoop({
  apiKey,
  system,
  prompt,
  model = "claude-sonnet-5",
  maxTokens = 8192,
  maxTurns = 5,
  timeout = 120000,
}) {
  const messages = [{ role: "user", content: prompt }];
  const tools = [{ type: "web_search_20260209", name: "web_search" }];
  let finalText = "";
  const usage = { input_tokens: 0, output_tokens: 0 };
  let turns = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    turns = turn + 1;
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        timeout,
      }
    );

    const { stop_reason, content, usage: turnUsage } = response.data;
    if (turnUsage) {
      usage.input_tokens += turnUsage.input_tokens || 0;
      usage.output_tokens += turnUsage.output_tokens || 0;
    }

    // Append assistant turn to message history (includes embedded search
    // results for built-in tools like web_search_20260209 — the API handles
    // these server-side).
    messages.push({ role: "assistant", content });

    if (stop_reason === "end_turn") {
      const textBlock = content.find((b) => b.type === "text");
      finalText = textBlock?.text?.trim() || "";
      break;
    }

    if (stop_reason === "tool_use") {
      // Search results are already embedded in the response content by the
      // API. Just continue — do NOT fabricate tool_result blocks.
      continue;
    }

    // Any other stop reason — bail out.
    break;
  }

  return { finalText, usage, model, turns };
}
