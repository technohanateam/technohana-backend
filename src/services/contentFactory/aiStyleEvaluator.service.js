import { parseModelJson } from "../../utils/parseModelJson.js";
import { buildAiStyleEvaluatorPrompt } from "../../prompts/contentFactory/aiStyleEvaluator.prompt.js";

export { buildAiStyleEvaluatorPrompt };

// Parses a manually-pasted Claude Pro response scoring aiStyleRiskScore
// (0-100, higher = more generic/formulaic/AI-sounding).
export function parseAiStyleResponse(text) {
  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new Error(`Failed to parse AI style evaluator response: ${err.message}`);
  }

  const aiStyleRiskScore = Math.max(0, Math.min(100, Number(parsed.aiStyleRiskScore) || 0));
  const flagReasons = aiStyleRiskScore >= 30 && Array.isArray(parsed.flagReasons) ? parsed.flagReasons.filter(Boolean) : [];

  return { aiStyleRiskScore, flagReasons };
}
