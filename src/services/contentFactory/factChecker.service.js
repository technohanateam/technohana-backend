import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildFactCheckerPrompt } from "../../prompts/contentFactory/factChecker.prompt.js";

export { buildFactCheckerPrompt };

// Parses a manually-pasted Claude Pro response (Claude Pro's own web search
// grounds the check) into fact-check findings. Never fabricates a source —
// anything the model can't confirm via search comes back verifiable:false
// with a note, never an invented sourceUrl. Never blocks the pipeline on a
// fact-check failure — an empty/unparseable paste is treated as "nothing
// could be verified this pass" rather than throwing.
export function parseFactCheckResponse(finalText) {
  if (!finalText) {
    return { findings: [], error: "No fact-check response provided." };
  }

  let parsed;
  try {
    parsed = parseModelJson(finalText);
  } catch (err) {
    return { findings: [], error: `Failed to parse fact-checker AI response: ${err.message}` };
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

  return { findings };
}
