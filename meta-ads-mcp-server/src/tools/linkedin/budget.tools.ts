import { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinConnectionKeySchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as budgetService from '../../providers/linkedin/budget.service.js';

const updateBudgetSchema = z
  .object({
    connectionKey: linkedinConnectionKeySchema,
    campaignUrn: z.string(),
    dailyBudgetAmount: z.number().positive().optional(),
    totalBudgetAmount: z.number().positive().optional(),
  })
  .refine((value) => value.dailyBudgetAmount !== undefined || value.totalBudgetAmount !== undefined, {
    message: 'Provide dailyBudgetAmount and/or totalBudgetAmount.',
  });

export const updateBudgetTool = createTool({
  name: 'linkedin_update_budget',
  description: "Updates a LinkedIn campaign's daily and/or total budget.",
  inputSchema: updateBudgetSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return budgetService.updateBudget(connectionKey, input.campaignUrn, {
      dailyBudgetAmount: input.dailyBudgetAmount,
      totalBudgetAmount: input.totalBudgetAmount,
    });
  },
});

const updateBidSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignUrn: z.string(),
  unitCostAmount: z.number().positive().describe('New bid amount for the campaign cost type, e.g. max CPC.'),
});

export const updateBidTool = createTool({
  name: 'linkedin_update_bid',
  description: "Updates a LinkedIn campaign's bid (unit cost) amount.",
  inputSchema: updateBidSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return budgetService.updateBid(connectionKey, input.campaignUrn, input.unitCostAmount);
  },
});

export const budgetTools = [updateBudgetTool, updateBidTool];
