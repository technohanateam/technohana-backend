import SocialPost from "../../models/socialFactory/socialPost.model.js";
import { buildSocialPrompt } from "./socialPromptBuilder.service.js";

// Creates a SocialPost doc straight in AWAITING_PASTE, exactly like the
// Social Media Post Factory's own POST /admin/social-factory/posts does —
// there is no separate automated generation step for this factory. Shared by
// socialPost.controller.js#createPost and the Enquiry/Partner Prompt Pack
// generate routes (admin.routes.js) so a prompt-pack's social post is a real,
// reviewable/approvable/schedulable Factory post instead of a dead-end copy.
export async function createSocialPostForSource({ sourceType, sourceId, source, platform }) {
  const generatedPrompt = buildSocialPrompt({ sourceType, source, platform });

  return SocialPost.create({
    sourceType,
    sourceId,
    sourceSlug: sourceType === "COURSE" ? source.courseSlug || source.id || null : source.slug || null,
    sourceTitle: sourceType === "COURSE" ? source.courseTitle : source.title,
    platform,
    status: "AWAITING_PASTE",
    generatedPrompt,
  });
}
