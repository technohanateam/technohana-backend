import CrmZohoConnection from "../models/crm/crmZohoConnection.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import { zohoFetch, ZohoAuthError } from "../config/zohoClient.js";

const PAGE_SIZE = 50;
const MAX_PAGES = 4;
// First sync (or a long gap) only looks this far back so we don't import a whole mailbox.
const FIRST_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const stripHtml = (s = "") => String(s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// Zoho returns "Name <addr@x.com>" or a bare address, sometimes HTML-escaped.
export function extractEmail(raw = "") {
  const decoded = String(raw).replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const m = decoded.match(/<([^>]+)>/);
  return (m ? m[1] : decoded).trim().toLowerCase();
}

async function getInboxFolderId(connection) {
  const json = await zohoFetch(connection, "mail", `/api/accounts/${connection.zohoMailAccountId}/folders`);
  const inbox = (json?.data || []).find((f) => String(f.folderType || "").toLowerCase() === "inbox");
  if (!inbox?.folderId) throw new Error("Zoho Inbox folder not found");
  return String(inbox.folderId);
}

// Matches a sender to the rep's own lead/contact; sales reps only ever see their own leads.
async function findRecord(email, repId) {
  const lead = await CRMLead.findOne({ email, isDeleted: false, assignedTo: repId }).select("_id").lean();
  if (lead) return { relatedToType: "lead", relatedToId: lead._id };
  const contact = await CRMContact.findOne({ email, isDeleted: false }).select("_id").lean();
  if (contact) return { relatedToType: "contact", relatedToId: contact._id };
  return null;
}

export async function syncMailForConnection(connection) {
  const since = connection.lastMailSyncAt
    ? connection.lastMailSyncAt.getTime() - 60_000
    : Date.now() - FIRST_SYNC_LOOKBACK_MS;
  const ownAddress = (connection.emailAddress || "").toLowerCase();
  let imported = 0;

  try {
    const folderId = await getInboxFolderId(connection);

    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        folderId, start: String(page * PAGE_SIZE + 1), limit: String(PAGE_SIZE), sortBy: "date", sortorder: "false",
      });
      const json = await zohoFetch(connection, "mail", `/api/accounts/${connection.zohoMailAccountId}/messages/view?${qs}`);
      const messages = json?.data || [];
      if (!messages.length) break;

      for (const msg of messages) {
        const receivedAt = Number(msg.receivedTime || msg.sentDateInGMT);
        if (receivedAt && receivedAt < since) { page = MAX_PAGES; break; }

        const from = extractEmail(msg.fromAddress || msg.sender);
        if (!from || from === ownAddress) continue;

        const zohoMessageId = String(msg.messageId);
        if (await CRMActivity.exists({ "metadata.zohoMessageId": zohoMessageId })) continue;

        const record = await findRecord(from, connection.crmUserId);
        if (!record) continue;

        await CRMActivity.create({
          type: "email",
          title: stripHtml(msg.subject) || "(no subject)",
          body: stripHtml(msg.summary).slice(0, 2000) || undefined,
          ...record,
          performedBy: connection.crmUserId,
          createdAt: receivedAt ? new Date(receivedAt) : undefined,
          metadata: {
            provider: "zoho", direction: "in", from, to: ownAddress,
            subject: stripHtml(msg.subject), zohoMessageId, status: "received",
          },
        });
        imported++;
      }
      if (messages.length < PAGE_SIZE) break;
    }

    await CrmZohoConnection.updateOne({ _id: connection._id }, {
      lastMailSyncAt: new Date(), lastSyncStatus: "success", $unset: { lastSyncError: 1 },
    });
  } catch (err) {
    // A 401 on an API call usually means a missing scope; getAccessToken deactivates the connection on a revoked token.
    const message = err instanceof ZohoAuthError
      ? "Zoho rejected the request — disconnect and reconnect Zoho to grant the latest permissions"
      : err.message.slice(0, 300);
    await CrmZohoConnection.updateOne({ _id: connection._id }, { lastSyncStatus: "error", lastSyncError: message });
    throw err;
  }
  return imported;
}

export async function syncAllMailboxes() {
  const connections = await CrmZohoConnection.find({ isActive: true, zohoMailAccountId: { $exists: true, $ne: null } });
  let imported = 0;
  let failed = 0;
  for (const conn of connections) {
    try {
      imported += await syncMailForConnection(conn);
    } catch (err) {
      failed++;
      console.warn(`[zoho-mail-sync] ${conn.emailAddress || conn._id}: ${err.message}`);
    }
  }
  return { mailboxes: connections.length, imported, failed };
}
