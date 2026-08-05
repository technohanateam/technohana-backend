import { z } from 'zod';
import { createTool } from './createTool.js';
import { connectionKeySchema } from './schemas.js';
import { resolveConnectionKey } from './connection.util.js';
import { metaProvider } from '../providers/meta/meta.provider.js';

const uploadMediaSchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
  filePathOrUrl: z.string().describe('A local file path readable by this server, or an https:// URL to fetch.'),
  name: z.string().min(1),
});

export const uploadImageTool = createTool({
  name: 'upload_image',
  description: 'Uploads an image to the ad account image library, returning its hash for use in ad creatives.',
  inputSchema: uploadMediaSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.uploadImage(connectionKey, input.accountId, input.filePathOrUrl, input.name);
  },
});

export const uploadVideoTool = createTool({
  name: 'upload_video',
  description: 'Uploads a video to the ad account video library, returning its ID for use in ad creatives.',
  inputSchema: uploadMediaSchema,
  mutating: true,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.uploadVideo(connectionKey, input.accountId, input.filePathOrUrl, input.name);
  },
});

const listAssetLibrarySchema = z.object({
  connectionKey: connectionKeySchema,
  accountId: z.string(),
});

export const listAssetLibraryTool = createTool({
  name: 'list_asset_library',
  description: 'Lists every image and video in the ad account asset library.',
  inputSchema: listAssetLibrarySchema,
  handler: async (input) => {
    const connectionKey = await resolveConnectionKey(input.connectionKey);
    return metaProvider.listAssetLibrary(connectionKey, input.accountId);
  },
});

export const mediaTools = [uploadImageTool, uploadVideoTool, listAssetLibraryTool];
