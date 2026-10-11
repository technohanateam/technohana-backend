import CRMTask from "../models/crm/crmTask.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CrmUser from "../models/crmUser.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { escapeHtml } from "../utils/emailTemplate.js";
import { resolveRange, istDateStr } from "./crmDailyReport.js";

const OPEN_TASK = { isDeleted: false, status: { $in: ["open", "in_progress"] } };
const CRM_URL = () => process.env.CRM_FRONTEND_URL || "https://crm.technohana.in";
// Reminders older than this are skipped, so the first run after deploy doesn't
// email every past-due reminder in the database at once.
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

const fmtIst = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

const shell = (title, body) => `<div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
  <div style="background:#7C3AED;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:700">${title}</div>
  <div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 12px 12px;font-size:14px;line-height:1.5">${body}
    <p style="margin-top:20px"><a href="${CRM_URL()}" style="background:#7C3AED;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the CRM</a></p>
  </div></div>`;

// Every 15 min: email the assignee of each task whose reminder time has passed.
// A task is claimed (reminderSentAt set) before sending so overlapping runs can't
// double-send; a failed send releases it for the next run.
export async function sendDueTaskReminders(now = new Date()) {
  const tasks = await CRMTask.find({
    ...OPEN_TASK,
    reminderAt: { $lte: now, $gte: new Date(now.getTime() - REMINDER_WINDOW_MS) },
    reminderSentAt: null,
    assignedTo: { $ne: null },
  }).limit(200).populate("assignedTo", "name email active").lean();

  let sent = 0;
  for (const task of tasks) {
    const claim = await CRMTask.updateOne({ _id: task._id, reminderSentAt: null }, { reminderSentAt: now });
    if (!claim.modifiedCount || !task.assignedTo?.active || !task.assignedTo.email) continue;
    try {
      const due = task.dueDate ? `<p>Due: <strong>${escapeHtml(istDateStr(new Date(task.dueDate)))}</strong></p>` : "";
      const result = await sendEmail({
        from: fromAddresses.sales,
        to: task.assignedTo.email,
        subject: `Reminder: ${task.title}`,
        html: shell("Task reminder", `<p>Hi ${escapeHtml(task.assignedTo.name)},</p>
          <p>You asked to be reminded about <strong>${escapeHtml(task.title)}</strong> (${escapeHtml(fmtIst(task.reminderAt))} IST).</p>
          ${due}${task.description ? `<p style="color:#475569">${escapeHtml(task.description)}</p>` : ""}`),
      });
      if (result?.error) throw new Error(result.error.message || "send failed");
      sent++;
    } catch (err) {
      console.error(`[crm-reminders] task ${task._id} reminder failed:`, err.message);
      await CRMTask.updateOne({ _id: task._id }, { reminderSentAt: null });
    }
  }
  return { sent };
}

const list = (items, render) => `<ul style="padding-left:18px;margin:6px 0 14px">${items.map((i) => `<li>${render(i)}</li>`).join("")}</ul>`;

// 9 AM IST: each rep gets one email listing their overdue tasks, tasks due today
// and leads whose follow-up date has arrived. Reps with nothing pending get nothing.
export async function sendDailyDigests() {
  const { start, end } = resolveRange();
  const reps = await CrmUser.find({ active: true, crmRole: { $in: ["super_admin", "admin", "sales", "marketing"] } })
    .select("name email").lean();

  let sent = 0;
  for (const rep of reps) {
    const [overdue, today, followUps] = await Promise.all([
      CRMTask.find({ ...OPEN_TASK, assignedTo: rep._id, dueDate: { $lt: start } }).sort({ dueDate: 1 }).limit(15).select("title dueDate").lean(),
      CRMTask.find({ ...OPEN_TASK, assignedTo: rep._id, dueDate: { $gte: start, $lt: end } }).sort({ dueDate: 1 }).limit(15).select("title").lean(),
      CRMLead.find({ isDeleted: false, assignedTo: rep._id, status: { $nin: ["won", "lost", "junk"] }, nextFollowUp: { $lt: end } })
        .sort({ nextFollowUp: 1 }).limit(15).select("name company nextFollowUp").lean(),
    ]);
    if (!overdue.length && !today.length && !followUps.length) continue;

    const sections = [
      overdue.length && `<p><strong>Overdue tasks</strong></p>${list(overdue, (t) => `${escapeHtml(t.title)} <span style="color:#dc2626">(due ${escapeHtml(istDateStr(new Date(t.dueDate)))})</span>`)}`,
      today.length && `<p><strong>Due today</strong></p>${list(today, (t) => escapeHtml(t.title))}`,
      followUps.length && `<p><strong>Follow-ups due</strong></p>${list(followUps, (l) => `<a href="${CRM_URL()}/leads/${l._id}">${escapeHtml(l.name)}</a>${l.company ? ` · ${escapeHtml(l.company)}` : ""}`)}`,
    ].filter(Boolean).join("");

    try {
      const result = await sendEmail({
        from: fromAddresses.sales,
        to: rep.email,
        subject: `Your CRM day — ${istDateStr()}`,
        html: shell("Today in the CRM", `<p>Good morning ${escapeHtml(rep.name)},</p>${sections}`),
      });
      if (result?.error) throw new Error(result.error.message || "send failed");
      sent++;
    } catch (err) {
      console.error(`[crm-reminders] digest for ${rep.email} failed:`, err.message);
    }
  }
  return { sent };
}
