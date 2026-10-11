// When someone the sales team is working buys on the main site, close their CRM
// lead (and its open deal) as won. Site-only buyers with no CRM lead are left to
// the admin panel. Idempotent per order, so retries and duplicate confirms are safe.
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

// Fire-and-forget wrapper for the checkout handlers: never delays or fails a payment response.
export const syncCrmOnOrderPaidSafely = (order) => {
  syncCrmOnOrderPaid(order).catch((err) => console.error(`[crm-order-sync] order ${order?.orderId}:`, err.message));
};
