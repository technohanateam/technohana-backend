import mongoose from "mongoose";
import IgCommentTrigger from "../models/igCommentTrigger.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { leadScope, sendCrmError } from "../utils/crmQuery.js";
import { igPost } from "../services/instagramComments.js";

const EDITABLE = ["label", "keywords", "mediaIds", "replyText", "dmText", "linkUrl", "active"];
const pick = (body) => Object.fromEntries(EDITABLE.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));

const fail = (res, err, fallback) =>
  err.name === "ValidationError"
    ? res.status(400).json({ success: false, message: err.message })
    : sendCrmError(res, err, fallback);

const triggerNotFound = (res) => res.status(404).json({ success: false, message: "Trigger not found" });
const validId = (id) => mongoose.isValidObjectId(id);

// Instagram only lets us message a user within 24 hours of their last message to us.
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const listIgTriggers = async (_req, res) => {
  try {
    res.json({ success: true, data: await IgCommentTrigger.find().sort({ createdAt: -1 }).lean() });
  } catch (err) {
    fail(res, err, "Could not load triggers");
  }
};

export const createIgTrigger = async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await IgCommentTrigger.create(pick(req.body)) });
  } catch (err) {
    fail(res, err, "Could not create trigger");
  }
};

export const updateIgTrigger = async (req, res) => {
  try {
    if (!validId(req.params.id)) return triggerNotFound(res);
    const trigger = await IgCommentTrigger.findByIdAndUpdate(
      req.params.id, { $set: pick(req.body) }, { new: true, runValidators: true }
    );
    trigger ? res.json({ success: true, data: trigger }) : triggerNotFound(res);
  } catch (err) {
    fail(res, err, "Could not update trigger");
  }
};

export const deleteIgTrigger = async (req, res) => {
  try {
    if (!validId(req.params.id)) return triggerNotFound(res);
    const trigger = await IgCommentTrigger.findByIdAndDelete(req.params.id);
    trigger ? res.json({ success: true, message: "Deleted" }) : triggerNotFound(res);
  } catch (err) {
    fail(res, err, "Could not delete trigger");
  }
};

export const sendInstagramReply = async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 1000) {
      return res.status(400).json({ success: false, message: "Message must be 1–1000 characters" });
    }

    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope).select("_id customFields").lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const igUserId = lead.customFields?.igUserId;
    if (!igUserId) return res.status(400).json({ success: false, message: "This lead has no Instagram account" });

    const lastInbound = await CRMActivity.findOne({
      relatedToType: "lead", relatedToId: lead._id, type: "instagram_dm", "metadata.direction": "in",
    }).sort({ createdAt: -1 }).select("createdAt metadata.igId").lean();
    if (!lastInbound || Date.now() - lastInbound.createdAt.getTime() > REPLY_WINDOW_MS) {
      return res.status(409).json({
        success: false,
        message: "Instagram only allows replies within 24 hours of the person's last message",
      });
    }

    const igId = lastInbound.metadata?.igId || "me";
    let sent;
    try {
      sent = await igPost(`${igId}/messages`, { recipient: { id: igUserId }, message: { text } });
    } catch (err) {
      return res.status(502).json({ success: false, message: `Instagram rejected the message: ${err.message}` });
    }

    const activity = await CRMActivity.create({
      type: "instagram_dm", title: "Instagram DM sent", body: text,
      relatedToType: "lead", relatedToId: lead._id, performedBy: req.admin._id,
      metadata: { direction: "out", igUserId, igMessageMid: sent?.message_id },
    });
    res.status(201).json({ success: true, data: activity });
  } catch (err) {
    fail(res, err, "Could not send Instagram reply");
  }
};
