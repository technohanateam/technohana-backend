import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';

const listAdAccountsSchema = z.object({
  connectionKey: connectionKeySchema,
  businessId: z.string().optional().describe('Scope to one Business Manager ID. Omit to list every account visible to the connection.'),
});

export const listAdAccountsTool = createTool({
  name: 'list_ad_accounts',
  description: 'Lists Meta (Facebook/Instagram) ad accounts visible to the connected account, optionally scoped to one Business Manager.',
  inputSchema: listAdAccountsSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.listAdAccounts(connectionKey, input.businessId);
  },
});

const listBusinessesSchema = z.object({
  connectionKey: connectionKeySchema,
});

export const listBusinessesTool = createTool({
  name: 'list_businesses',
  description: 'Lists Meta Business Manager accounts visible to the connected account.',
  inputSchema: listBusinessesSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.listBusinesses(connectionKey);
  },
});

export const accountsTools = [listAdAccountsTool, listBusinessesTool];
