import { CACHE_NAMESPACES, CACHE_TTL_SECONDS } from '../../config/constants.js';
import { getCacheAdapter } from '../../cache/cache.factory.js';
import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import type { ConversionApiDiagnostic, MetaPixel, MetaPixelEvent } from '../../types/meta.types.js';

const PIXEL_FIELDS = 'id,name,last_fired_time';

interface RawPixel {
  id: string;
  name: string;
  last_fired_time?: string;
}

interface RawPixelStatsBucketItem {
  event: string;
  count?: number;
  action_source?: string;
}

interface RawPixelStatsResponse {
  data: Array<{ start_time: string; end_time: string; data: RawPixelStatsBucketItem[] }>;
}

export async function listPixels(connectionKey: string, accountId: string): Promise<MetaPixel[]> {
  const cache = getCacheAdapter();
  const normalizedAccountId = normalizeAccountId(accountId);
  const cached = await cache.get<MetaPixel[]>(CACHE_NAMESPACES.PIXELS, normalizedAccountId);
  if (cached) return cached;

  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<{ data: RawPixel[] }>(`/${normalizedAccountId}/adspixels`, {
    accessToken,
    operationName: 'listPixels',
    params: { fields: PIXEL_FIELDS, limit: 200 },
  });

  const pixels = result.data.data.map((pixel) => ({
    id: pixel.id,
    name: pixel.name,
    lastFiredTime: pixel.last_fired_time,
  }));
  await cache.set(CACHE_NAMESPACES.PIXELS, normalizedAccountId, pixels, CACHE_TTL_SECONDS[CACHE_NAMESPACES.PIXELS]);
  return pixels;
}

/** Aggregates pixel event counts by event name over the given window. */
export async function getPixelEvents(
  connectionKey: string,
  pixelId: string,
  since?: string,
  until?: string,
): Promise<MetaPixelEvent[]> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<RawPixelStatsResponse>(`/${pixelId}/stats`, {
    accessToken,
    operationName: 'getPixelEvents',
    params: { aggregation: 'event', start_time: since, end_time: until },
  });

  const totals = new Map<string, number>();
  for (const bucket of result.data.data) {
    for (const item of bucket.data) {
      totals.set(item.event, (totals.get(item.event) ?? 0) + (item.count ?? 0));
    }
  }
  return [...totals.entries()].map(([eventName, count]) => ({ eventName, count }));
}

/**
 * Compares browser-side Pixel events against server-side Conversions API
 * events using the `action_source` breakdown on pixel stats, to give a
 * lightweight signal on Conversions API coverage. This does not attempt to
 * compute Meta's internal Event Match Quality score, which isn't exposed
 * through a documented read endpoint.
 */
export async function getConversionApiDiagnostics(
  connectionKey: string,
  pixelId: string,
): Promise<ConversionApiDiagnostic> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const result = await metaClient.get<RawPixelStatsResponse>(`/${pixelId}/stats`, {
    accessToken,
    operationName: 'getConversionApiDiagnostics',
    params: { aggregation: 'event', breakdown: 'action_source' },
  });

  let browserEvents = 0;
  let serverEvents = 0;

  for (const bucket of result.data.data) {
    for (const item of bucket.data) {
      if (item.action_source === 'server' || item.action_source === 'system_generated') {
        serverEvents += item.count ?? 0;
      } else {
        browserEvents += item.count ?? 0;
      }
    }
  }

  const totalEvents = browserEvents + serverEvents;
  const deduplicationRate = totalEvents > 0 ? Math.min(browserEvents, serverEvents) / totalEvents : 0;

  const issues: string[] = [];
  if (serverEvents === 0) {
    issues.push('No server-side (Conversions API) events detected in this window - only browser Pixel events are firing.');
  }
  if (browserEvents === 0 && serverEvents > 0) {
    issues.push('No browser-side Pixel events detected - relying entirely on server-side events.');
  }

  return {
    pixelId,
    eventsReceivedViaBrowser: browserEvents,
    eventsReceivedViaServer: serverEvents,
    deduplicationRate,
    issues,
  };
}
