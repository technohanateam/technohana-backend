import CRMTask from "../models/crm/crmTask.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { normalizePhone } from "../utils/phone.js";

// Follow-up cadence for the "AI for Data Analysts" free session. The CRM schedules the tasks
// (they reach reps in the 9 AM digest); the rep taps the wa.me link and sends the message.
export const OUTREACH_SEQUENCE = "ai-analyst-session";
const SESSION_DATE = process.env.OUTREACH_SESSION_DATE || "2026-11-01";
const SESSION_LABEL = process.env.OUTREACH_SESSION_LABEL || "1 November";
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const OPEN = ["open", "in_progress"];

const siteUrl = () => (process.env.FRONTEND_URL || "https://www.technohana.in").replace(/\/$/, "");
const sessionLink = () => `${siteUrl()}/free-ai-analyst-session?utm_source=whatsapp&utm_medium=outreach&utm_campaign=ai-analyst-list`;

const STEPS = [
  {
    key: "intro", title: "Send intro on WhatsApp",
    text: ({ name, rep }) => `Hi ${name}, this is ${rep} from Technohana. Are you still interested in Data Analytics or moving into AI Analyst roles? We're running a free live session on ${SESSION_LABEL}. Want me to send the details? (Reply STOP and I won't message again.)`,
  },
  {
    key: "reminder", title: "Reminder with session link",
    text: ({ name, rep }) => `Hi ${name}, ${rep} from Technohana again. Quick reminder about the free AI for Data Analysts session on ${SESSION_LABEL}. You can reserve your seat here: ${sessionLink()}`,
  },
  {
    key: "day_before", title: "Session tomorrow: last call",
    text: ({ name }) => `Hi ${name}, the free AI for Data Analysts session is tomorrow (${SESSION_LABEL}). Reserve your seat here if you'd like to join: ${sessionLink()}`,
  },
  {
    key: "session_day", title: "Session today: send joining details",
    text: ({ name }) => `Hi ${name}, the free AI for Data Analysts session is today. If you've registered, check your WhatsApp and email for the joining link. Not registered yet? ${sessionLink()}`,
  },
  {
    key: "post_session", title: "Post-session follow-up",
    text: ({ name }) => `Hi ${name}, thanks for your interest in the AI for Data Analysts session. Would you like to talk about the next step toward an AI Analyst role? Reply here and I'll share the options.`,
  },
];

// Placeholder names from CSV imports ("AI Analyst Lead 9198…") would read badly in a message.
const greetingName = (lead) => {
  const first = String(lead.name || "").trim().split(/\s+/)[0];
  return !first || /\d{5,}/.test(lead.name) || /^(ai|whatsapp)$/i.test(first) ? "there" : first;
};

const istMidnight = (date) => {
  const t = new Date(date.getTime() + IST_OFFSET_MS);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
};
// 10:00 IST on the given IST day (dayMs is that day's midnight, expressed as UTC).
const at10Ist = (dayMs) => new Date(dayMs + 10 * 60 * 60 * 1000 - IST_OFFSET_MS);

// Which steps still make sense when the sequence starts at `now`: nothing after the day
// following the session is scheduled in the past, and the reminder drops out if it would
// land on or after the day-before message.
export function planOutreach(now = new Date(), sessionDate = SESSION_DATE) {
  const today = istMidnight(now);
  const session = Date.parse(sessionDate);
  const days = {
    intro: today,
    reminder: today + 2 * DAY_MS,
    day_before: session - DAY_MS,
    session_day: session,
    post_session: session + DAY_MS,
  };
  return STEPS
    .filter((s) => s.key === "intro" || days[s.key] > today)
    .filter((s) => s.key !== "reminder" || days.reminder < days.day_before)
    .map((s) => ({ ...s, dueDate: at10Ist(days[s.key]) }));
}

const waLink = (phone, country, text) => {
  const e164 = normalizePhone(phone, country);
  return e164 ? `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(text)}` : null;
};

export async function startOutreach(leads, performedBy, now = new Date()) {
  const result = { started: 0, tasks: 0, skipped: [] };
  const plan = planOutreach(now);
  if (!plan.length) return result;

  const ids = leads.map((l) => l._id);
  const busy = new Set((await CRMTask.find({
    relatedToType: "lead", relatedToId: { $in: ids }, sequenceKey: OUTREACH_SEQUENCE, status: { $in: OPEN }, isDeleted: false,
  }).select("relatedToId").lean()).map((t) => String(t.relatedToId)));

  for (const lead of leads) {
    const skip = (reason) => result.skipped.push({ id: lead._id, name: lead.name, reason });
    if (!lead.phone || !normalizePhone(lead.phone, lead.country)) { skip("No valid phone"); continue; }
    if (["won", "lost", "junk"].includes(lead.status)) { skip(`Lead is ${lead.status}`); continue; }
    if (busy.has(String(lead._id))) { skip("Sequence already running"); continue; }

    const ctx = { name: greetingName(lead), rep: lead.assignedTo?.name?.split(" ")[0] || "the Technohana team" };
    const docs = plan.map((step, i) => {
      const text = step.text(ctx);
      return {
        title: `Outreach ${i + 1}/${plan.length}: ${step.title}`,
        description: `Message to send:\n${text}\n\nOpen in WhatsApp: ${waLink(lead.phone, lead.country, text)}`,
        type: "follow_up",
        priority: "medium",
        assignedTo: lead.assignedTo?._id || lead.assignedTo,
        dueDate: step.dueDate,
        relatedToType: "lead",
        relatedToId: lead._id,
        sequenceKey: OUTREACH_SEQUENCE,
        createdBy: performedBy,
      };
    });
    await CRMTask.insertMany(docs);
    await CRMLead.updateOne({ _id: lead._id }, { nextFollowUp: docs[0].dueDate });
    await CRMActivity.create({
      type: "created", title: "Outreach sequence started",
      body: `${docs.length} follow-up tasks scheduled for the AI for Data Analysts session (${SESSION_LABEL})`,
      relatedToType: "lead", relatedToId: lead._id, performedBy,
    });
    result.started++;
    result.tasks += docs.length;
  }
  return result;
}

// Open sequence tasks follow the lead to its new owner.
export async function reassignOutreach(leadIds, userId) {
  const ids = Array.isArray(leadIds) ? leadIds : [leadIds];
  await CRMTask.updateMany(
    { relatedToType: "lead", relatedToId: { $in: ids }, sequenceKey: OUTREACH_SEQUENCE, status: { $in: OPEN } },
    { assignedTo: userId },
  );
}

// A reply, STOP, or a closed/junk lead ends the sequence. Returns how many tasks were cancelled.
export async function cancelOutreach(leadIds) {
  const ids = Array.isArray(leadIds) ? leadIds : [leadIds];
  const res = await CRMTask.updateMany(
    { relatedToType: "lead", relatedToId: { $in: ids }, sequenceKey: OUTREACH_SEQUENCE, status: { $in: OPEN } },
    { status: "cancelled" },
  );
  return res.modifiedCount;
}
