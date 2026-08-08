// aiStyleEvaluator.service.js — one cheap-tier call scoring how
// generic/formulaic/"AI-sounding" an article reads. The avoid-list below is
// the SAME shared list articleWriter.prompt.js/revisionAgent.prompt.js are
// instructed to avoid — so this evaluator never flags a pattern the writer
// was never told about, and never drifts out of sync if the list is edited.
import { buildEditorialProfileBlock } from "./editorialProfile.js";

export function buildAiStyleEvaluatorPrompt({ articleContent }) {
  const system = `You are an editorial style reviewer trained to detect generic, formulaic,
AI-sounding writing versus genuinely distinctive human-edited writing.

${buildEditorialProfileBlock()}

Look for signals such as:
- Formulaic transition words used repeatedly ("Moreover,", "Furthermore,", "In conclusion,",
  "Additionally,")
- Generic hedging ("it's important to note that", "in today's fast-paced world")
- Repetitive paragraph/sentence structure (every paragraph the same length/shape)
- Generic, interchangeable intro or conclusion patterns that could apply to any topic
- Listicle-y "unlock your potential" style marketing filler
- Overuse of rhetorical questions as section openers
- Any of the "avoid" items listed above

Score aiStyleRiskScore 0-100 where 0 = reads naturally distinctive/human-edited, 100 = maximally
generic/formulaic/AI-sounding. Only include flagReasons when the score is meaningfully elevated
(roughly 30+) — cite the specific pattern(s) found, don't restate the rubric.

Return ONLY valid JSON. No markdown. No explanations outside the JSON.`;

  const plainText = String(articleContent || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  const prompt = `Article content (plain text):
${plainText}

Return ONLY this JSON object:
{"aiStyleRiskScore":0,"flagReasons":[]}`;

  return { system, prompt };
}
