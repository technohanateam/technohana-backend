// Publishes an approved Social Factory post to the Technohana LinkedIn organization page (text posts).
import { linkedinFetch, getActiveLinkedinConnection } from "../config/linkedinClient.js";

export class LinkedinPublishError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const isLinkedinPublishConfigured = () => Boolean(process.env.LINKEDIN_ORGANIZATION_ID);

// LinkedIn "little text" reserves these characters; unescaped they truncate or reject the post.
// "#" is left alone so plain hashtags still render as hashtags.
const escapeCommentary = (text) => text.replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`);

export function buildCommentary(post) {
  const hashtags = (post.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return [post.caption, post.cta, hashtags].filter(Boolean).join("\n\n");
}

export async function publishLinkedinPost(post) {
  if (!isLinkedinPublishConfigured()) throw new LinkedinPublishError("LINKEDIN_ORGANIZATION_ID is not configured", 503);
  const connection = await getActiveLinkedinConnection();
  if (!connection) throw new LinkedinPublishError("LinkedIn is not connected — connect it in the CRM Integrations page", 409);

  const commentary = buildCommentary(post);
  if (!commentary) throw new LinkedinPublishError("Post has no caption to publish");

  const { id } = await linkedinFetch(connection, "/posts", {
    method: "POST",
    body: {
      author: `urn:li:organization:${process.env.LINKEDIN_ORGANIZATION_ID}`,
      commentary: escapeCommentary(commentary),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    },
  });
  return id;
}
