// Instagram "comment a keyword → get a DM" automation.
// Webhook `comments` event → match an IgCommentTrigger → CRM lead → public reply + private DM.
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import IgCommentTrigger from "../models/igCommentTrigger.model.js";
import { graphPost } from "./metaLeadAds.js";
import { getInstagramToken } from "./instagramToken.js";
import { upsertCrmLead } from "./crmLeadIntake.js";

// [{ commentId, text, fromId, username, mediaId, igId }] from an Instagram webhook payload.
export function commentEventsFrom(payload) {
  if (payload?.object !== "instagram" || !Array.isArray(payload.entry)) return [];
  return payload.entry.flatMap((entry) => (entry.changes || [])
    .filter((c) => c.field === "comments" && c.value?.id && c.value?.from?.id)
    .map((c) => ({
      commentId: String(c.value.id),
      text: String(c.value.text || ""),
      fromId: String(c.value.from.id),
      username: c.value.from.username ? String(c.value.from.username) : undefined,
      mediaId: c.value.media?.id ? String(c.value.media.id) : undefined,
      igId: String(entry.id),
      isReply: Boolean(c.value.parent_id),
    })));
}

// [{ mid, text, fromId, igId }] for DMs people send to our account (webhook `messages` field).
export function messageEventsFrom(payload) {
  if (payload?.object !== "instagram" || !Array.isArray(payload.entry)) return [];
  return payload.entry.flatMap((entry) => (entry.messaging || [])
    .filter((m) => m.message?.mid && m.sender?.id && !m.message.is_echo && String(m.sender.id) !== String(entry.id))
    .map((m) => ({
      mid: String(m.message.mid),
      text: String(m.message.text || (m.message.attachments?.length ? "[attachment]" : "")),
      fromId: String(m.sender.id),
      igId: String(entry.id),
    })));
}

// Tokens from "Instagram API with Instagram login" only work on graph.instagram.com;
// without one we fall back to the Page token on graph.facebook.com.
export async function igPost(path, body) {
  const token = await getInstagramToken();
  if (!token) return graphPost(path, body);

  const res = await fetch(`https://graph.instagram.com/${process.env.META_GRAPH_VERSION || "v21.0"}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Instagram API responded ${res.status}`);
  return data;
}

// Instagram button templates allow up to 640 characters of text and a 20-character label.
const BUTTON_TEXT_MAX = 640;
const BUTTON_LABEL = "View details";

const buttonMessage = (trigger) => trigger.linkUrl && trigger.dmText.length <= BUTTON_TEXT_MAX
  ? { attachment: { type: "template", payload: { template_type: "button", text: trigger.dmText, buttons: [{ type: "web_url", url: trigger.linkUrl, title: BUTTON_LABEL }] } } }
  : null;

// A tappable button keeps the message clean; if Instagram refuses it, send the link as plain text.
async function sendDm(event, trigger) {
  const to = { comment_id: event.commentId };
  const button = buttonMessage(trigger);
  if (button) {
    try {
      return await igPost(`${event.igId}/messages`, { recipient: to, message: button });
    } catch (err) {
      console.warn(`[instagram] comment ${event.commentId} button DM refused (${err.message}) — sending text instead`);
    }
  }
  const text = [trigger.dmText, trigger.linkUrl].filter(Boolean).join("\n\n");
  return igPost(`${event.igId}/messages`, { recipient: to, message: { text } });
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function matchTrigger({ text, mediaId }) {
  const triggers = await IgCommentTrigger.find({ active: true }).lean();
  return triggers.find((t) =>
    (!t.mediaIds.length || (mediaId && t.mediaIds.includes(mediaId))) &&
    t.keywords.some((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(k)}($|[^\\p{L}\\p{N}])`, "iu").test(text)));
}

async function captureLead(event, trigger) {
  const activity = {
    activityTitle: "Lead captured from Instagram comment",
    activityBody: `@${event.username || event.fromId} commented "${event.text.slice(0, 120)}" · trigger: ${trigger.label}`,
    metadata: { igCommentId: event.commentId, igUserId: event.fromId, triggerId: trigger._id },
  };

  const existing = await CRMLead.findOne({ "customFields.igUserId": event.fromId, isDeleted: false }).select("_id");
  if (existing) {
    await CRMActivity.create({
      type: "created", title: "Commented again on Instagram", body: activity.activityBody,
      relatedToType: "lead", relatedToId: existing._id, metadata: activity.metadata,
    });
    return existing;
  }

  const { lead } = await upsertCrmLead({
    fields: {
      name: event.username ? `@${event.username}` : "Instagram lead",
      source: "social",
      interest: trigger.label,
      utm: { utm_source: "instagram", utm_medium: "social", utm_campaign: "comment_to_dm", utm_content: trigger._id.toString() },
      customFields: { origin: "instagram_comment", igUserId: event.fromId, igUsername: event.username, igMediaId: event.mediaId },
    },
    activityTitle: activity.activityTitle,
    activityBody: activity.activityBody,
    metadata: activity.metadata,
  });
  return lead;
}

export async function handleInstagramComment(event) {
  // Ignore our own account's comments (our public reply would otherwise re-trigger) and threaded replies.
  if (event.fromId === event.igId || event.isReply) return { skipped: "own-or-reply" };
  if (await CRMActivity.exists({ "metadata.igCommentId": event.commentId })) return { skipped: "duplicate" };

  const trigger = await matchTrigger(event);
  if (!trigger) return { skipped: "no-match" };

  const lead = await captureLead(event, trigger);
  await IgCommentTrigger.updateOne({ _id: trigger._id }, { $inc: { triggerCount: 1 } });

  const results = await Promise.allSettled([
    trigger.replyText && igPost(`${event.commentId}/replies`, { message: trigger.replyText }),
    sendDm(event, trigger).then(async (sent) => {
      await CRMActivity.create({
        type: "instagram_dm", title: "Instagram DM sent (auto)", body: [trigger.dmText, trigger.linkUrl].filter(Boolean).join("\n\n"),
        relatedToType: "lead", relatedToId: lead._id,
        metadata: { direction: "out", automated: true, igUserId: event.fromId, igMessageMid: sent?.message_id, triggerId: trigger._id },
      });
    }),
  ]);
  results.filter((r) => r.status === "rejected")
    .forEach((r) => console.error(`[instagram] comment ${event.commentId} reply/DM failed:`, r.reason.message));
  return { triggered: trigger._id };
}

// A person replied to our DM: add it to their lead's timeline (creating the lead if we haven't met them).
export async function handleInstagramMessage(event) {
  if (await CRMActivity.exists({ "metadata.igMessageMid": event.mid })) return { skipped: "duplicate" };

  let lead = await CRMLead.findOne({ "customFields.igUserId": event.fromId, isDeleted: false }).select("_id");
  if (!lead) {
    ({ lead } = await upsertCrmLead({
      fields: {
        name: "Instagram lead",
        source: "social",
        utm: { utm_source: "instagram", utm_medium: "social", utm_campaign: "direct_message" },
        customFields: { origin: "instagram_dm", igUserId: event.fromId },
      },
      activityTitle: "Lead captured from Instagram DM",
      activityBody: event.text.slice(0, 120),
      metadata: { igUserId: event.fromId },
    }));
  }

  await CRMActivity.create({
    type: "instagram_dm", title: "Instagram DM received", body: event.text,
    relatedToType: "lead", relatedToId: lead._id,
    metadata: { direction: "in", igUserId: event.fromId, igId: event.igId, igMessageMid: event.mid },
  });
  return { logged: lead._id };
}
