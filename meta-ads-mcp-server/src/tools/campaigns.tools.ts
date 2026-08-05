import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema, campaignObjectiveSchema, bidStrategySchema, campaignStatusSchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { runBulk } from './bulk.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';
import { BULK_OPERATION_LIMITS } from '../config/constants.js';

const listCampaignsSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string().describe('Ad account ID, e.g. "act_123456789" (from list_ad_accounts).'),
});

export const listCampaignsTool = createTool({
  name: 'list_campaigns',
  description: 'Lists campaigns in a Meta ad account.',
  inputSchema: listCampaignsSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.listCampaigns(connectionKey, input.accountId);
  },
});

const createCampaignSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  name: z.string().min(1),
  objective: campaignObjectiveSchema,
  status: campaignStatusSchema.optional().describe('Defaults to PAUSED so nothing spends until you explicitly resume it.'),
  dailyBudgetCents: z.number().int().positive().optional(),
  lifetimeBudgetCents: z.number().int().positive().optional(),
  bidStrategy: bidStrategySchema.optional(),
  specialAdCategories: z
    .array(z.string())
    .optional()
    .describe('Required by Meta for credit/employment/housing/social-issue ads; defaults to an empty array otherwise.'),
});

export const createCampaignTool = createTool({
  name: 'create_campaign',
  description: 'Creates a new Meta ad campaign. Defaults to PAUSED status for safety.',
  inputSchema: createCampaignSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.createCampaign(connectionKey, {
      accountId: input.accountId,
      name: input.name,
      objective: input.objective,
      status: input.status,
      dailyBudgetCents: input.dailyBudgetCents,
      lifetimeBudgetCents: input.lifetimeBudgetCents,
      bidStrategy: input.bidStrategy,
      specialAdCategories: input.specialAdCategories,
    });
  },
});

const duplicateCampaignSchema = z.object({
  connectionKey: connectionKeySchema,
  campaignId: z.string(),
  newName: z.string().min(1),
});

export const duplicateCampaignTool = createTool({
  name: 'duplicate_campaign',
  description: 'Duplicates an existing campaign (same objective/budget/bid strategy) under a new name. The duplicate is created PAUSED.',
  inputSchema: duplicateCampaignSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.duplicateCampaign(connectionKey, input.campaignId, input.newName);
  },
});

const campaignIdSchema = z.object({
  connectionKey: connectionKeySchema,
  campaignId: z.string(),
});

export const pauseCampaignTool = createTool({
  name: 'pause_campaign',
  description: 'Pauses a Meta campaign.',
  inputSchema: campaignIdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.pauseCampaign(connectionKey, input.campaignId);
  },
});

export const resumeCampaignTool = createTool({
  name: 'resume_campaign',
  description: 'Resumes (activates) a paused Meta campaign.',
  inputSchema: campaignIdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.resumeCampaign(connectionKey, input.campaignId);
  },
});

export const deleteCampaignTool = createTool({
  name: 'delete_campaign',
  description: 'Permanently deletes a Meta campaign. This cannot be undone.',
  inputSchema: campaignIdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    await metaProvider.deleteCampaign(connectionKey, input.campaignId);
    return { campaignId: input.campaignId, deleted: true };
  },
});

const updateBudgetSchema = z
  .object({
    connectionKey: connectionKeySchema,
    campaignId: z.string(),
    dailyBudgetCents: z.number().int().positive().optional(),
    lifetimeBudgetCents: z.number().int().positive().optional(),
  })
  .refine((value) => value.dailyBudgetCents !== undefined || value.lifetimeBudgetCents !== undefined, {
    message: 'Provide dailyBudgetCents and/or lifetimeBudgetCents.',
  });

export const updateBudgetTool = createTool({
  name: 'update_budget',
  description: "Updates a campaign's daily and/or lifetime budget.",
  inputSchema: updateBudgetSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.updateCampaignBudget(connectionKey, input.campaignId, {
      dailyBudgetCents: input.dailyBudgetCents,
      lifetimeBudgetCents: input.lifetimeBudgetCents,
    });
  },
});

const bulkCampaignIdsSchema = z.object({
  connectionKey: connectionKeySchema,
  campaignIds: z.array(z.string()).min(1).max(BULK_OPERATION_LIMITS.maxBatchSize),
});

export const bulkPauseCampaignsTool = createTool({
  name: 'bulk_pause_campaigns',
  description: `Pauses up to ${BULK_OPERATION_LIMITS.maxBatchSize} campaigns in one call. Returns a per-campaign success/failure result.`,
  inputSchema: bulkCampaignIdsSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return runBulk(input.campaignIds, (campaignId) => metaProvider.pauseCampaign(connectionKey, campaignId));
  },
});

export const bulkResumeCampaignsTool = createTool({
  name: 'bulk_resume_campaigns',
  description: `Resumes up to ${BULK_OPERATION_LIMITS.maxBatchSize} campaigns in one call. Returns a per-campaign success/failure result.`,
  inputSchema: bulkCampaignIdsSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return runBulk(input.campaignIds, (campaignId) => metaProvider.resumeCampaign(connectionKey, campaignId));
  },
});

const bulkBudgetUpdateSchema = z.object({
  connectionKey: connectionKeySchema,
  updates: z
    .array(
      z
        .object({
          campaignId: z.string(),
          dailyBudgetCents: z.number().int().positive().optional(),
          lifetimeBudgetCents: z.number().int().positive().optional(),
        })
        .refine((value) => value.dailyBudgetCents !== undefined || value.lifetimeBudgetCents !== undefined, {
          message: 'Each update needs dailyBudgetCents and/or lifetimeBudgetCents.',
        }),
    )
    .min(1)
    .max(BULK_OPERATION_LIMITS.maxBatchSize),
});

export const bulkUpdateBudgetsTool = createTool({
  name: 'bulk_update_budgets',
  description: `Updates budgets for up to ${BULK_OPERATION_LIMITS.maxBatchSize} campaigns in one call. Returns a per-campaign success/failure result.`,
  inputSchema: bulkBudgetUpdateSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return runBulk(input.updates, (update) =>
      metaProvider.updateCampaignBudget(connectionKey, update.campaignId, {
        dailyBudgetCents: update.dailyBudgetCents,
        lifetimeBudgetCents: update.lifetimeBudgetCents,
      }),
    );
  },
});

export const campaignsTools = [
  listCampaignsTool,
  createCampaignTool,
  duplicateCampaignTool,
  pauseCampaignTool,
  resumeCampaignTool,
  deleteCampaignTool,
  updateBudgetTool,
  bulkPauseCampaignsTool,
  bulkResumeCampaignsTool,
  bulkUpdateBudgetsTool,
];
