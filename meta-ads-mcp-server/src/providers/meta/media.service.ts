import { readFile } from 'node:fs/promises';
import axios from 'axios';
import FormData from 'form-data';
import { CACHE_NAMESPACES, CACHE_TTL_SECONDS, META_GRAPH_BASE_URL } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import { parseMetaApiError } from '../../utils/metaErrors.js';
import { withRetry } from '../../utils/retry.js';
import { logger } from '../../utils/logger.js';
import type { MetaMediaAsset } from '../../types/meta.types.js';

/** Long timeout: video uploads for local files stream the whole payload in one request. */
const uploadHttpClient = axios.create({ baseURL: META_GRAPH_BASE_URL, timeout: 120_000 });

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function readAsBase64(filePathOrUrl: string): Promise<string> {
  if (isRemoteUrl(filePathOrUrl)) {
    const response = await axios.get<ArrayBuffer>(filePathOrUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data).toString('base64');
  }
  const buffer = await readFile(filePathOrUrl);
  return buffer.toString('base64');
}

/**
 * Uploads an image to the ad account's image library. Meta's /adimages endpoint
 * treats each non-reserved body field as `<name>: base64Bytes` and echoes the
 * result back keyed by that same name.
 */
export async function uploadImage(
  connectionKey: string,
  accountId: string,
  filePathOrUrl: string,
  name: string,
): Promise<MetaMediaAsset> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const bytes = await readAsBase64(filePathOrUrl);

  const result = await metaClient.post<{ images: Record<string, { hash: string; url?: string }> }>(
    `/${normalizeAccountId(accountId)}/adimages`,
    { accessToken, operationName: 'uploadImage', body: { [name]: bytes } },
  );

  const uploaded = result.data.images[name];
  if (!uploaded) {
    throw new Error('Meta did not return the uploaded image in the response.');
  }

  await getCacheAdapter().invalidate(CACHE_NAMESPACES.ASSET_LIBRARY, normalizeAccountId(accountId));

  return {
    id: uploaded.hash,
    type: 'image',
    hash: uploaded.hash,
    url: uploaded.url,
    name,
    createdTime: new Date().toISOString(),
  };
}

/**
 * Uploads a video to the ad account's video library. Remote URLs are fetched
 * server-side by Meta via `file_url`; local files are streamed as multipart
 * form data.
 */
export async function uploadVideo(
  connectionKey: string,
  accountId: string,
  filePathOrUrl: string,
  name: string,
): Promise<MetaMediaAsset> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const path = `/${normalizeAccountId(accountId)}/advideos`;

  const uploaded = await withRetry(
    async () => {
      try {
        if (isRemoteUrl(filePathOrUrl)) {
          const response = await uploadHttpClient.post<{ id: string }>(path, null, {
            params: { access_token: accessToken, file_url: filePathOrUrl, name },
          });
          return response.data;
        }

        const form = new FormData();
        form.append('access_token', accessToken);
        form.append('name', name);
        form.append('source', await readFile(filePathOrUrl), { filename: name });

        const response = await uploadHttpClient.post<{ id: string }>(path, form, {
          headers: form.getHeaders(),
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
        return response.data;
      } catch (error) {
        throw parseMetaApiError(error);
      }
    },
    { logger, operationName: 'uploadVideo' },
  );

  await getCacheAdapter().invalidate(CACHE_NAMESPACES.ASSET_LIBRARY, normalizeAccountId(accountId));

  return { id: uploaded.id, type: 'video', name, createdTime: new Date().toISOString() };
}

interface RawAdImage {
  hash: string;
  url?: string;
  name?: string;
  created_time?: string;
}

interface RawAdVideo {
  id: string;
  title?: string;
  created_time?: string;
}

/** Lists every image and video in the ad account's asset library. */
export async function listAssetLibrary(connectionKey: string, accountId: string): Promise<MetaMediaAsset[]> {
  const cache = getCacheAdapter();
  const normalizedAccountId = normalizeAccountId(accountId);
  const cached = await cache.get<MetaMediaAsset[]>(CACHE_NAMESPACES.ASSET_LIBRARY, normalizedAccountId);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const [images, videos] = await Promise.all([
    metaClient.get<{ data: RawAdImage[] }>(`/${normalizedAccountId}/adimages`, {
      accessToken,
      operationName: 'listAssetLibraryImages',
      params: { fields: 'hash,url,name,created_time', limit: 200 },
    }),
    metaClient.get<{ data: RawAdVideo[] }>(`/${normalizedAccountId}/advideos`, {
      accessToken,
      operationName: 'listAssetLibraryVideos',
      params: { fields: 'id,title,created_time', limit: 200 },
    }),
  ]);

  const assets: MetaMediaAsset[] = [
    ...images.data.data.map((img) => ({
      id: img.hash,
      type: 'image' as const,
      hash: img.hash,
      url: img.url,
      name: img.name ?? img.hash,
      createdTime: img.created_time ?? new Date().toISOString(),
    })),
    ...videos.data.data.map((vid) => ({
      id: vid.id,
      type: 'video' as const,
      name: vid.title ?? vid.id,
      createdTime: vid.created_time ?? new Date().toISOString(),
    })),
  ];

  await cache.set(
    CACHE_NAMESPACES.ASSET_LIBRARY,
    normalizedAccountId,
    assets,
    CACHE_TTL_SECONDS[CACHE_NAMESPACES.ASSET_LIBRARY],
  );
  return assets;
}
