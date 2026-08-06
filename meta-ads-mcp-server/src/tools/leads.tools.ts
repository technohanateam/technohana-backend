import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';

const retrieveLeadsSchema = z
  .object({
    connectionKey: connectionKeySchema,
    accountId: z.string().optional().describe('Ad account ID - required to list lead forms (their names and lead counts). Omit if formId is provided.'),
    formId: z.string().optional().describe('Lead gen form ID - when provided, returns lead details (instant form leads) for that form instead of the form list.'),
    limit: z.number().int().positive().max(500).optional().describe('Max leads to return when formId is provided. Defaults to 100.'),
  })
  .refine((value) => Boolean(value.accountId) || Boolean(value.formId), {
    message: 'Provide accountId (to list lead forms) or formId (to retrieve leads for a specific form).',
  });

export const retrieveLeadsTool = createTool({
  name: 'retrieve_leads',
  description:
    'Retrieves Meta lead generation data: pass accountId to list lead forms (names, status, lead counts), or pass formId to retrieve instant-form lead details for that form.',
  inputSchema: retrieveLeadsSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    if (input.formId) {
      return metaProvider.listLeads(connectionKey, input.formId, input.limit);
    }
    return metaProvider.listLeadForms(connectionKey, input.accountId!);
  },
});

export const leadsTools = [retrieveLeadsTool];
