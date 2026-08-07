import { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinConnectionKeySchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as accountsService from '../../providers/linkedin/accounts.service.js';

const listAdAccountsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  organizationUrn: z.string().optional().describe('Scope to accounts owned by one organization. Omit to list every account visible to the connection.'),
});

export const listAdAccountsTool = createTool({
  name: 'linkedin_list_ad_accounts',
  description: 'Lists LinkedIn ad accounts visible to the connected member, optionally scoped to one organization.',
  inputSchema: listAdAccountsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return accountsService.listAdAccounts(connectionKey, input.organizationUrn);
  },
});

const getAdAccountSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string().describe('Ad account URN, e.g. "urn:li:sponsoredAccount:509876543" (from list_ad_accounts).'),
});

export const getAdAccountTool = createTool({
  name: 'linkedin_get_ad_account',
  description: 'Retrieves a single LinkedIn ad account by URN.',
  inputSchema: getAdAccountSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return accountsService.getAdAccount(connectionKey, input.accountUrn);
  },
});

export const accountsTools = [listAdAccountsTool, getAdAccountTool];
