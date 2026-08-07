import { z } from 'zod';
import { createTool } from '../createTool.js';
import {
  linkedinCampaignGroupCreateStatusSchema,
  linkedinCampaignGroupUpdateStatusSchema,
  linkedinConnectionKeySchema,
  linkedinRunScheduleSchema,
} from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as campaignGroupsService from '../../providers/linkedin/campaignGroups.service.js';

const listCampaignGroupsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string().describe('Ad account URN (from list_ad_accounts).'),
});

export const listCampaignGroupsTool = createTool({
  name: 'linkedin_list_campaign_groups',
  description: 'Lists campaign groups in a LinkedIn ad account.',
  inputSchema: listCampaignGroupsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignGroupsService.listCampaignGroups(connectionKey, input.accountUrn);
  },
});

const createCampaignGroupSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  name: z.string().min(1),
  status: linkedinCampaignGroupCreateStatusSchema.optional().describe('Defaults to DRAFT so nothing spends until you explicitly activate it.'),
  totalBudgetAmount: z.number().positive().optional(),
  totalBudgetCurrency: z.string().optional().describe('ISO currency code, e.g. USD. Defaults to USD.'),
  runSchedule: linkedinRunScheduleSchema.optional(),
});

export const createCampaignGroupTool = createTool({
  name: 'linkedin_create_campaign_group',
  description: 'Creates a new LinkedIn campaign group. Defaults to DRAFT status for safety.',
  inputSchema: createCampaignGroupSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignGroupsService.createCampaignGroup(connectionKey, {
      accountUrn: input.accountUrn,
      name: input.name,
      status: input.status,
      totalBudgetAmount: input.totalBudgetAmount,
      totalBudgetCurrency: input.totalBudgetCurrency,
      runSchedule: input.runSchedule,
    });
  },
});

const updateCampaignGroupSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignGroupUrn: z.string(),
  name: z.string().min(1).optional(),
  status: linkedinCampaignGroupUpdateStatusSchema.optional(),
  totalBudgetAmount: z.number().positive().optional(),
  runSchedule: linkedinRunScheduleSchema.optional(),
});

export const updateCampaignGroupTool = createTool({
  name: 'linkedin_update_campaign_group',
  description: 'Updates a LinkedIn campaign group (name, status, total budget, and/or run schedule).',
  inputSchema: updateCampaignGroupSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignGroupsService.updateCampaignGroup(connectionKey, input.campaignGroupUrn, {
      name: input.name,
      status: input.status,
      totalBudgetAmount: input.totalBudgetAmount,
      runSchedule: input.runSchedule,
    });
  },
});

const campaignGroupIdSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignGroupUrn: z.string(),
});

export const archiveCampaignGroupTool = createTool({
  name: 'linkedin_archive_campaign_group',
  description: 'Archives a LinkedIn campaign group. This stops delivery for every campaign in it and cannot be undone.',
  inputSchema: campaignGroupIdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignGroupsService.archiveCampaignGroup(connectionKey, input.campaignGroupUrn);
  },
});

export const campaignGroupsTools = [listCampaignGroupsTool, createCampaignGroupTool, updateCampaignGroupTool, archiveCampaignGroupTool];
