import { parseModelJson } from "../../utils/parseModelJson.js";
import { runClaudeWebSearchLoop } from "../../utils/claudeWebSearchLoop.js";
import { buildFactCheckerPrompt } from "../../prompts/contentFactory/factChecker.prompt.js";
import { recordAiUsage } from "./aiUsageTracker.service.js";

// Milestone 3 — real search-grounded fact-checking. From the orchestrator's
// perspective this is ONE step (the web-search loop may take several turns
// internally, same pattern as articleWriter.service.js). Never fabricates a
// source — anything the model can't confirm via search comes back
// verifiable:false with a note, never an invented sourceUrl.
//
// Milestone 4: doesn't route through trackedCallClaude() (it uses the
// axios-based web-search loop, not callClaude()'s simple shape), but still
// records the accumulated token usage from the loop as its own AiUsageLog
// row so cost visibility isn't lost for this step.
export async function factCheckArticle(articleDraft, opportunityId = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const { system, prompt } = buildFactCheckerPrompt({ articleDraft });

  const { finalText, usage, model } = await runClaudeWebSearchLoop({
    apiKey,
    system,
    prompt,
    model: "claude-sonnet-5",
    maxTokens: 4096,
    maxTurns: 5,
    timeout: 120000,
  });

  await recordAiUsage({
    model,
    tier: "standard",
    tokensIn: usage?.input_tokens || 0,
    tokensOut: usage?.output_tokens || 0,
    callType: "factCheck",
    opportunityId,
  });

  if (!finalText) {
    // Never block the pipeline on a fact-check failure — treat as "nothing
    // could be verified this pass" rather than throwing.
    return { findings: [], usage, model, error: "Claude did not produce a final fact-check response." };
  }

  let parsed;
  try {
    parsed = parseModelJson(finalText);
  } catch (err) {
    return { findings: [], usage, model, error: `Failed to parse fact-checker AI response: ${err.message}` };
  }

  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .filter((f) => f && f.claim)
        .map((f) => ({
          claim: String(f.claim),
          // Never trust a claimed verifiable:true unless a sourceUrl actually
          // came with it — belt-and-suspenders against a model asserting
          // verification without grounding.
          verifiable: Boolean(f.verifiable) && Boolean(f.sourceUrl),
          note: f.note || (f.verifiable && !f.sourceUrl ? "Marked verifiable without a source URL — downgraded." : null),
          sourceUrl: f.sourceUrl || null,
        }))
    : [];

  return { findings, usage, model };
}
