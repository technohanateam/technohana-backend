import { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinConnectionKeySchema, linkedinTargetingSchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as audienceService from '../../providers/linkedin/audience.service.js';

const estimateAudienceSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  targeting: linkedinTargetingSchema,
});

export const estimateAudienceTool = createTool({
  name: 'linkedin_estimate_audience',
  description: 'Estimates the reachable audience size (low/high range) for a LinkedIn targeting spec.',
  inputSchema: estimateAudienceSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return audienceService.estimateAudience(connectionKey, input.accountUrn, input.targeting);
  },
});

const updateTargetingSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignUrn: z.string(),
  targeting: linkedinTargetingSchema,
});

export const updateTargetingTool = createTool({
  name: 'linkedin_update_targeting',
  description: "Replaces a LinkedIn campaign's targeting criteria.",
  inputSchema: updateTargetingSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return audienceService.updateTargeting(connectionKey, input.campaignUrn, input.targeting);
  },
});

export const audienceTools = [estimateAudienceTool, updateTargetingTool];
