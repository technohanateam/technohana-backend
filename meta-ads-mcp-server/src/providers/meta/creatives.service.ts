import { getFreshAccessToken } from '../../auth/tokenManager.js';
import { metaClient } from './client.js';
import { normalizeAccountId } from './accountId.util.js';
import type { CreateAdCreativeInput } from '../../types/meta.types.js';

interface ObjectStorySpec {
  page_id: string;
  link_data?: {
    message: string;
    link: string;
    name?: string;
    description?: string;
    image_hash?: string;
    call_to_action?: { type: string };
    child_attachments?: Array<{
      link: string;
      name: string;
      description?: string;
      image_hash?: string;
      video_id?: string;
    }>;
  };
  video_data?: {
    video_id: string;
    title?: string;
    message: string;
    image_url?: string;
    call_to_action?: { type: string; value?: { link: string } };
  };
}

/**
 * Builds the object_story_spec payload for a given creative type. Reels and
 * Stories are Meta ad *placements*, not distinct creative schemas: they reuse
 * the same video_data (Reels) / link_data (Stories) object_story_specs as
 * Video/Single-Image creatives and are routed to the right surface via the ad
 * set's targeting.publisherPlatforms / placement settings, not anything in the
 * creative payload itself. A fully custom Instant Experience (Canvas) for
 * Collection ads is out of scope; Collection here uses the same
 * child_attachments layout as Carousel.
 */
function buildObjectStorySpec(input: CreateAdCreativeInput): ObjectStorySpec {
  const callToAction = input.callToActionType ? { type: input.callToActionType } : undefined;

  switch (input.type) {
    case 'CAROUSEL':
    case 'COLLECTION':
      return {
        page_id: input.pageId,
        link_data: {
          message: input.message,
          link: input.link,
          name: input.headline,
          description: input.description,
          child_attachments: (input.carouselCards ?? []).map((card) => ({
            link: card.link,
            name: card.name,
            description: card.description,
            image_hash: card.imageHash,
            video_id: card.videoId,
          })),
        },
      };

    case 'VIDEO':
    case 'REELS':
      if (!input.videoId) {
        throw new Error(`videoId is required for creative type ${input.type}`);
      }
      return {
        page_id: input.pageId,
        video_data: {
          video_id: input.videoId,
          title: input.headline,
          message: input.message,
          image_url: input.thumbnailUrl,
          call_to_action: callToAction ? { ...callToAction, value: { link: input.link } } : undefined,
        },
      };

    case 'SINGLE_IMAGE':
    case 'STORIES':
    default:
      return {
        page_id: input.pageId,
        link_data: {
          message: input.message,
          link: input.link,
          name: input.headline,
          description: input.description,
          image_hash: input.imageHash,
          call_to_action: callToAction,
        },
      };
  }
}

/** Creates a Meta ad creative and returns its ID (used by ads.service.createAd). */
export async function createAdCreative(connectionKey: string, input: CreateAdCreativeInput): Promise<string> {
  const accessToken = await getFreshAccessToken(connectionKey);
  const accountId = normalizeAccountId(input.accountId);
  const objectStorySpec = buildObjectStorySpec(input);

  const result = await metaClient.post<{ id: string }>(`/${accountId}/adcreatives`, {
    accessToken,
    operationName: 'createAdCreative',
    body: {
      name: input.name,
      object_story_spec: objectStorySpec,
    },
  });

  return result.data.id;
}
