import crypto from "crypto";
import jwt from "jsonwebtoken";
import CrmZohoConnection from "../models/crm/crmZohoConnection.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTask from "../models/crm/crmTask.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import {
  buildConsentUrl, exchangeCodeForTokens, encryptRefreshToken, decryptRefreshToken, revokeRefreshToken,
  isZohoConfigured, isMeetingEnabled, ZohoNotConfiguredError, ZohoAuthError, getZohoScopes,
} from "../config/zohoClient.js";
import { fetchMailAccount, fetchMeetingUser, createZohoMeeting, getActiveConnection, sendZohoMail } from "../services/zohoService.js";
import { isValidId, ownerFilter, dealOwnerFilter, sendCrmError } from "../utils/crmQuery.js";
import { escapeHtml } from "../utils/emailTemplate.js";

const crmAppUrl = () => process.env.CRM_FRONTEND_URL || "/";
const redirectToApp = (res, query) => res.redirect(`${crmAppUrl()}/integrations?${query}`);

export const getZohoStatus = async (req, res) => {
  try {
    const conn = await CrmZohoConnection.findOne({ crmUserId: req.admin._id }).select("-encryptedRefreshToken").lean();
    res.json({
      success: true,
      data: {
        configured: isZohoConfigured(),
        meetingAvailable: isMeetingEnabled(),
        connected: Boolean(conn?.isActive),
        needsReconnect: Boolean(conn && !conn.isActive),
        emailAddress: conn?.emailAddress,
        mailEnabled: Boolean(conn?.isActive && conn.zohoMailAccountId),
        meetingEnabled: Boolean(conn?.isActive && conn.zohoMeetingZsoid),
        lastSyncAt: conn?.lastMailSyncAt,
        lastSyncStatus: conn?.lastSyncStatus,
        lastSyncError: conn?.lastSyncError,
      },
    });
  } catch (err) {
    sendCrmError(res, err, "Failed to load Zoho status");
  }
};

export const getZohoConnectUrl = async (req, res) => {
  try {
    const state = jwt.sign(
      { uid: String(req.admin._id), nonce: crypto.randomBytes(8).toString("hex"), purpose: "zoho-connect" },
      process.env.CRM_JWT_SECRET,
      { expiresIn: "10m" }
    );
    res.json({ success: true, data: { url: buildConsentUrl(state) } });
  } catch (err) {
    if (err instanceof ZohoNotConfiguredError) {
      return res.status(503).json({ success: false, message: "Zoho isn't configured on the server yet." });
    }
    sendCrmError(res, err, "Failed to start Zoho connection");
  }
};

// Public — Zoho redirects the browser here, so there is no Bearer token; `state` is the proof.
export const handleZohoCallback = async (req, res) => {
  try {
    const { code, state, error: zohoError } = req.query;
    if (zohoError) return redirectToApp(res, "zoho=denied");
    if (!code || !state) return redirectToApp(res, "zoho=error&reason=missing_params");

    let payload;
    try {
      payload = jwt.verify(String(state), process.env.CRM_JWT_SECRET);
    } catch (e) {
      return redirectToApp(res, `zoho=error&reason=${e.name === "TokenExpiredError" ? "state_expired" : "state_invalid"}`);
    }
    if (payload.purpose !== "zoho-connect" || !isValidId(payload.uid)) return redirectToApp(res, "zoho=error&reason=state_invalid");

    const tokens = await exchangeCodeForTokens(String(code));
    if (!tokens.refresh_token) return redirectToApp(res, "zoho=error&reason=no_refresh_token");

    const conn = await CrmZohoConnection.findOneAndUpdate(
      { crmUserId: payload.uid },
      {
        $set: {
          encryptedRefreshToken: encryptRefreshToken(tokens.refresh_token),
          scopes: getZohoScopes(),
          isActive: true,
          connectedAt: new Date(),
          lastSyncStatus: "never",
          lastSyncError: undefined,
        },
      },
      { upsert: true, new: true }
    );

    // Mail and Meeting are looked up independently — a rep without a Meeting licence still gets Mail.
    const [mail, meeting] = await Promise.allSettled([
      fetchMailAccount(conn),
      isMeetingEnabled() ? fetchMeetingUser(conn) : Promise.reject(new Error("Zoho Meeting disabled")),
    ]);
    if (mail.status === "fulfilled") {
      conn.zohoMailAccountId = mail.value.accountId;
      conn.emailAddress = mail.value.emailAddress;
    }
    if (meeting.status === "fulfilled") {
      conn.zohoMeetingZsoid = meeting.value.zsoid;
      conn.zohoMeetingZuid = meeting.value.zuid;
    }
    await conn.save();

    if (mail.status === "rejected" && meeting.status === "rejected") {
      return redirectToApp(res, "zoho=error&reason=no_services");
    }
    redirectToApp(res, "zoho=connected");
  } catch (err) {
    console.error("Zoho OAuth callback failed:", err.message);
    redirectToApp(res, "zoho=error&reason=unknown");
  }
};

export const disconnectZoho = async (req, res) => {
  try {
    const conn = await CrmZohoConnection.findOne({ crmUserId: req.admin._id });
    if (!conn) return res.json({ success: true, message: "Not connected" });
    try {
      await revokeRefreshToken(decryptRefreshToken(conn));
    } catch (e) {
      console.warn("Zoho token revoke failed (continuing):", e.message);
    }
    await CrmZohoConnection.deleteOne({ _id: conn._id });
    res.json({ success: true, message: "Zoho disconnected" });
  } catch (err) {
    sendCrmError(res, err, "Failed to disconnect Zoho");
  }
};

// POST /meetings — schedules a Zoho Meeting for a lead or deal, logs it and creates a task.
export const scheduleMeeting = async (req, res) => {
  try {
    const { leadId, dealId, topic, agenda, startsAt, durationMinutes, sendInvite } = req.body;
    if (typeof topic !== "string" || !topic.trim() || topic.length > 200) {
      return res.status(400).json({ success: false, message: "Add a meeting topic (up to 200 characters)" });
    }
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60_000) {
      return res.status(400).json({ success: false, message: "Pick a start time in the future" });
    }
    // Zoho Meeting's free plan caps a session at 60 minutes; raise via ZOHO_MEETING_MAX_MINUTES on a paid plan.
    const maxMinutes = parseInt(process.env.ZOHO_MEETING_MAX_MINUTES, 10) || 60;
    const duration = Math.min(Math.max(parseInt(durationMinutes, 10) || 30, 15), maxMinutes);

    let record, relatedToType;
    if (leadId && isValidId(String(leadId))) {
      relatedToType = "lead";
      record = await CRMLead.findOne({ _id: leadId, isDeleted: false, ...ownerFilter(req) }).select("name email").lean();
    } else if (dealId && isValidId(String(dealId))) {
      relatedToType = "deal";
      record = await CRMDeal.findOne({ _id: dealId, isDeleted: false, ...(await dealOwnerFilter(req)) }).select("title").lean();
    }
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const conn = await getActiveConnection(req.admin._id);
    if (!conn?.zohoMeetingZsoid) {
      return res.status(409).json({ success: false, message: "Connect your Zoho account (with Zoho Meeting) from your profile first." });
    }

    const inviteTo = relatedToType === "lead" ? record.email : undefined;
    let meeting;
    try {
      meeting = await createZohoMeeting(conn, {
        topic: topic.trim(), agenda: typeof agenda === "string" ? agenda.slice(0, 2000) : undefined,
        startsAt: start, durationMinutes: duration, participants: [inviteTo],
      });
    } catch (err) {
      if (err instanceof ZohoAuthError) {
        return res.status(409).json({ success: false, message: "Your Zoho connection expired — reconnect it from your profile." });
      }
      console.error("Zoho meeting create failed:", err.message);
      return res.status(502).json({ success: false, message: "Zoho couldn't create the meeting. Try again shortly." });
    }

    const activity = await CRMActivity.create({
      type: "meeting",
      title: topic.trim(),
      body: typeof agenda === "string" ? agenda.slice(0, 2000) : undefined,
      relatedToType,
      relatedToId: record._id,
      performedBy: req.admin._id,
      metadata: {
        provider: "zoho", meetingKey: meeting.meetingKey, joinLink: meeting.joinLink, startLink: meeting.startLink,
        link: meeting.joinLink, at: start, durationMinutes: duration, status: "scheduled",
      },
    });

    await CRMTask.create({
      title: topic.trim(),
      type: "meeting",
      dueDate: start,
      relatedToType,
      relatedToId: record._id,
      assignedTo: req.admin._id,
      createdBy: req.admin._id,
    }).catch((e) => console.warn("Meeting task not created:", e.message));

    let invited = false;
    if (sendInvite && inviteTo && conn.zohoMailAccountId) {
      const when = start.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
      try {
        await sendZohoMail(conn, {
          to: inviteTo,
          subject: `Meeting: ${topic.trim()}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">
            <p>Hi ${escapeHtml(record.name || "there")},</p>
            <p>${escapeHtml(req.admin.name || "Our team")} has scheduled a meeting with you.</p>
            <p><strong>${escapeHtml(topic.trim())}</strong><br/>${escapeHtml(when)} IST (${duration} min)</p>
            <p><a href="${escapeHtml(meeting.joinLink)}">Join the meeting</a></p></div>`,
        });
        invited = true;
      } catch (e) {
        console.warn("Meeting invite email failed:", e.message);
      }
    }

    res.status(201).json({ success: true, data: { activityId: activity._id, joinLink: meeting.joinLink, invited }, message: "Meeting scheduled" });
  } catch (err) {
    sendCrmError(res, err, "Failed to schedule meeting");
  }
};
