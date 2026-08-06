import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema, campaignStatusSchema, targetingSchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { runBulk } from './bulk.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';
import { BULK_OPERATION_LIMITS } from '../config/constants.js';

const listAdSetsSchema = z.object({
  connectionKey: connectionKeySchema,
  campaignId: z.string(),
});

export const listAdSetsTool = createTool({
  name: 'list_ad_sets',
  description: 'Lists ad sets within a Meta campaign.',
  inputSchema: listAdSetsSchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.listAdSets(connectionKey, input.campaignId);
  },
});

const createAdSetSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  campaignId: z.string(),
  name: z.string().min(1),
  billingEvent: z.string().describe('e.g. IMPRESSIONS, LINK_CLICKS.'),
  optimizationGoal: z.string().describe('e.g. LINK_CLICKS, OFFSITE_CONVERSIONS, LEAD_GENERATION, REACH.'),
  targeting: targetingSchema,
  dailyBudgetCents: z.number().int().positive().optional(),
  lifetimeBudgetCents: z.number().int().positive().optional(),
  bidAmountCents: z.number().int().positive().optional(),
  status: campaignStatusSchema.optional().describe('Defaults to PAUSED so nothing spends until you explicitly resume it.'),
  startTime: z.string().optional().describe('ISO 8601 timestamp.'),
  endTime: z.string().optional().describe('ISO 8601 timestamp.'),
});

export const createAdSetTool = createTool({
  name: 'create_ad_set',
  description: 'Creates a new ad set within a campaign, including audience targeting. Defaults to PAUSED status for safety.',
  inputSchema: createAdSetSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.createAdSet(connectionKey, {
      accountId: input.accountId,
      campaignId: input.campaignId,
      name: input.name,
      billingEvent: input.billingEvent,
      optimizationGoal: input.optimizationGoal,
      targeting: input.targeting,
      dailyBudgetCents: input.dailyBudgetCents,
      lifetimeBudgetCents: input.lifetimeBudgetCents,
      bidAmountCents: input.bidAmountCents,
      status: input.status,
      startTime: input.startTime,
      endTime: input.endTime,
    });
  },
});

const updateTargetAudienceSchema = z.object({
  connectionKey: connectionKeySchema,
  adSetId: z.string(),
  targeting: targetingSchema,
});

export const updateTargetAudienceTool = createTool({
  name: 'update_target_audience',
  description: "Replaces an ad set's audience targeting (demographics, geo, interests, custom audiences, placements).",
  inputSchema: updateTargetAudienceSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.updateAdSetTargeting(connectionKey, input.adSetId, input.targeting);
  },
});

const bulkUpdateTargetAudienceSchema = z.object({
  connectionKey: connectionKeySchema,
  updates: z
    .array(z.object({ adSetId: z.string(), targeting: targetingSchema }))
    .min(1)
    .max(BULK_OPERATION_LIMITS.maxBatchSize),
});

export const bulkUpdateTargetAudienceTool = createTool({
  name: 'bulk_update_target_audience',
  description: `Updates targeting for up to ${BULK_OPERATION_LIMITS.maxBatchSize} ad sets in one call. Returns a per-ad-set success/failure result.`,
  inputSchema: bulkUpdateTargetAudienceSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return runBulk(input.updates, (update) =>
      metaProvider.updateAdSetTargeting(connectionKey, update.adSetId, update.targeting),
    );
  },
});

export const adsetsTools = [listAdSetsTool, createAdSetTool, updateTargetAudienceTool, bulkUpdateTargetAudienceTool];
