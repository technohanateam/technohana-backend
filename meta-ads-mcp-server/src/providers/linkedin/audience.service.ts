import { createHash } from 'node:crypto';
import { LINKEDIN_CACHE_NAMESPACES, LINKEDIN_CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { updateCampaign } from './campaigns.service.js';
import type { AudienceEstimate, LinkedInAudienceTargeting, LinkedInCampaign } from '../../types/linkedin.types.js';

interface RawAudienceCount {
  start: number;
  end: number;
}

/**
 * LinkedIn targeting criteria are AND-of-OR: each facet type is its own clause
 * (a campaign must match at least one value within a facet), and a member
 * must satisfy every included facet clause simultaneously. Merging every
 * facet's values into one shared `or` would instead match a member who hits
 * ANY single facet across ALL types - a materially broader, wrong audience.
 */
function buildTargetingCriteria(targeting: LinkedInAudienceTargeting): Record<string, unknown> {
  const includeClauses: Array<Record<string, unknown>> = [];
  const addIncludeClause = (facetUrn: string, values: string[] | undefined) => {
    if (values && values.length > 0) includeClauses.push({ or: { [facetUrn]: values } });
  };

  addIncludeClause('urn:li:adTargetingFacet:locations', targeting.locations?.included);
  addIncludeClause('urn:li:adTargetingFacet:industries', targeting.industries);
  addIncludeClause('urn:li:adTargetingFacet:jobFunctions', targeting.jobFunctions);
  addIncludeClause('urn:li:adTargetingFacet:titles', targeting.jobTitles);
  addIncludeClause('urn:li:adTargetingFacet:seniorities', targeting.jobSeniorities);
  addIncludeClause('urn:li:adTargetingFacet:staffCountRanges', targeting.companySizes);
  addIncludeClause('urn:li:adTargetingFacet:employers', targeting.companies);
  addIncludeClause('urn:li:adTargetingFacet:skills', targeting.skills);
  addIncludeClause('urn:li:adTargetingFacet:degrees', targeting.degrees);
  addIncludeClause('urn:li:adTargetingFacet:fieldsOfStudy', targeting.fieldsOfStudy);
  addIncludeClause('urn:li:adTargetingFacet:interests', targeting.interests);
  addIncludeClause('urn:li:adTargetingFacet:ageRanges', targeting.ageRanges);
  addIncludeClause('urn:li:adTargetingFacet:genders', targeting.genders);

  const exclude: Record<string, unknown> = {};
  if (targeting.locations?.excluded) exclude['urn:li:adTargetingFacet:locations'] = targeting.locations.excluded;
  if (targeting.excludedAudienceSegments) exclude['urn:li:adTargetingFacet:audienceMatchingSegments'] = targeting.excludedAudienceSegments;

  return {
    include: { and: includeClauses },
    ...(Object.keys(exclude).length > 0 ? { exclude: { or: exclude } } : {}),
  };
}

function targetingCacheKey(accountUrn: string, targeting: LinkedInAudienceTargeting): string {
  const hash = createHash('sha256').update(JSON.stringify(targeting)).digest('hex').slice(0, 16);
  return `${accountUrn}:${hash}`;
}

/** Estimates the reachable audience size for a targeting spec via LinkedIn's audienceCounts API. */
export async function estimateAudience(
  connectionKey: string,
  accountUrn: string,
  targeting: LinkedInAudienceTargeting,
): Promise<AudienceEstimate> {
  const cache = getCacheAdapter();
  const cacheKey = targetingCacheKey(accountUrn, targeting);
  const cached = await cache.get<AudienceEstimate>(LINKEDIN_CACHE_NAMESPACES.AUDIENCE_ESTIMATES, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<{ value: RawAudienceCount }>('/audienceCounts', {
    accessToken,
    operationName: 'estimateAudience',
    params: {
      account: accountUrn,
      targetingCriteria: JSON.stringify(buildTargetingCriteria(targeting)),
    },
  });

  const estimate: AudienceEstimate = {
    targeting,
    audienceCountLow: result.data.value.start,
    audienceCountHigh: result.data.value.end,
  };

  await cache.set(
    LINKEDIN_CACHE_NAMESPACES.AUDIENCE_ESTIMATES,
    cacheKey,
    estimate,
    LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.AUDIENCE_ESTIMATES],
  );
  return estimate;
}

/** Updates a campaign's targeting criteria. Thin wrapper over campaigns.service.updateCampaign so audience tools have a focused entry point. */
export async function updateTargeting(
  connectionKey: string,
  campaignUrn: string,
  targeting: LinkedInAudienceTargeting,
): Promise<LinkedInCampaign> {
  return updateCampaign(connectionKey, campaignUrn, { targeting });
}
