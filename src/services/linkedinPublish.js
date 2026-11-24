// Publishes an approved Social Factory post to the Technohana LinkedIn organization page (text posts).
import { linkedinFetch, getActiveLinkedinConnection, getAccessToken } from "../config/linkedinClient.js";

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

const MAX_IMAGES = 9;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif"];

// Downloads the stored https image and uploads it to LinkedIn; returns the image URN.
async function uploadImage(connection, owner, url) {
  const src = await fetch(url);
  if (!src.ok) throw new LinkedinPublishError(`Could not download image (${src.status}): ${url}`);
  const type = (src.headers.get("content-type") || "").split(";")[0].trim();
  if (!IMAGE_TYPES.includes(type)) throw new LinkedinPublishError(`Image must be PNG, JPEG or GIF (got ${type || "unknown"}): ${url}`);
  const bytes = Buffer.from(await src.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new LinkedinPublishError(`Image is larger than 8 MB: ${url}`);

  const init = await linkedinFetch(connection, "/images", {
    method: "POST",
    params: { action: "initializeUpload" },
    body: { initializeUploadRequest: { owner } },
  });
  const { uploadUrl, image } = init.value || {};
  if (!uploadUrl || !image) throw new LinkedinPublishError("LinkedIn did not return an upload URL", 502);

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${await getAccessToken(connection)}`, "Content-Type": type },
    body: bytes,
  });
  if (!put.ok) throw new LinkedinPublishError(`LinkedIn image upload failed (${put.status})`, 502);
  return image;
}

// One image -> media post, several -> multiImage post. Any image failure aborts the whole post
// (never publishes text-only by accident).
async function buildContent(connection, owner, post) {
  const urls = (post.imageUrls || []).filter((u) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, MAX_IMAGES);
  if (!urls.length) return undefined;
  const altText = (post.altText || "").slice(0, 4086);
  const ids = [];
  for (const url of urls) ids.push(await uploadImage(connection, owner, url));
  if (ids.length === 1) return { media: { id: ids[0], ...(altText && { altText }) } };
  return { multiImage: { images: ids.map((id) => ({ id, ...(altText && { altText }) })) } };
}

export async function publishLinkedinPost(post) {
  if (!isLinkedinPublishConfigured()) throw new LinkedinPublishError("LINKEDIN_ORGANIZATION_ID is not configured", 503);
  const connection = await getActiveLinkedinConnection();
  if (!connection) throw new LinkedinPublishError("LinkedIn is not connected — connect it in the CRM Integrations page", 409);

  const commentary = buildCommentary(post);
  if (!commentary) throw new LinkedinPublishError("Post has no caption to publish");

  const author = `urn:li:organization:${process.env.LINKEDIN_ORGANIZATION_ID}`;
  const content = await buildContent(connection, author, post);

  const { id } = await linkedinFetch(connection, "/posts", {
    method: "POST",
    body: {
      author,
      commentary: escapeCommentary(commentary),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content && { content }),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    },
  });
  return id;
}

// Publishes LinkedIn posts whose scheduledAt has passed. Off unless SOCIAL_AUTOPUBLISH_ENABLED=true.
// A post is claimed atomically (publishedAt set) so two instances never double-post; on failure it
// drops back to APPROVED with publishError so it is not retried every minute.
export async function publishDueLinkedinPosts() {
  const { default: SocialPost } = await import("../models/socialFactory/socialPost.model.js");
  for (;;) {
    const claimed = await SocialPost.findOneAndUpdate(
      { platform: "LINKEDIN", status: "SCHEDULED", scheduledAt: { $lte: new Date() }, publishedAt: null },
      { $set: { publishedAt: new Date() } },
      { sort: { scheduledAt: 1 }, new: true }
    );
    if (!claimed) return;
    try {
      claimed.publishedUrn = await publishLinkedinPost(claimed.post);
      claimed.publishError = null;
      claimed.status = "PUBLISHED";
    } catch (err) {
      claimed.publishError = err.message;
      claimed.publishedAt = null;
      claimed.status = "APPROVED";
      console.error("[SocialFactory] scheduled LinkedIn publish failed:", err.message);
    }
    await claimed.save();
  }
}

export function startSocialPublishScheduler() {
  if (process.env.SOCIAL_AUTOPUBLISH_ENABLED !== "true") return;
  setInterval(() => publishDueLinkedinPosts().catch((e) => console.error("[SocialFactory] scheduler error:", e.message)), 60 * 1000);
  console.log("[SocialFactory] LinkedIn auto-publish scheduler on");
}
