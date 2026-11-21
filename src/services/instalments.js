// Interest-free two-instalment plan: half is paid at enrollment (see /razorpay/checkout and /verify in
// index.js), the other half later through a Razorpay payment link. Nothing here ever adds interest, a
// late fee or any extra charge: a missed balance only puts the learner's classroom access on hold,
// and paying lifts the hold. Every amount is in minor units and the two parts always sum to the price.
import crypto from "crypto";
import Razorpay from "razorpay";
import { Order } from "../models/order.model.js";
import { User } from "../models/user.model.js";
import { sendEmail, fromAddresses } from "../config/emailService.js";
import { generateInstalmentEmail } from "../utils/emailTemplate.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_DAYS_BEFORE = 5;
const LINK_LIFETIME_DAYS = 60;

const positive = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
export const graceDays = (env = process.env) => positive(env.INSTALMENT_GRACE_DAYS, 7);
const fallbackDueDays = (env = process.env) => positive(env.INSTALMENT_FALLBACK_DUE_DAYS, 30);
const REFUND_WINDOW_DAYS = 7;

const frontendUrl = () => process.env.FRONTEND_URL || "https://www.technohana.in";
const money = (minor) => (Number(minor) / 100).toFixed(2);
const prettyDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

let razorpayClient;
const getRazorpay = () => {
  razorpayClient ||= new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  return razorpayClient;
};

// Until a batch is attached the balance is due a fixed number of days after the first payment.
export const initialDueAt = (paidAtMs, env = process.env) => new Date(paidAtMs + fallbackDueDays(env) * DAY_MS);

// Due halfway between the batch start and end, but never within the refund window of the first payment.
export function midpointDueAt({ startDate, endDate }, firstPaidAtMs) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const midpoint = start + (end - start) / 2;
  return new Date(Math.max(midpoint, firstPaidAtMs + REFUND_WINDOW_DAYS * DAY_MS));
}

export const secondInstalment = (order) => order?.instalments?.find((i) => i.seq === 2);

// When an admin puts instalment learners into a batch, the balance moves to the batch midpoint.
export async function recomputeDueForEnrollments(enrollmentIds, batch) {
  if (!batch?.startDate || !batch?.endDate || !enrollmentIds?.length) return 0;
  const users = await User.find({ _id: { $in: enrollmentIds }, paymentPlan: "two_instalment" }).select("orderId").lean();
  let changed = 0;
  for (const u of users) {
    const order = await Order.findOne({ orderId: u.orderId }).select("orderId instalments").lean();
    const first = order?.instalments?.find((i) => i.seq === 1);
    const second = secondInstalment(order);
    if (!second || second.status === "paid" || !first?.paidAt) continue;
    const dueAt = midpointDueAt(batch, new Date(first.paidAt).getTime());
    if (!dueAt) continue;
    const res = await Order.updateOne(
      { orderId: order.orderId, instalments: { $elemMatch: { seq: 2, status: { $ne: "paid" } } } },
      { $set: { "instalments.$.dueAt": dueAt } },
    );
    changed += res.modifiedCount || 0;
  }
  return changed;
}

// Returns a payment link for the balance, creating one when there is none or it has expired.
export async function ensureSecondInstalmentLink(orderId, { razorpay = getRazorpay(), now = new Date() } = {}) {
  const order = await Order.findOne({ orderId }).lean();
  const second = secondInstalment(order);
  if (!second || second.status === "paid") return { error: "No balance is due on this order" };
  if (second.paymentLinkUrl && second.paymentLinkExpiresAt && new Date(second.paymentLinkExpiresAt) > new Date(now.getTime() + DAY_MS)) {
    return { url: second.paymentLinkUrl, amountMinor: second.amountMinor, currency: order.currency };
  }
  const expiresAt = new Date(now.getTime() + LINK_LIFETIME_DAYS * DAY_MS);
  const link = await razorpay.paymentLink.create({
    amount: second.amountMinor,
    currency: String(order.currency).toUpperCase(),
    accept_partial: false,
    reference_id: `${order.orderId}-2-${Math.floor(now.getTime() / 1000)}`,
    description: `Second instalment: ${order.courseInfo?.title || order.courseId}`,
    customer: { name: order.learner?.fullName || undefined, email: order.learner?.email || undefined, contact: order.learner?.phone || undefined },
    notify: { sms: false, email: false },
    reminder_enable: false,
    expire_by: Math.floor(expiresAt.getTime() / 1000),
    callback_url: `${frontendUrl()}/dashboard`,
    callback_method: "get",
    notes: { orderId: order.orderId, instalment: "2" },
  });
  await Order.updateOne(
    { orderId, "instalments.seq": 2 },
    { $set: { "instalments.$.paymentLinkId": link.id, "instalments.$.paymentLinkUrl": link.short_url, "instalments.$.paymentLinkExpiresAt": expiresAt } },
  );
  return { url: link.short_url, amountMinor: second.amountMinor, currency: order.currency };
}

const notify = async (order, kind, link) => {
  if (!order.learner?.email) return;
  const second = secondInstalment(order);
  const result = await sendEmail({
    from: fromAddresses.sales,
    to: order.learner.email,
    subject: { reminder: "Your second instalment is coming up", due: "Your second instalment is due", hold: "Your classroom access is on hold", paid: "Your balance is paid, thank you" }[kind],
    html: generateInstalmentEmail({
      kind, name: order.learner.fullName, courseTitle: order.courseInfo?.title, amountMajor: money(second.amountMinor),
      currency: order.currency, dueDate: second.dueAt ? prettyDate(second.dueAt) : "", link,
    }),
  });
  if (result?.error) throw new Error(result.error.message || "send failed");
};

// Marks the balance paid. Safe to call more than once for the same payment (webhook retries).
export async function markInstalmentPaid({ orderId, paymentId, amountMinor, paidAtMs = Date.now() }) {
  const order = await Order.findOne({ orderId }).lean();
  const second = secondInstalment(order);
  if (!second) return { updated: false, reason: "no-instalment" };
  if (second.status === "paid") return { updated: false, reason: "already-paid" };
  if (Number(amountMinor) !== second.amountMinor) {
    console.error(`[instalments] ${orderId}: paid ${amountMinor} but the balance is ${second.amountMinor}; not marked paid`);
    return { updated: false, reason: "amount-mismatch" };
  }
  const claim = await Order.updateOne(
    { orderId, instalments: { $elemMatch: { seq: 2, status: { $ne: "paid" } } } },
    { $set: {
      "instalments.$.status": "paid",
      "instalments.$.paidAt": new Date(paidAtMs),
      "instalments.$.razorpayPaymentId": paymentId,
      "instalments.$.invoiceNumber": `${order.invoiceNumber}-2`,
      status: "paid",
      amountPaidMinor: order.expectedTotalMinor,
    } },
  );
  if (!claim.modifiedCount) return { updated: false, reason: "already-paid" };
  await User.updateMany({ orderId }, { $set: { accessHold: false }, $unset: { holdSince: "" } });
  try { await notify(order, "paid"); } catch (err) { console.error(`[instalments] paid email for ${orderId} failed:`, err.message); }
  return { updated: true };
}

// Razorpay webhook: POST /razorpay/webhook (raw body). Handles payment_link.paid for the balance.
export async function handleRazorpayWebhook(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Webhook is not configured" });
  const raw = req.body;
  const signature = String(req.headers["x-razorpay-signature"] || "");
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: "Invalid signature" });

  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Invalid payload" }); }
  if (event.event !== "payment_link.paid") return res.json({ received: true, ignored: true });

  try {
    const link = event.payload?.payment_link?.entity;
    const payment = event.payload?.payment?.entity;
    const orderId = link?.notes?.orderId || String(link?.reference_id || "").replace(/-2(-\d+)?$/, "");
    if (!orderId || !payment?.id) return res.json({ received: true, ignored: true });
    const result = await markInstalmentPaid({
      orderId, paymentId: payment.id, amountMinor: payment.amount,
      paidAtMs: payment.created_at ? payment.created_at * 1000 : Date.now(),
    });
    return res.json({ received: true, ...result });
  } catch (err) {
    console.error("[instalments] webhook failed:", err.message);
    return res.status(500).json({ error: "Webhook handling failed" });
  }
}

// Daily: remind before the due date and on it, mark overdue, and after the grace period hold access.
// Each notice is claimed (remindersSent) before sending so overlapping runs cannot double-send.
export async function runInstalmentChecks(now = new Date(), { ensureLink = ensureSecondInstalmentLink, env = process.env } = {}) {
  const orders = await Order.find({
    status: "partially_paid",
    instalments: { $elemMatch: { seq: 2, status: { $ne: "paid" } } },
  }).limit(500).lean();

  const stats = { reminded: 0, due: 0, held: 0 };
  for (const order of orders) {
    const second = secondInstalment(order);
    if (!second?.dueAt) continue;
    const due = new Date(second.dueAt).getTime();
    const holdAt = due + graceDays(env) * DAY_MS;
    const t = now.getTime();

    const send = async (key, kind) => {
      if (second.remindersSent?.includes(key)) return false;
      const claim = await Order.updateOne(
        { orderId: order.orderId, instalments: { $elemMatch: { seq: 2, remindersSent: { $ne: key } } } },
        { $addToSet: { "instalments.$.remindersSent": key } },
      );
      if (!claim.modifiedCount) return false;
      try {
        const link = kind === "hold" || kind === "due" || kind === "reminder" ? (await ensureLink(order.orderId)).url : undefined;
        await notify(order, kind, link);
        return true;
      } catch (err) {
        console.error(`[instalments] ${key} notice for ${order.orderId} failed:`, err.message);
        await Order.updateOne({ orderId: order.orderId, "instalments.seq": 2 }, { $pull: { "instalments.$.remindersSent": key } });
        return false;
      }
    };

    if (t >= due && second.status !== "overdue") {
      await Order.updateOne({ orderId: order.orderId, "instalments.seq": 2 }, { $set: { "instalments.$.status": "overdue" } });
    }
    if (t >= holdAt) {
      await User.updateMany({ orderId: order.orderId, accessHold: { $ne: true } }, { $set: { accessHold: true, holdSince: now } });
      if (await send("hold", "hold")) stats.held++;
    } else if (t >= due) {
      if (await send("due", "due")) stats.due++;
    } else if (due - t <= REMIND_DAYS_BEFORE * DAY_MS) {
      if (await send("before", "reminder")) stats.reminded++;
    }
  }
  return stats;
}
