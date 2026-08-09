// Single source of truth for Technohana's editorial voice/audience/style rules,
// shared by every content-factory prompt that writes or judges prose (writer,
// revision agent, AI-style evaluator) so the three can never drift out of sync
// with each other — e.g. the style evaluator flagging a pattern the writer was
// never told to avoid, or a revision losing the voice the writer used.
//
// Deliberately a plain JS module, not a DB model/admin UI — the plan explicitly
// asks for "lightweight," and nothing here needs runtime editing without a
// deploy; if that need appears later, this is a natural single place to move
// into a settings doc (mirrors how `contentFactorySettings.model.js` already
// holds other prompt-adjacent knobs like `aiStyleRiskThreshold`).

export const EDITORIAL_PROFILE = {
  voice: ["expert", "practical", "approachable", "professional", "technically accurate"],
  audience: [
    "technology professionals",
    "learners",
    "managers",
    "technical decision-makers",
    "corporate L&D audiences",
  ],
  prefer: [
    "specific examples",
    "practical explanations",
    "real-world scenarios",
    "useful recommendations",
    "technical accuracy",
    "natural variation in structure and phrasing",
    "depth appropriate to the topic and audience",
  ],
  avoid: [
    "generic AI-sounding introductions",
    "repetitive paragraph/section structures",
    "unnecessary headings that add no navigational value",
    "keyword stuffing",
    "excessive marketing language",
    "artificial enthusiasm",
    "filler sentences that restate the obvious",
    "repetitive, formulaic conclusions",
  ],
};

// Formatted block for interpolation into a prompt's system/instruction text.
export function buildEditorialProfileBlock() {
  const { voice, audience, prefer, avoid } = EDITORIAL_PROFILE;
  return `Technohana editorial voice: ${voice.join(", ")}.
Write for: ${audience.join("; ")}.
Prefer: ${prefer.join("; ")}.
Avoid: ${avoid.join("; ")}.`;
}
