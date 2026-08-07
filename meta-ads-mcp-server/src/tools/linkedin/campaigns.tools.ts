import { z } from 'zod';
import { createTool } from '../createTool.js';
import {
  linkedinCampaignCreateStatusSchema,
  linkedinCampaignObjectiveSchema,
  linkedinCampaignTypeSchema,
  linkedinCampaignUpdateStatusSchema,
  linkedinConnectionKeySchema,
  linkedinCostTypeSchema,
  linkedinRunScheduleSchema,
  linkedinTargetingSchema,
} from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as campaignsService from '../../providers/linkedin/campaigns.service.js';
import { BULK_OPERATION_LIMITS } from '../../config/constants.js';
import { runBulk } from '../bulk.util.js';

const listCampaignsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string().describe('Ad account URN (from list_ad_accounts).'),
  campaignGroupUrn: z.string().optional().describe('Scope to one campaign group. Omit to list every campaign in the account.'),
});

export const listCampaignsTool = createTool({
  name: 'linkedin_list_campaigns',
  description: 'Lists campaigns in a LinkedIn ad account, optionally scoped to one campaign group.',
  inputSchema: listCampaignsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignsService.listCampaigns(connectionKey, input.accountUrn, input.campaignGroupUrn);
  },
});

const createCampaignSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  campaignGroupUrn: z.string(),
  name: z.string().min(1),
  objectiveType: linkedinCampaignObjectiveSchema,
  type: linkedinCampaignTypeSchema,
  costType: linkedinCostTypeSchema,
  status: linkedinCampaignCreateStatusSchema.optional().describe('Defaults to DRAFT so nothing spends until you explicitly activate it.'),
  dailyBudgetAmount: z.number().positive().optional(),
  totalBudgetAmount: z.number().positive().optional(),
  unitCostAmount: z.number().positive().optional().describe('Bid amount for the cost type, e.g. max CPC.'),
  currency: z.string().describe('ISO currency code, e.g. USD.'),
  targeting: linkedinTargetingSchema.optional(),
  runSchedule: linkedinRunScheduleSchema.optional(),
});

export const createCampaignTool = createTool({
  name: 'linkedin_create_campaign',
  description: 'Creates a new LinkedIn ad campaign. Defaults to DRAFT status for safety.',
  inputSchema: createCampaignSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignsService.createCampaign(connectionKey, {
      accountUrn: input.accountUrn,
      campaignGroupUrn: input.campaignGroupUrn,
      name: input.name,
      objectiveType: input.objectiveType,
      type: input.type,
      costType: input.costType,
      status: input.status,
      dailyBudgetAmount: input.dailyBudgetAmount,
      totalBudgetAmount: input.totalBudgetAmount,
      unitCostAmount: input.unitCostAmount,
      currency: input.currency,
      targeting: input.targeting,
      runSchedule: input.runSchedule,
    });
  },
});

const duplicateCampaignSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignUrn: z.string(),
  newName: z.string().min(1),
});

export const duplicateCampaignTool = createTool({
  name: 'linkedin_duplicate_campaign',
  description: 'Duplicates an existing LinkedIn campaign (same objective/type/cost structure/targeting) under a new name. The duplicate is created DRAFT.',
  inputSchema: duplicateCampaignSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignsService.duplicateCampaign(connectionKey, input.campaignUrn, input.newName);
  },
});

const campaignIdSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignUrn: z.string(),
});

export const pauseCampaignTool = createTool({
  name: 'linkedin_pause_campaign',
  description: 'Pauses a LinkedIn campaign.',
  inputSchema: campaignIdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignsService.pauseCampaign(connectionKey, input.campaignUrn);
  },
});

export const resumeCampaignTool = createTool({
  name: 'linkedin_resume_campaign',
  description: 'Resumes (activates) a paused LinkedIn campaign.',
  inputSchema: campaignIdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignsService.resumeCampaign(connectionKey, input.campaignUrn);
  },
});

export const archiveCampaignTool = createTool({
  name: 'linkedin_archive_campaign',
  description: 'Archives a LinkedIn campaign. This stops delivery permanently and cannot be undone.',
  inputSchema: campaignIdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignsService.archiveCampaign(connectionKey, input.campaignUrn);
  },
});

const updateCampaignSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignUrn: z.string(),
  name: z.string().min(1).optional(),
  status: linkedinCampaignUpdateStatusSchema.optional(),
  dailyBudgetAmount: z.number().positive().optional(),
  totalBudgetAmount: z.number().positive().optional(),
  unitCostAmount: z.number().positive().optional(),
  targeting: linkedinTargetingSchema.optional(),
  runSchedule: linkedinRunScheduleSchema.optional(),
});

export const updateCampaignTool = createTool({
  name: 'linkedin_update_campaign',
  description: 'Updates a LinkedIn campaign (name, status, budget, bid, targeting, and/or run schedule).',
  inputSchema: updateCampaignSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return campaignsService.updateCampaign(connectionKey, input.campaignUrn, {
      name: input.name,
      status: input.status,
      dailyBudgetAmount: input.dailyBudgetAmount,
      totalBudgetAmount: input.totalBudgetAmount,
      unitCostAmount: input.unitCostAmount,
      targeting: input.targeting,
      runSchedule: input.runSchedule,
    });
  },
});

const bulkCampaignUrnsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignUrns: z.array(z.string()).min(1).max(BULK_OPERATION_LIMITS.maxBatchSize),
});

export const bulkPauseCampaignsTool = createTool({
  name: 'linkedin_bulk_pause_campaigns',
  description: `Pauses up to ${BULK_OPERATION_LIMITS.maxBatchSize} LinkedIn campaigns in one call. Returns a per-campaign success/failure result.`,
  inputSchema: bulkCampaignUrnsSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return runBulk(input.campaignUrns, (campaignUrn) => campaignsService.pauseCampaign(connectionKey, campaignUrn));
  },
});

export const bulkResumeCampaignsTool = createTool({
  name: 'linkedin_bulk_resume_campaigns',
  description: `Resumes up to ${BULK_OPERATION_LIMITS.maxBatchSize} LinkedIn campaigns in one call. Returns a per-campaign success/failure result.`,
  inputSchema: bulkCampaignUrnsSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return runBulk(input.campaignUrns, (campaignUrn) => campaignsService.resumeCampaign(connectionKey, campaignUrn));
  },
});

export const campaignsTools = [
  listCampaignsTool,
  createCampaignTool,
  duplicateCampaignTool,
  pauseCampaignTool,
  resumeCampaignTool,
  archiveCampaignTool,
  updateCampaignTool,
  bulkPauseCampaignsTool,
  bulkResumeCampaignsTool,
];
