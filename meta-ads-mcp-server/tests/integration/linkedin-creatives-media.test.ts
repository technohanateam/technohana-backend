import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from '../setup.js';
import { deleteToken, storeToken } from '../../src/auth/linkedinTokenManager.js';
import { LINKEDIN_API_BASE_URL } from '../../src/config/constants.js';
import { initMcpSession, callTool, parseMcpResponse } from './mcpTestHelpers.js';

const CONNECTION_KEY = 'urn:li:organization:linkedin-creatives-media-test';
const ACCOUNT_URN = 'urn:li:sponsoredAccount:777';

interface CallToolResultBody {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

describe('LinkedIn creatives & media tools (real HTTP + MCP stack, LinkedIn API mocked)', () => {
  beforeEach(async () => {
    await storeToken({
      key: CONNECTION_KEY,
      accessToken: 'seeded-linkedin-access-token',
      refreshToken: 'seeded-refresh-token',
      obtainedAt: Date.now(),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
      scopes: ['rw_ads'],
      organizationUrn: CONNECTION_KEY,
    });
  });

  afterEach(async () => {
    await deleteToken(CONNECTION_KEY);
  });

  it('uploads an image via the initialize+PUT flow and returns its asset URN', async () => {
    let putReceivedAuth = '';

    mswServer.use(
      http.get('https://example.com/fake.png', () => new HttpResponse(Buffer.from('fake-image-bytes'))),
      http.post(`${LINKEDIN_API_BASE_URL}/images`, async ({ request: req }) => {
        expect(new URL(req.url).searchParams.get('action')).toBe('initializeUpload');
        const body = (await req.json()) as { initializeUploadRequest: { owner: string } };
        expect(body.initializeUploadRequest.owner).toBe(ACCOUNT_URN);
        return HttpResponse.json({
          value: { uploadUrl: 'https://upload.linkedin.com/mediaUpload/fake-image', image: 'urn:li:image:C4D-abc123' },
        });
      }),
      http.put('https://upload.linkedin.com/mediaUpload/fake-image', ({ request: req }) => {
        putReceivedAuth = req.headers.get('Authorization') ?? '';
        return new HttpResponse(null, { status: 201 });
      }),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_upload_image', {
      connectionKey: CONNECTION_KEY,
      accountUrn: ACCOUNT_URN,
      filePathOrUrl: 'https://example.com/fake.png',
      name: 'hero-banner',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const asset = JSON.parse(body.result!.content[0].text);
    expect(asset).toMatchObject({ urn: 'urn:li:image:C4D-abc123', type: 'image', status: 'AVAILABLE' });
    expect(putReceivedAuth).toBe('Bearer seeded-linkedin-access-token');
  });

  it('creates a single image ad creative and returns the full, freshly-fetched object', async () => {
    let capturedBody: unknown;

    mswServer.use(
      http.post(`${LINKEDIN_API_BASE_URL}/adCreatives`, async ({ request: req }) => {
        capturedBody = await req.json();
        return new HttpResponse(null, { status: 201, headers: { 'x-restli-id': '901' } });
      }),
      http.get(`${LINKEDIN_API_BASE_URL}/adCreatives/901`, () =>
        HttpResponse.json({
          id: 901,
          account: ACCOUNT_URN,
          campaign: 'urn:li:sponsoredCampaign:555',
          type: 'SINGLE_IMAGE',
          status: 'DRAFT',
          commentary: 'Check out our new course',
          content: { media: { id: 'urn:li:image:C4D-abc123', title: 'New Course' } },
          landingPage: 'https://example.com/course',
          createdAt: 1700000000000,
          lastModifiedAt: 1700000000000,
        }),
      ),
    );

    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_create_single_image_ad', {
      connectionKey: CONNECTION_KEY,
      accountUrn: ACCOUNT_URN,
      campaignUrn: 'urn:li:sponsoredCampaign:555',
      name: 'Hero creative',
      imageAssetUrn: 'urn:li:image:C4D-abc123',
      commentary: 'Check out our new course',
      headline: 'New Course',
      landingPageUrl: 'https://example.com/course',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const creative = JSON.parse(body.result!.content[0].text);
    expect(creative).toMatchObject({
      id: '901',
      type: 'SINGLE_IMAGE',
      status: 'DRAFT',
      commentary: 'Check out our new course',
      imageAssetUrn: 'urn:li:image:C4D-abc123',
    });
    expect((capturedBody as { status: string }).status).toBe('DRAFT');
  });

  it('rejects a carousel ad with fewer than 2 cards before any HTTP call is made', async () => {
    const session = await initMcpSession('advertiser');
    const res = await callTool(session, 'linkedin_create_carousel_ad', {
      connectionKey: CONNECTION_KEY,
      accountUrn: ACCOUNT_URN,
      campaignUrn: 'urn:li:sponsoredCampaign:555',
      name: 'Bad carousel',
      commentary: 'Not enough cards',
      cards: [{ imageAssetUrn: 'urn:li:image:only-one', headline: 'Only one', landingPageUrl: 'https://example.com/1' }],
    });
    expect(res.status).toBe(200);
    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBe(true);
  });

  it('flags an asset that is still processing as invalid', async () => {
    mswServer.use(
      http.get(`${LINKEDIN_API_BASE_URL}/images/C4D-processing`, () =>
        HttpResponse.json({ id: 'urn:li:image:C4D-processing', status: 'PENDING' }),
      ),
    );

    const session = await initMcpSession('viewer');
    const res = await callTool(session, 'linkedin_validate_asset', {
      connectionKey: CONNECTION_KEY,
      assetUrn: 'urn:li:image:C4D-processing',
      intendedType: 'image',
    });

    const body = parseMcpResponse<CallToolResultBody>(res);
    expect(body.result?.isError).toBeFalsy();
    const result = JSON.parse(body.result!.content[0].text);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatch(/PENDING/);
  });
});
