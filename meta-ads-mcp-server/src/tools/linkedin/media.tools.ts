import { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinConnectionKeySchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as mediaService from '../../providers/linkedin/media.service.js';

const uploadMediaSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
  filePathOrUrl: z.string().describe('A local file path readable by this server, or an https:// URL to fetch.'),
  name: z.string().min(1),
});

export const uploadImageTool = createTool({
  name: 'linkedin_upload_image',
  description: 'Uploads an image to the LinkedIn ad account, returning its asset URN for use in ad creatives.',
  inputSchema: uploadMediaSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return mediaService.uploadImage(connectionKey, input.accountUrn, input.filePathOrUrl, input.name);
  },
});

export const uploadVideoTool = createTool({
  name: 'linkedin_upload_video',
  description: 'Uploads a video to the LinkedIn ad account, returning its asset URN for use in ad creatives.',
  inputSchema: uploadMediaSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return mediaService.uploadVideo(connectionKey, input.accountUrn, input.filePathOrUrl, input.name);
  },
});

const listMediaLibrarySchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  accountUrn: z.string(),
});

export const listMediaLibraryTool = createTool({
  name: 'linkedin_list_media_library',
  description: 'Lists every image and video asset uploaded to the LinkedIn ad account.',
  inputSchema: listMediaLibrarySchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return mediaService.listMediaLibrary(connectionKey, input.accountUrn);
  },
});

const validateAssetSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  assetUrn: z.string().describe('Image or video asset URN, e.g. "urn:li:image:C4D..." or "urn:li:video:C4D...".'),
  intendedType: z.enum(['image', 'video']),
});

export const validateAssetTool = createTool({
  name: 'linkedin_validate_asset',
  description: "Checks a media asset's processing status and file size against LinkedIn's ad specs before it's used in a creative.",
  inputSchema: validateAssetSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return mediaService.validateAsset(connectionKey, input.assetUrn, input.intendedType);
  },
});

export const mediaTools = [uploadImageTool, uploadVideoTool, listMediaLibraryTool, validateAssetTool];
