import { z } from 'zod';
import { createTool } from '../createTool.js';
import {
  linkedinCarouselCardSchema,
  linkedinConnectionKeySchema,
  linkedinCreativeCreateStatusSchema,
  linkedinCreativeUpdateStatusSchema,
} from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as creativesService from '../../providers/linkedin/creatives.service.js';

const listCreativesSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  campaignUrn: z.string().describe('Campaign URN (from linkedin_list_campaigns).'),
});

export const listCreativesTool = createTool({
  name: 'linkedin_list_creatives',
  description: 'Lists creatives (ads) within a LinkedIn campaign.',
  inputSchema: listCreativesSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return creativesService.listCreatives(connectionKey, input.campaignUrn);
  },
});

const singleImageAdSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  campaignUrn: z.string(),
  name: z.string().min(1),
  imageAssetUrn: z.string().describe('Image asset URN from linkedin_upload_image.'),
  commentary: z.string().describe('The main ad body text.'),
  headline: z.string().optional(),
  landingPageUrl: z.string().url(),
  callToActionLabel: z.string().optional().describe('e.g. LEARN_MORE, SIGN_UP, DOWNLOAD.'),
  status: linkedinCreativeCreateStatusSchema.optional().describe('Defaults to DRAFT so nothing spends until you explicitly activate it.'),
});

export const createSingleImageAdTool = createTool({
  name: 'linkedin_create_single_image_ad',
  description: 'Creates a Single Image ad creative within a LinkedIn campaign. Defaults to DRAFT status for safety.',
  inputSchema: singleImageAdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return creativesService.createSingleImageAd(connectionKey, {
      accountUrn: input.accountUrn,
      campaignUrn: input.campaignUrn,
      name: input.name,
      imageAssetUrn: input.imageAssetUrn,
      commentary: input.commentary,
      headline: input.headline,
      landingPageUrl: input.landingPageUrl,
      callToActionLabel: input.callToActionLabel,
      status: input.status,
    });
  },
});

const videoAdSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  campaignUrn: z.string(),
  name: z.string().min(1),
  videoAssetUrn: z.string().describe('Video asset URN from linkedin_upload_video.'),
  commentary: z.string().describe('The main ad body text.'),
  headline: z.string().optional(),
  landingPageUrl: z.string().url(),
  callToActionLabel: z.string().optional(),
  status: linkedinCreativeCreateStatusSchema.optional().describe('Defaults to DRAFT so nothing spends until you explicitly activate it.'),
});

export const createVideoAdTool = createTool({
  name: 'linkedin_create_video_ad',
  description: 'Creates a Video ad creative within a LinkedIn campaign. Defaults to DRAFT status for safety.',
  inputSchema: videoAdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return creativesService.createVideoAd(connectionKey, {
      accountUrn: input.accountUrn,
      campaignUrn: input.campaignUrn,
      name: input.name,
      videoAssetUrn: input.videoAssetUrn,
      commentary: input.commentary,
      headline: input.headline,
      landingPageUrl: input.landingPageUrl,
      callToActionLabel: input.callToActionLabel,
      status: input.status,
    });
  },
});

const carouselAdSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  campaignUrn: z.string(),
  name: z.string().min(1),
  commentary: z.string().describe('The main ad body text.'),
  cards: z.array(linkedinCarouselCardSchema).min(2).describe('At least 2 carousel cards.'),
  status: linkedinCreativeCreateStatusSchema.optional().describe('Defaults to DRAFT so nothing spends until you explicitly activate it.'),
});

export const createCarouselAdTool = createTool({
  name: 'linkedin_create_carousel_ad',
  description: 'Creates a Carousel ad creative within a LinkedIn campaign. Defaults to DRAFT status for safety.',
  inputSchema: carouselAdSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return creativesService.createCarouselAd(connectionKey, {
      accountUrn: input.accountUrn,
      campaignUrn: input.campaignUrn,
      name: input.name,
      commentary: input.commentary,
      cards: input.cards,
      status: input.status,
    });
  },
});

const updateCreativeSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  creativeUrn: z.string(),
  headline: z.string().optional(),
  commentary: z.string().optional(),
  landingPageUrl: z.string().url().optional(),
  callToActionLabel: z.string().optional(),
  status: linkedinCreativeUpdateStatusSchema.optional(),
});

export const updateCreativeTool = createTool({
  name: 'linkedin_update_creative',
  description: 'Updates a LinkedIn ad creative (headline, commentary, landing page, CTA, and/or status).',
  inputSchema: updateCreativeSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return creativesService.updateCreative(connectionKey, input.creativeUrn, {
      headline: input.headline,
      commentary: input.commentary,
      landingPageUrl: input.landingPageUrl,
      callToActionLabel: input.callToActionLabel,
      status: input.status,
    });
  },
});

export const creativesTools = [
  listCreativesTool,
  createSingleImageAdTool,
  createVideoAdTool,
  createCarouselAdTool,
  updateCreativeTool,
];
