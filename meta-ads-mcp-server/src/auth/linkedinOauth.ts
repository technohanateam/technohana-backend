import axios from 'axios';
import { LINKEDIN_API_BASE_URL, LINKEDIN_OAUTH_DIALOG_URL } from '../config/constants.js';
import { env, linkedinOAuthScopes } from '../config/env.js';
import { parseLinkedInApiError } from '../utils/linkedinErrors.js';
import { logger } from '../utils/logger.js';
import { exchangeCodeForTokens, storeToken, type LinkedInTokenRecord } from './linkedinTokenManager.js';

interface LinkedInOrganizationAclElement {
  organization: string;
  role: string;
  state: string;
}

interface LinkedInOrganizationAclsResponse {
  elements: LinkedInOrganizationAclElement[];
}

interface LinkedInOrganizationResponse {
  id: number;
  localizedName: string;
}

/** Builds the LinkedIn OAuth authorization dialog URL the user is redirected to for /auth/linkedin/login. */
export function buildAuthorizationUrl(state: string): string {
  const url = new URL(LINKEDIN_OAUTH_DIALOG_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.LINKEDIN_OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', linkedinOAuthScopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

/** Organizations the authenticated member administers, discovered via organizationAcls. */
async function fetchAdministeredOrganizationUrns(accessToken: string): Promise<string[]> {
  try {
    const response = await axios.get<LinkedInOrganizationAclsResponse>(`${LINKEDIN_API_BASE_URL}/organizationAcls`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': env.LINKEDIN_API_VERSION, 'X-Restli-Protocol-Version': '2.0.0' },
      params: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' },
    });
    return response.data.elements.map((element) => element.organization);
  } catch (error) {
    throw parseLinkedInApiError(error);
  }
}

function organizationIdFromUrn(urn: string): string {
  return urn.split(':').pop() ?? urn;
}

async function fetchOrganizationName(accessToken: string, organizationUrn: string): Promise<string | undefined> {
  try {
    const response = await axios.get<LinkedInOrganizationResponse>(
      `${LINKEDIN_API_BASE_URL}/organizations/${organizationIdFromUrn(organizationUrn)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': env.LINKEDIN_API_VERSION, 'X-Restli-Protocol-Version': '2.0.0' },
      },
    );
    return response.data.localizedName;
  } catch (error) {
    logger.warn({ err: error, organizationUrn }, 'linkedin_organization_name_lookup_failed');
    return undefined;
  }
}

/**
 * Completes the OAuth code exchange and persists one token record per
 * organization the member administers (discovered via organizationAcls). If
 * the member administers no organizations, a single 'personal' record is
 * stored instead, mirroring the Meta OAuth flow's fallback for users without
 * a Business Manager.
 */
export async function handleOAuthCallback(code: string): Promise<LinkedInTokenRecord[]> {
  const tokens = await exchangeCodeForTokens(code);
  const organizationUrns = await fetchAdministeredOrganizationUrns(tokens.accessToken);

  const obtainedAt = Date.now();
  const baseRecord = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    obtainedAt,
    expiresAt: tokens.expiresAt,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    scopes: linkedinOAuthScopes,
  };

  const records: LinkedInTokenRecord[] =
    organizationUrns.length > 0
      ? await Promise.all(
          organizationUrns.map(async (organizationUrn) => ({
            ...baseRecord,
            key: organizationUrn,
            organizationUrn,
            organizationName: await fetchOrganizationName(tokens.accessToken, organizationUrn),
          })),
        )
      : [{ ...baseRecord, key: 'personal' }];

  for (const record of records) {
    await storeToken(record);
  }

  logger.info({ connections: records.map((r) => r.key) }, 'linkedin_oauth_connected');

  return records;
}
