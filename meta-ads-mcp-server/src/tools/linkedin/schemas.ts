import { z } from 'zod';
import {
  LINKEDIN_CAMPAIGN_COST_TYPES,
  LINKEDIN_CAMPAIGN_OBJECTIVES,
  LINKEDIN_CAMPAIGN_TYPES,
} from '../../config/constants.js';

export const linkedinConnectionKeySchema = z
  .string()
  .optional()
  .describe(
    "Which stored LinkedIn connection to use (an organization URN from list_organizations, or 'personal' if the member administers no organization). Omit only if exactly one LinkedIn connection is stored - it will be used automatically.",
  );

export const linkedinCampaignObjectiveSchema = z.enum(LINKEDIN_CAMPAIGN_OBJECTIVES).describe('The LinkedIn campaign objective.');
export const linkedinCampaignTypeSchema = z.enum(LINKEDIN_CAMPAIGN_TYPES).describe('The LinkedIn campaign format type.');
export const linkedinCostTypeSchema = z.enum(LINKEDIN_CAMPAIGN_COST_TYPES).describe('CPC, CPM, or CPV billing.');

export const linkedinCampaignGroupCreateStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'DRAFT']);
export const linkedinCampaignGroupUpdateStatusSchema = z.enum(['ACTIVE', 'PAUSED']);
export const linkedinCampaignCreateStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'DRAFT']);
export const linkedinCampaignUpdateStatusSchema = z.enum(['ACTIVE', 'PAUSED']);

export const linkedinRunScheduleSchema = z.object({
  start: z.string().describe('ISO 8601 datetime the campaign/campaign group starts running.'),
  end: z.string().optional().describe('ISO 8601 datetime it stops running. Omit for an open-ended schedule.'),
});

export const linkedinTargetingSchema = z.object({
  locations: z
    .object({
      included: z.array(z.string()).optional().describe('Geo URNs to include, e.g. ["urn:li:geo:103644278"] for the US.'),
      excluded: z.array(z.string()).optional().describe('Geo URNs to exclude.'),
    })
    .optional(),
  industries: z.array(z.string()).optional().describe('Industry facet URNs.'),
  jobFunctions: z.array(z.string()).optional().describe('Job function facet URNs.'),
  jobTitles: z.array(z.string()).optional().describe('Job title facet URNs.'),
  jobSeniorities: z.array(z.string()).optional().describe('Seniority facet URNs.'),
  companySizes: z.array(z.string()).optional().describe('Company size facet URNs.'),
  companies: z.array(z.string()).optional().describe('Company facet URNs.'),
  skills: z.array(z.string()).optional().describe('Member skill facet URNs.'),
  degrees: z.array(z.string()).optional().describe('Degree facet URNs.'),
  fieldsOfStudy: z.array(z.string()).optional().describe('Field of study facet URNs.'),
  interests: z.array(z.string()).optional().describe('Member interest facet URNs.'),
  ageRanges: z.array(z.string()).optional().describe('Age range facet values.'),
  genders: z.array(z.enum(['MALE', 'FEMALE'])).optional(),
  audienceExpansionEnabled: z.boolean().optional().describe('Let LinkedIn expand reach beyond the explicit targeting facets.'),
  excludedAudienceSegments: z.array(z.string()).optional().describe('Matched audience segment URNs to exclude.'),
});

export const linkedinCreativeCreateStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'DRAFT']);
export const linkedinCreativeUpdateStatusSchema = z.enum(['ACTIVE', 'PAUSED']);

export const linkedinCarouselCardSchema = z.object({
  imageAssetUrn: z.string().describe('Image asset URN from linkedin_upload_image.'),
  headline: z.string(),
  landingPageUrl: z.string().url(),
});
