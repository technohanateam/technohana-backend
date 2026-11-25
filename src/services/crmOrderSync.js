// When someone the sales team is working buys on the main site, close their CRM
// lead (and its open deal) as won. Site-only buyers with no CRM lead are left to
// the admin panel. Idempotent per order, so retries and duplicate confirms are safe.
import mongoose from "mongoose";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { User } from "../models/user.model.js";
import { syncDealFromLead } from "./crmLifecycle.js";

export async function syncCrmOnOrderPaid(order) {
  const email = typeof order?.learner?.email === "string" ? order.learner.email.toLowerCase().trim() : null;
  const orderId = order?.orderId;
  if (!email || !orderId) return null;
  if (await CRMActivity.exists({ type: "deal_won", "metadata.orderId": orderId })) return null;

  const lead = await CRMLead.findOne({ email, isDeleted: false, status: { $ne: "won" } }).sort({ updatedAt: -1 });
  if (!lead) return null;

  const amount = Math.round(order.expectedTotalMinor || 0) / 100;
  const currency = (order.currency || "inr").toUpperCase();
  const course = order.courseInfo?.title || "a course";
  const prevStatus = lead.status;

  lead.status = "won";
  lead.wonAt = new Date();
  lead.lostAt = undefined;
  if (!lead.enrollmentId) {
    const user = await User.findOne({ email }).sort({ createdAt: -1 }).select("_id").lean();
    if (user) lead.enrollmentId = user._id;
  }
  await lead.save();

  await CRMActivity.create({
    type: "deal_won",
    title: "Paid on the website",
    body: `Bought ${course} — ${currency} ${amount.toFixed(2)} (order ${orderId})`,
    relatedToType: "lead",
    relatedToId: lead._id,
    metadata: { orderId, amount, currency, courseTitle: order.courseInfo?.title, from: prevStatus },
  });
  await syncDealFromLead(lead);
  return lead;
}

// A payment link a rep sent from the CRM was paid: log it and close the lead (and its open deal) as won.
// Contacts only get the activity. Idempotent per payment, so webhook retries are safe.
export async function syncCrmOnPaymentLinkPaid({ crmLeadId, crmContactId, paymentId, amountMinor, currency, description }) {
  if (!paymentId || await CRMActivity.exists({ "metadata.paymentId": paymentId })) return null;
  const amount = Math.round(Number(amountMinor) || 0) / 100;
  const cur = String(currency || "INR").toUpperCase();
  const body = `${cur} ${amount.toFixed(2)} received${description ? ` for ${description}` : ""}`;
  const metadata = { paymentId, amount, currency: cur, via: "payment_link" };

  if (crmLeadId && mongoose.isValidObjectId(crmLeadId)) {
    const lead = await CRMLead.findOne({ _id: crmLeadId, isDeleted: false });
    if (!lead) return null;
    const prevStatus = lead.status;
    if (prevStatus !== "won") {
      lead.status = "won";
      lead.wonAt = new Date();
      lead.lostAt = undefined;
      await lead.save();
    }
    await CRMActivity.create({ type: "deal_won", title: "Paid via payment link", body, relatedToType: "lead", relatedToId: lead._id, metadata: { ...metadata, from: prevStatus } });
    await syncDealFromLead(lead);
    return lead;
  }
  if (crmContactId && mongoose.isValidObjectId(crmContactId)) {
    return CRMActivity.create({ type: "note", title: "Paid via payment link", body, relatedToType: "contact", relatedToId: crmContactId, metadata });
  }
  return null;
}

// The second instalment of a plan was paid: tell the rep who closed the lead. Idempotent per order.
export async function logCrmBalancePaid(order, { paymentId, amountMinor }) {
  const email = typeof order?.learner?.email === "string" ? order.learner.email.toLowerCase().trim() : null;
  if (!email || !order.orderId) return null;
  if (await CRMActivity.exists({ type: "note", "metadata.orderId": order.orderId, "metadata.instalment": 2 })) return null;
  const lead = await CRMLead.findOne({ email, isDeleted: false }).sort({ updatedAt: -1 }).select("_id").lean();
  if (!lead) return null;
  const amount = Math.round(Number(amountMinor) || 0) / 100;
  const cur = (order.currency || "inr").toUpperCase();
  return CRMActivity.create({
    type: "note", title: "Instalment balance paid",
    body: `${cur} ${amount.toFixed(2)} received for ${order.courseInfo?.title || "a course"} (order ${order.orderId}). Fully paid.`,
    relatedToType: "lead", relatedToId: lead._id,
    metadata: { orderId: order.orderId, instalment: 2, paymentId, amount, currency: cur },
  });
}

export const logCrmBalancePaidSafely = (order, payment) => {
  logCrmBalancePaid(order, payment).catch((err) => console.error(`[crm-order-sync] balance ${order?.orderId}:`, err.message));
};

// Fire-and-forget wrapper for the checkout handlers: never delays or fails a payment response.
export const syncCrmOnOrderPaidSafely = (order) => {
  syncCrmOnOrderPaid(order).catch((err) => console.error(`[crm-order-sync] order ${order?.orderId}:`, err.message));
};
