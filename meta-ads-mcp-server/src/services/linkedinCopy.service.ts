import { completeJson } from './ai.service.js';

export interface LinkedInAdCopyBrief {
  productOrService: string;
  targetAudience: string;
  keyBenefit: string;
  tone?: string;
  objective?: string;
}

export interface LinkedInAdCopyResult {
  commentary: string;
  headline: string;
  description: string;
  callToActionLabel: string;
}

/** generate_ad_copy: one complete, LinkedIn-policy-aware ad copy set (professional tone, no clickbait). */
export async function generateAdCopy(brief: LinkedInAdCopyBrief): Promise<LinkedInAdCopyResult> {
  return completeJson<LinkedInAdCopyResult>({
    system:
      'You are an expert LinkedIn Ads copywriter. Write professional, credible B2B-appropriate ad copy that complies with LinkedIn advertising policy (no clickbait, no exaggerated claims, no discriminatory targeting language). Keep commentary under 150 characters so it reads well before LinkedIn truncates it, and headline under 70 characters. Return a JSON object with keys: commentary, headline, description, callToActionLabel.',
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nKey benefit: ${brief.keyBenefit}\nTone: ${brief.tone ?? 'professional and credible'}\nCampaign objective: ${brief.objective ?? 'lead generation'}\n\nWrite one strong ad copy set.`,
    maxTokens: 600,
  });
}

/** generate_headlines: several distinct headline options, each under LinkedIn's ~70-character limit. */
export async function generateHeadlines(brief: LinkedInAdCopyBrief, count = 5): Promise<string[]> {
  const result = await completeJson<{ headlines: string[] }>({
    system:
      'You are an expert LinkedIn Ads copywriter. Return a JSON object {"headlines": string[]} with professional headlines, each under 70 characters, no quotation marks, no clickbait.',
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nKey benefit: ${brief.keyBenefit}\n\nWrite ${count} distinct headline options.`,
    maxTokens: 400,
  });
  return result.headlines;
}

/** generate_descriptions: several distinct commentary (intro text) variants. */
export async function generateDescriptions(brief: LinkedInAdCopyBrief, count = 3): Promise<string[]> {
  const result = await completeJson<{ variants: string[] }>({
    system:
      'You are an expert LinkedIn Ads copywriter. Return a JSON object {"variants": string[]} with commentary (intro text) options, ideally under 150 characters so they read well before truncation, professional B2B tone, no hashtag spam.',
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nKey benefit: ${brief.keyBenefit}\nTone: ${brief.tone ?? 'professional and credible'}\n\nWrite ${count} distinct commentary variants.`,
    maxTokens: 500,
  });
  return result.variants;
}

/** LinkedIn ad call-to-action labels this recommender is allowed to choose from. */
const VALID_CTA_LABELS = [
  'APPLY',
  'DOWNLOAD',
  'VIEW_QUOTE',
  'LEARN_MORE',
  'SIGN_UP',
  'SUBSCRIBE',
  'REGISTER',
  'JOIN',
  'ATTEND',
  'REQUEST_DEMO',
  'SEE_MORE',
  'CONTACT_US',
] as const;

export interface LinkedInCtaRecommendation {
  label: (typeof VALID_CTA_LABELS)[number];
  rationale: string;
}

/** generate_cta: the single best LinkedIn CTA label for the campaign. */
export async function generateCta(brief: LinkedInAdCopyBrief): Promise<LinkedInCtaRecommendation> {
  const result = await completeJson<LinkedInCtaRecommendation>({
    system: `You are an expert LinkedIn Ads strategist. Choose the single best LinkedIn call-to-action label for this campaign from exactly this list: ${VALID_CTA_LABELS.join(', ')}. Return a JSON object {"label": "<one of the list above>", "rationale": "<one sentence>"}.`,
    prompt: `Product/service: ${brief.productOrService}\nTarget audience: ${brief.targetAudience}\nCampaign objective: ${brief.objective ?? 'lead generation'}`,
    maxTokens: 200,
  });

  if (!VALID_CTA_LABELS.includes(result.label)) {
    throw new Error(`AI returned an unrecognized CTA label: ${result.label}`);
  }
  return result;
}
