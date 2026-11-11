import CrmZohoConnection from "../models/crm/crmZohoConnection.model.js";
import { zohoFetch, ZohoAuthError } from "../config/zohoClient.js";

export const getActiveConnection = (crmUserId) =>
  CrmZohoConnection.findOne({ crmUserId, isActive: true });

// ── Mail ────────────────────────────────────────────────────────────────────

export async function fetchMailAccount(connection) {
  const json = await zohoFetch(connection, "mail", "/api/accounts");
  const acct = json?.data?.[0];
  if (!acct?.accountId) throw new Error("No Zoho Mail account found for this user");
  return {
    accountId: String(acct.accountId),
    emailAddress: acct.primaryEmailAddress || acct.mailboxAddress || acct.emailAddress?.[0]?.mailId,
  };
}

// Zoho attachments are two steps: upload the file to Zoho's store, then reference the
// returned storeName / attachmentName / attachmentPath in the send call.
// NOTE: the multipart field name ("file") and the response keys are taken from Zoho's
// docs as summarised by search results, not verified against a live account. Test with a
// connected mailbox. Missing keys fail loudly here instead of sending without the file.
async function uploadZohoAttachment(connection, { filename, content, contentType = "application/pdf" }) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: contentType }), filename);
  const json = await zohoFetch(connection, "mail",
    `/api/accounts/${connection.zohoMailAccountId}/messages/attachments?uploadType=multipart`, { method: "POST", form });
  const item = [].concat(json?.data ?? [])[0];
  const { storeName, attachmentName, attachmentPath } = item || {};
  if (!storeName || !attachmentName || !attachmentPath) {
    throw new Error("Zoho did not return the uploaded attachment details");
  }
  return { storeName, attachmentName, attachmentPath };
}

export async function sendZohoMail(connection, { to, subject, html, cc, attachments = [] }) {
  const uploaded = [];
  for (const file of attachments) uploaded.push(await uploadZohoAttachment(connection, file));

  const json = await zohoFetch(connection, "mail", `/api/accounts/${connection.zohoMailAccountId}/messages`, {
    method: "POST",
    body: {
      fromAddress: connection.emailAddress,
      toAddress: to,
      ...(cc ? { ccAddress: cc } : {}),
      subject,
      content: html,
      mailFormat: "html",
      ...(uploaded.length ? { attachments: uploaded } : {}),
    },
  });
  return { messageId: json?.data?.messageId ? String(json.data.messageId) : undefined };
}

// ── Meeting ─────────────────────────────────────────────────────────────────

export async function fetchMeetingUser(connection) {
  const json = await zohoFetch(connection, "meeting", "/api/v2/user.json");
  const u = json?.userDetails;
  if (!u?.zsoid) throw new Error("Zoho Meeting is not enabled for this account");
  return { zsoid: String(u.zsoid), zuid: String(u.zuid) };
}

// Zoho Meeting wants "MMM dd, yyyy hh:mm a" in the session's timezone.
function formatZohoStart(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return `${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

export async function createZohoMeeting(connection, { topic, agenda, startsAt, durationMinutes = 30, participants = [], timeZone = "Asia/Kolkata" }) {
  if (!connection.zohoMeetingZsoid) throw new Error("Zoho Meeting is not set up for this connection");
  const json = await zohoFetch(connection, "meeting", `/api/v2/${connection.zohoMeetingZsoid}/sessions.json`, {
    method: "POST",
    body: {
      session: {
        topic,
        agenda,
        presenter: connection.zohoMeetingZuid,
        startTime: formatZohoStart(new Date(startsAt), timeZone),
        duration: durationMinutes * 60 * 1000,
        timezone: timeZone,
        participants: participants.filter(Boolean).map((email) => ({ email })),
      },
    },
  });
  const s = json?.session;
  if (!s?.meetingKey) throw new Error("Zoho did not return a meeting");
  return { meetingKey: String(s.meetingKey), joinLink: s.joinLink, startLink: s.startLink };
}

export { ZohoAuthError };
