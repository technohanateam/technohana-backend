import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { LINKEDIN_ASSET_LIMITS, LINKEDIN_CACHE_NAMESPACES, LINKEDIN_CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/linkedinTokenManager.js';
import { linkedinClient } from './client.js';
import { idFromUrn } from './urn.util.js';
import { parseLinkedInApiError } from '../../utils/linkedinErrors.js';
import type { AssetValidationResult, LinkedInMediaAsset } from '../../types/linkedin.types.js';

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function readAsBuffer(filePathOrUrl: string): Promise<Buffer> {
  if (isRemoteUrl(filePathOrUrl)) {
    const response = await axios.get<ArrayBuffer>(filePathOrUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }
  return readFile(filePathOrUrl);
}

interface InitializeUploadResponse {
  value: { uploadUrl: string; image?: string; video?: string };
}

async function putUploadBytes(uploadUrl: string, accessToken: string, bytes: Buffer): Promise<void> {
  try {
    await axios.put(uploadUrl, bytes, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120_000,
    });
  } catch (error) {
    throw parseLinkedInApiError(error);
  }
}

async function invalidateMediaLibraryCache(accountUrn: string): Promise<void> {
  await getCacheAdapter().invalidate(LINKEDIN_CACHE_NAMESPACES.CREATIVES, `media:${accountUrn}`);
}

/**
 * Uploads an image via LinkedIn's two-step register-then-PUT flow. Handles
 * single-part uploads, which covers every image (LinkedIn's image size limit
 * is well under the single-part threshold).
 */
export async function uploadImage(
  connectionKey: string,
  accountUrn: string,
  filePathOrUrl: string,
  name: string,
): Promise<LinkedInMediaAsset> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const bytes = await readAsBuffer(filePathOrUrl);

  const init = await linkedinClient.post<InitializeUploadResponse>('/images?action=initializeUpload', {
    accessToken,
    operationName: 'initializeImageUpload',
    body: { initializeUploadRequest: { owner: accountUrn } },
  });

  const imageUrn = init.data.value.image;
  if (!imageUrn) {
    throw new Error('LinkedIn did not return an image URN when initializing the upload.');
  }

  await putUploadBytes(init.data.value.uploadUrl, accessToken, bytes);
  await invalidateMediaLibraryCache(accountUrn);

  return {
    urn: imageUrn,
    type: 'image',
    status: 'AVAILABLE',
    name,
    fileSizeBytes: bytes.length,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Uploads a video via LinkedIn's initialize/PUT/finalize flow. Implements the
 * single-part path (one uploadUrl, one PUT, one finalize call) - sufficient
 * for files under LinkedIn's per-part size ceiling; very large videos that
 * LinkedIn splits into multiple upload parts are out of scope here.
 */
export async function uploadVideo(
  connectionKey: string,
  accountUrn: string,
  filePathOrUrl: string,
  name: string,
): Promise<LinkedInMediaAsset> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const bytes = await readAsBuffer(filePathOrUrl);

  if (bytes.length > LINKEDIN_ASSET_LIMITS.maxVideoBytes) {
    throw new Error(
      `Video is ${bytes.length} bytes, exceeding LinkedIn's ${LINKEDIN_ASSET_LIMITS.maxVideoBytes}-byte limit.`,
    );
  }

  const init = await linkedinClient.post<{
    value: { uploadInstructions: Array<{ uploadUrl: string }>; video: string; uploadToken?: string };
  }>('/videos?action=initializeUpload', {
    accessToken,
    operationName: 'initializeVideoUpload',
    body: { initializeUploadRequest: { owner: accountUrn, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false } },
  });

  const videoUrn = init.data.value.video;
  const uploadInstruction = init.data.value.uploadInstructions[0];
  if (!videoUrn || !uploadInstruction) {
    throw new Error('LinkedIn did not return upload instructions when initializing the video upload.');
  }

  await putUploadBytes(uploadInstruction.uploadUrl, accessToken, bytes);

  await linkedinClient.post('/videos?action=finalizeUpload', {
    accessToken,
    operationName: 'finalizeVideoUpload',
    body: { finalizeUploadRequest: { video: videoUrn, uploadToken: init.data.value.uploadToken ?? '' } },
  });

  await invalidateMediaLibraryCache(accountUrn);

  return {
    urn: videoUrn,
    type: 'video',
    status: 'PENDING',
    name,
    fileSizeBytes: bytes.length,
    createdAt: new Date().toISOString(),
  };
}

interface RawImage {
  id: string;
  status: LinkedInMediaAsset['status'];
  altText?: string;
  downloadUrl?: string;
  fileSizeBytes?: number;
}

interface RawVideo {
  id: string;
  status: LinkedInMediaAsset['status'];
  title?: string;
  downloadUrl?: string;
  fileSizeBytes?: number;
}

export async function listMediaLibrary(connectionKey: string, accountUrn: string): Promise<LinkedInMediaAsset[]> {
  const cache = getCacheAdapter();
  const cacheKey = `media:${accountUrn}`;
  const cached = await cache.get<LinkedInMediaAsset[]>(LINKEDIN_CACHE_NAMESPACES.CREATIVES, cacheKey);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const [images, videos] = await Promise.all([
    linkedinClient.get<{ elements: RawImage[] }>('/images', {
      accessToken,
      operationName: 'listImages',
      params: { q: 'owner', owner: accountUrn },
    }),
    linkedinClient.get<{ elements: RawVideo[] }>('/videos', {
      accessToken,
      operationName: 'listVideos',
      params: { q: 'owner', owner: accountUrn },
    }),
  ]);

  const assets: LinkedInMediaAsset[] = [
    ...images.data.elements.map((img) => ({
      urn: img.id,
      type: 'image' as const,
      status: img.status,
      name: img.altText ?? img.id,
      downloadUrl: img.downloadUrl,
      createdAt: new Date().toISOString(),
    })),
    ...videos.data.elements.map((vid) => ({
      urn: vid.id,
      type: 'video' as const,
      status: vid.status,
      name: vid.title ?? vid.id,
      downloadUrl: vid.downloadUrl,
      createdAt: new Date().toISOString(),
    })),
  ];

  await cache.set(LINKEDIN_CACHE_NAMESPACES.CREATIVES, cacheKey, assets, LINKEDIN_CACHE_TTL_SECONDS[LINKEDIN_CACHE_NAMESPACES.CREATIVES]);
  return assets;
}

export async function validateAsset(
  connectionKey: string,
  assetUrn: string,
  intendedType: 'image' | 'video',
): Promise<AssetValidationResult> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const path = intendedType === 'image' ? `/images/${idFromUrn(assetUrn)}` : `/videos/${idFromUrn(assetUrn)}`;
  const result = await linkedinClient.get<RawImage | RawVideo>(path, {
    accessToken,
    operationName: 'validateAsset',
  });

  const issues: string[] = [];
  if (result.data.status !== 'AVAILABLE') {
    issues.push(`Asset status is '${result.data.status}', not 'AVAILABLE'. It may still be processing or have failed.`);
  }

  const fileSizeBytes = result.data.fileSizeBytes ?? 0;
  const maxBytes = intendedType === 'image' ? LINKEDIN_ASSET_LIMITS.maxImageBytes : LINKEDIN_ASSET_LIMITS.maxVideoBytes;
  if (fileSizeBytes > maxBytes) {
    issues.push(`Asset is ${fileSizeBytes} bytes, exceeding LinkedIn's ${maxBytes}-byte limit for ${intendedType}s.`);
  }

  return {
    valid: issues.length === 0,
    issues,
    type: intendedType,
    fileSizeBytes,
  };
}
