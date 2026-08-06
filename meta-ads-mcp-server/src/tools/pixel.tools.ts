import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';

const listPixelsSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
});

export const listPixelsTool = createTool({
  name: 'list_pixels',
  description: 'Lists Meta Pixels (and their IDs) associated with an ad account, for use with retrieve_pixel_events / retrieve_conversion_api_diagnostics.',
  inputSchema: listPixelsSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.listPixels(connectionKey, input.accountId);
  },
});

const pixelEventsSchema = z.object({
  connectionKey: connectionKeySchema,
  pixelId: z.string(),
  since: z.string().optional().describe('YYYY-MM-DD. Defaults to a recent window when omitted.'),
  until: z.string().optional().describe('YYYY-MM-DD.'),
});

export const retrievePixelEventsTool = createTool({
  name: 'retrieve_pixel_events',
  description: 'Retrieves aggregated Meta Pixel event counts (e.g. PageView, Purchase, Lead) for a date window.',
  inputSchema: pixelEventsSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.getPixelEvents(connectionKey, input.pixelId, input.since, input.until);
  },
});

const pixelIdSchema = z.object({
  connectionKey: connectionKeySchema,
  pixelId: z.string(),
});

export const retrieveConversionApiDiagnosticsTool = createTool({
  name: 'retrieve_conversion_api_diagnostics',
  description: "Compares a Pixel's browser-side events against server-side Conversions API events to surface coverage gaps (e.g. no server-side events detected).",
  inputSchema: pixelIdSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.getConversionApiDiagnostics(connectionKey, input.pixelId);
  },
});

export const pixelTools = [listPixelsTool, retrievePixelEventsTool, retrieveConversionApiDiagnosticsTool];
