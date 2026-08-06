import { completeJson } from './ai.service.js';

export interface AdCopyBrief {
  productOrService: string;
  targetAudience: string;
  keyBenefit: string;
  tone?: string;
  objective?: string;
}

export interface AdCopyResult {
  primaryText: string;
  headline: string;
  description: string;
  callToAction: string;
}

/** generate_ad_copy: one complete, Meta-policy-aware ad copy set. */
export async function generateAdCopy(brief: AdCopyBrief): Promise<AdCopyResult> {
  return completeJson<AdCopyResult>({
    system:
      'You are an expert Meta (Facebook/Instagram) ads copywriter. Write concise, high-converting ad copy that complies with Meta advertising policy (no exaggerated claims, no prohibited content, no "you" implying knowledge of personal attributes). Return a JSON object with keys: primaryText, headline, description, callToAction.',
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nKey benefit: ${brief.keyBenefit}\nTone: ${brief.tone ?? 'confident and friendly'}\nCampaign objective: ${brief.objective ?? 'conversions'}\n\nWrite one strong ad copy set.`,
    maxTokens: 600,
  });
}

/** generate_headlines: several distinct headline options, each Meta's ~40-char limit. */
export async function generateHeadlines(brief: AdCopyBrief, count = 5): Promise<string[]> {
  const result = await completeJson<{ headlines: string[] }>({
    system:
      'You are an expert Meta ads copywriter. Return a JSON object {"headlines": string[]} with punchy headlines, each under 40 characters, no quotation marks.',
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nKey benefit: ${brief.keyBenefit}\n\nWrite ${count} distinct headline options.`,
    maxTokens: 400,
  });
  return result.headlines;
}

/** generate_primary_text: several distinct primary-text variants. */
export async function generatePrimaryText(brief: AdCopyBrief, count = 3): Promise<string[]> {
  const result = await completeJson<{ variants: string[] }>({
    system:
      'You are an expert Meta ads copywriter. Return a JSON object {"variants": string[]} with primary ad text options (90-125 characters each is ideal), no hashtags, no emoji spam.',
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nKey benefit: ${brief.keyBenefit}\nTone: ${brief.tone ?? 'confident and friendly'}\n\nWrite ${count} distinct primary text variants.`,
    maxTokens: 500,
  });
  return result.variants;
}

/** Meta call-to-action button types this recommender is allowed to choose from. */
const VALID_CTA_TYPES = [
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'DOWNLOAD',
  'BOOK_TRAVEL',
  'CONTACT_US',
  'SUBSCRIBE',
  'GET_QUOTE',
  'APPLY_NOW',
  'GET_OFFER',
  'WATCH_MORE',
] as const;

export interface CtaRecommendation {
  type: (typeof VALID_CTA_TYPES)[number];
  rationale: string;
}

/** generate_cta: the single best Meta CTA button type for the campaign. */
export async function generateCta(brief: AdCopyBrief): Promise<CtaRecommendation> {
  const result = await completeJson<CtaRecommendation>({
    system: `You are an expert Meta ads strategist. Choose the single best Meta call-to-action button type for this campaign from exactly this list: ${VALID_CTA_TYPES.join(', ')}. Return a JSON object {"type": "<one of the list above>", "rationale": "<one sentence>"}.`,
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nCampaign objective: ${brief.objective ?? 'conversions'}`,
    maxTokens: 200,
  });

  if (!VALID_CTA_TYPES.includes(result.type)) {
    throw new Error(`AI returned an unrecognized CTA type: ${result.type}`);
  }
  return result;
}
