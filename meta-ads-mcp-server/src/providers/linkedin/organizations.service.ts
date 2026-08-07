import { LINKEDIN_CACHE_NAMESPACES, LINKEDIN_CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { idFromUrn, organizationUrn } from './urn.util.js';
import type { LinkedInOrganization } from '../../types/linkedin.types.js';

interface RawOrganizationAclElement {
  organization: string;
  role: string;
  state: string;
}

interface RawOrganizationAclsResponse {
  elements: RawOrganizationAclElement[];
}

interface RawOrganization {
  id: number;
  localizedName: string;
  vanityName?: string;
  logoV2?: { original?: string };
}

function mapOrganization(raw: RawOrganization): LinkedInOrganization {
  return {
    urn: organizationUrn(String(raw.id)),
    id: String(raw.id),
    name: raw.localizedName,
    vanityName: raw.vanityName,
    logoUrl: raw.logoV2?.original,
  };
}

export async function getOrganization(connectionKey: string, urn: string): Promise<LinkedInOrganization> {
  const cache = getCacheAdapter();
  const cached = await cache.get<LinkedInOrganization>(LINKEDIN_CACHE_NAMESPACES.ORGANIZATIONS, urn);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawOrganization>(`/organizations/${idFromUrn(urn)}`, {
    accessToken,
    operationName: 'getOrganization',
  });

  const organization = mapOrganization(result.data);
  await cache.set(LINKEDIN_CACHE_NAMESPACES.ORGANIZATIONS, urn, organization, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.ORGANIZATIONS]);
  return organization;
}

/** Lists organizations the connected member administers (ADMINISTRATOR role, approved), discovered via organizationAcls. */
export async function listOrganizations(connectionKey: string): Promise<LinkedInOrganization[]> {
  const cache = getCacheAdapter();
  const cacheKey = `${connectionKey}:list`;
  const cached = await cache.get<LinkedInOrganization[]>(LINKEDIN_CACHE_NAMESPACES.ORGANIZATIONS, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await linkedinClient.get<RawOrganizationAclsResponse>('/organizationAcls', {
    accessToken,
    operationName: 'listOrganizations',
    params: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' },
  });

  const organizations = await Promise.all(
    result.data.elements.map((element) => getOrganization(connectionKey, element.organization)),
  );

  await cache.set(LINKEDIN_CACHE_NAMESPACES.ORGANIZATIONS, cacheKey, organizations, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.ORGANIZATIONS]);
  return organizations;
}
