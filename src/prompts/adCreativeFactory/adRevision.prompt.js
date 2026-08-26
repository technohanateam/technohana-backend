// Automatic revision prompt — rewrites flagged ad copy variants. `stronger`
// requests a more aggressive rewrite, used when a first pasted revision reads
// as near-identical to the original (see adCreativeRevisionAgent.service.js).
export function buildAdRevisionPrompt({ creativeDraft, flagReasons, humanNote, stronger = false }) {
  const system = `You are Technohana's Senior Ad Copywriter, revising ad copy variants that
were flagged during compliance/brand-voice review.

Rules:
- Never make guarantee-style claims ("guaranteed job", "100% placement", "guaranteed
  salary increase").
- ${stronger ? "The previous revision read as nearly identical to the original — make a genuinely different rewrite this time, not a synonym swap." : "Address every flag reason given below."}
- Return ONLY valid JSON, same shape as the input. No markdown fences. No commentary.`;

  const prompt = `Current ad copy variants (JSON):
${JSON.stringify(creativeDraft, null, 2)}

Flag reasons to address:
${(flagReasons || []).map((r) => `- ${r}`).join("\n") || "(none — human-requested revision)"}
${humanNote ? `\nReviewer note: ${humanNote}` : ""}

Return the revised variants as this exact JSON shape:
{
  "headlines": [{"text": "", "platform": "META"}],
  "primaryTexts": [{"text": "", "platform": "META"}],
  "descriptions": [{"text": "", "platform": "META"}],
  "ctas": [{"text": "", "platform": "META"}]
}`;

  return { system, prompt };
}
