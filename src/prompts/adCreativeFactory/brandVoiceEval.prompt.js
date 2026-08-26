// Optional, skippable brand-voice/tone evaluation prompt for the
// COMPLIANCE_GATE step. An admin can choose not to run this at all and send
// the draft straight to human review — a human reviewer judges tone anyway.
export function buildBrandVoiceEvalPrompt({ creativeDraft }) {
  const system = `You are Technohana's Brand Voice Reviewer. Score how well a set of ad copy
variants matches Technohana's brand voice: confident but not hype-y, specific rather than
generic, professional but approachable — never salesy or clickbait-y.

Return ONLY valid JSON. No markdown fences. No commentary.`;

  const allText = [
    ...(creativeDraft.headlines || []).map((v) => v.text),
    ...(creativeDraft.primaryTexts || []).map((v) => v.text),
    ...(creativeDraft.descriptions || []).map((v) => v.text),
  ].join("\n---\n");

  const prompt = `Ad copy variants to review:
${allText}

Score brandVoiceRiskScore 0-100 (higher = further from brand voice — too hype-y, generic,
clickbait, or off-tone). Return:
{
  "brandVoiceRiskScore": 0,
  "flagReasons": [""]
}`;

  return { system, prompt };
}
