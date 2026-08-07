import { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinConnectionKeySchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as leadgenService from '../../providers/linkedin/leadgen.service.js';

const listLeadGenFormsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string().describe('Ad account URN (from linkedin_list_ad_accounts).'),
});

export const listLeadGenFormsTool = createTool({
  name: 'linkedin_list_lead_gen_forms',
  description: 'Lists LinkedIn Lead Gen Forms for an ad account (names, status, lead counts).',
  inputSchema: listLeadGenFormsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return leadgenService.listLeadGenForms(connectionKey, input.accountUrn);
  },
});

const retrieveLeadsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  formUrn: z.string().describe('Lead Gen Form URN (from linkedin_list_lead_gen_forms).'),
  limit: z.number().int().positive().max(500).optional().describe('Max leads to return. Defaults to 100.'),
});

export const retrieveLeadsTool = createTool({
  name: 'linkedin_retrieve_leads',
  description: 'Retrieves the most recent leads submitted through a LinkedIn Lead Gen Form.',
  inputSchema: retrieveLeadsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return leadgenService.listLeads(connectionKey, input.formUrn, input.limit);
  },
});

const downloadLeadsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  formUrn: z.string().describe('Lead Gen Form URN (from linkedin_list_lead_gen_forms).'),
});

export const downloadLeadsTool = createTool({
  name: 'linkedin_download_leads',
  description: 'Downloads every lead submitted through a LinkedIn Lead Gen Form (paginates through the full result set).',
  inputSchema: downloadLeadsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return leadgenService.downloadLeads(connectionKey, input.formUrn);
  },
});

const leadStatisticsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  formUrn: z.string().describe('Lead Gen Form URN (from linkedin_list_lead_gen_forms).'),
});

export const leadStatisticsTool = createTool({
  name: 'linkedin_lead_statistics',
  description: 'Computes lead volume statistics (total, last 7 days, last 30 days) for a LinkedIn Lead Gen Form.',
  inputSchema: leadStatisticsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return leadgenService.getLeadStatistics(connectionKey, input.formUrn);
  },
});

export const leadgenTools = [listLeadGenFormsTool, retrieveLeadsTool, downloadLeadsTool, leadStatisticsTool];
