import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CrmUser from "../models/crmUser.model.js";
import { AD_POOL_QUERY } from "./crmLeadIntake.js";
import { notifyLeadAssigned } from "./crmLeadNotify.js";

const CLOSED_STATUSES = ["won", "lost", "junk"];
// A rep's own outreach. Inbound messages are logged without performedBy, so they don't count.
const CONTACT_TYPES = ["call", "email", "whatsapp", "meeting"];
// Alerts only go out 9am-9pm IST; leads that arrive overnight are alerted in the morning.
const ALERT_FROM_HOUR = 9;
const ALERT_TO_HOUR = 21;
// Older leads are left alone, so the first run after deploy doesn't alert on a backlog.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

const istHour = (d) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(d));

// Every 15 min: warn the assignee and the admins about paid-ad leads still uncontacted after the SLA
// (CRM_AD_LEAD_SLA_MINUTES, default 30). A lead is claimed (slaAlertedAt) before notifying, so each
// lead is alerted at most once.
export async function sendUntouchedAdLeadAlerts(now = new Date()) {
  const hour = istHour(now);
  if (hour < ALERT_FROM_HOUR || hour >= ALERT_TO_HOUR) return { sent: 0 };

  const slaMinutes = Number(process.env.CRM_AD_LEAD_SLA_MINUTES) || 30;
  const leads = await CRMLead.find({
    isDeleted: false,
    ...AD_POOL_QUERY,
    assignedTo: { $ne: null },
    slaAlertedAt: null,
    status: { $nin: CLOSED_STATUSES },
    createdAt: { $lte: new Date(now.getTime() - slaMinutes * 60 * 1000), $gte: new Date(now.getTime() - LOOKBACK_MS) },
  }).sort({ createdAt: 1 }).limit(100)
    .select("name phone email interest company source priority assignedTo createdAt").lean();
  if (!leads.length) return { sent: 0 };

  const touched = new Set((await CRMActivity.distinct("relatedToId", {
    relatedToType: "lead",
    relatedToId: { $in: leads.map((l) => l._id) },
    type: { $in: CONTACT_TYPES },
    performedBy: { $ne: null },
  })).map(String));

  const admins = (await CrmUser.find({ active: true, crmRole: { $in: ["super_admin", "admin"] } }).select("_id").lean()).map((u) => String(u._id));

  let sent = 0;
  for (const lead of leads) {
    if (touched.has(String(lead._id))) continue;
    const claim = await CRMLead.updateOne({ _id: lead._id, slaAlertedAt: null }, { slaAlertedAt: now });
    if (!claim.modifiedCount) continue;

    const waitedMinutes = Math.max(slaMinutes, Math.round((now - new Date(lead.createdAt)) / 60000));
    const recipients = new Set([String(lead.assignedTo), ...admins]);
    for (const assigneeId of recipients) notifyLeadAssigned({ leads: lead, assigneeId, reason: "untouched", waitedMinutes });
    sent++;
  }
  return { sent };
}
