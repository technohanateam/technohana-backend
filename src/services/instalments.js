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
import { logCrmBalancePaidSafely, syncCrmOnPaymentLinkPaid } from "./crmOrderSync.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_DAYS_BEFORE = 5;
const LINK_LIFETIME_DAYS = 60;
const CRM_LINK_LIFETIME_DAYS = 7;
const QR_LIFETIME_DAYS = 7;

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

// A UPI QR for the balance, for a learner who would rather scan than open a link. Single-use, fixed amount,
// reused until it is close to expiring. Paid QRs reach us as qr_code.credited (see handleRazorpayWebhook).
export async function ensureSecondInstalmentQr(orderId, { razorpay = getRazorpay(), now = new Date() } = {}) {
  const order = await Order.findOne({ orderId }).lean();
  const second = secondInstalment(order);
  if (!second || second.status === "paid") return { error: "No balance is due on this order" };
  if (second.qrImageUrl && second.qrExpiresAt && new Date(second.qrExpiresAt) > new Date(now.getTime() + DAY_MS)) {
    return { imageUrl: second.qrImageUrl, amountMinor: second.amountMinor, currency: order.currency, expiresAt: second.qrExpiresAt };
  }
  const expiresAt = new Date(now.getTime() + QR_LIFETIME_DAYS * DAY_MS);
  const qr = await razorpay.qrCode.create({
    type: "upi_qr",
    name: `Balance ${order.orderId}`.slice(0, 40),
    usage: "single_use",
    fixed_amount: true,
    payment_amount: second.amountMinor,
    description: `Second instalment: ${order.courseInfo?.title || order.courseId}`.slice(0, 250),
    close_by: Math.floor(expiresAt.getTime() / 1000),
    notes: { orderId: order.orderId, instalment: "2" },
  });
  await Order.updateOne(
    { orderId, "instalments.seq": 2 },
    { $set: { "instalments.$.qrCodeId": qr.id, "instalments.$.qrImageUrl": qr.image_url, "instalments.$.qrExpiresAt": expiresAt } },
  );
  return { imageUrl: qr.image_url, amountMinor: second.amountMinor, currency: order.currency, expiresAt };
}

// A payment link a CRM rep sends to a lead or contact (not tied to an order). The paid event comes back through
// handleRazorpayWebhook, carrying the CRM id in notes.
export async function createCrmPaymentLink({ recordType, recordId, name, phone, email, amountMinor, description }, { razorpay = getRazorpay(), now = new Date() } = {}) {
  const expiresAt = new Date(now.getTime() + CRM_LINK_LIFETIME_DAYS * DAY_MS);
  const link = await razorpay.paymentLink.create({
    amount: amountMinor,
    currency: "INR",
    accept_partial: false,
    reference_id: `crm-${recordId}-${Math.floor(now.getTime() / 1000)}`,
    description,
    customer: { name: name || undefined, email: email || undefined, contact: phone || undefined },
    notify: { sms: false, email: false },
    reminder_enable: false,
    expire_by: Math.floor(expiresAt.getTime() / 1000),
    callback_url: `${frontendUrl()}/dashboard`,
    callback_method: "get",
    notes: { [recordType === "lead" ? "crmLeadId" : "crmContactId"]: String(recordId) },
  });
  return { url: link.short_url, id: link.id, expiresAt };
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
// markedBy/note are set only when an admin does it by hand, and are kept on the instalment as an audit trail.
export async function markInstalmentPaid({ orderId, paymentId, amountMinor, paidAtMs = Date.now(), markedBy, note }) {
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
    },
    ...(markedBy && { $push: { "instalments.$.adminLog": { action: "mark_paid", by: markedBy, note: note || "", at: new Date() } } }) },
  );
  if (!claim.modifiedCount) return { updated: false, reason: "already-paid" };
  await User.updateMany({ orderId }, { $set: { accessHold: false }, $unset: { holdSince: "" } });
  logCrmBalancePaidSafely(order, { paymentId, amountMinor });
  try { await notify(order, "paid"); } catch (err) { console.error(`[instalments] paid email for ${orderId} failed:`, err.message); }
  return { updated: true };
}

// ── Admin: balances still owed ───────────────────────────────────────────────
const OPEN_BALANCE = { status: "partially_paid", instalments: { $elemMatch: { seq: 2, status: { $ne: "paid" } } } };
const SOON_MS = 7 * DAY_MS;
const STATE_ORDER = { on_hold: 0, overdue: 1, due_soon: 2, upcoming: 3, paid: 4 };

// Rows for the admin "Instalment balances" page. view "open" = balances still owed; "paid" = settled in the last 30 days.
export async function listInstalmentBalances({ view = "open", now = new Date(), env = process.env } = {}) {
  const query = view === "paid"
    ? { paymentPlan: "two_instalment", status: "paid", instalments: { $elemMatch: { seq: 2, status: "paid", paidAt: { $gte: new Date(now.getTime() - 30 * DAY_MS) } } } }
    : OPEN_BALANCE;
  const orders = await Order.find(query).limit(500).lean();
  const users = orders.length
    ? await User.find({ orderId: { $in: orders.map((o) => o.orderId) } }).select("orderId accessHold holdSince").lean()
    : [];
  const byOrder = new Map(users.map((u) => [u.orderId, u]));
  const grace = graceDays(env);

  const rows = orders.map((o) => {
    const second = secondInstalment(o);
    const user = byOrder.get(o.orderId);
    const due = second.dueAt ? new Date(second.dueAt).getTime() : null;
    let state = "upcoming";
    if (second.status === "paid") state = "paid";
    else if (user?.accessHold) state = "on_hold";
    else if (due !== null && now.getTime() >= due) state = "overdue";
    else if (due !== null && due - now.getTime() <= SOON_MS) state = "due_soon";
    return {
      orderId: o.orderId,
      learner: { fullName: o.learner?.fullName || "", email: o.learner?.email || "", phone: o.learner?.phone || "" },
      courseTitle: o.courseInfo?.title || o.courseId || "",
      currency: String(o.currency || "INR").toUpperCase(),
      totalMinor: o.expectedTotalMinor,
      paidMinor: o.amountPaidMinor ?? 0,
      balanceMinor: second.amountMinor,
      dueAt: second.dueAt || null,
      graceEndsAt: due !== null ? new Date(due + grace * DAY_MS) : null,
      state,
      accessHold: !!user?.accessHold,
      holdSince: user?.holdSince || null,
      paymentLinkUrl: second.paymentLinkUrl || null,
      paidAt: second.paidAt || null,
      paidManually: String(second.razorpayPaymentId || "").startsWith("manual:"),
      invoiceNumber: second.invoiceNumber || null,
    };
  }).sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state])
    || (a.state === "paid" ? new Date(b.paidAt) - new Date(a.paidAt) : new Date(a.dueAt || 0) - new Date(b.dueAt || 0)));

  const outstanding = new Map();
  const counts = { on_hold: 0, overdue: 0, due_soon: 0, upcoming: 0, paid: 0 };
  for (const r of rows) {
    counts[r.state] += 1;
    if (r.state === "paid") continue;
    const o = outstanding.get(r.currency) || { currency: r.currency, amountMinor: 0, count: 0 };
    o.amountMinor += r.balanceMinor; o.count += 1;
    outstanding.set(r.currency, o);
  }
  return { rows, summary: { counts, outstanding: [...outstanding.values()] } };
}

// An admin records a balance that was paid outside the website (bank transfer, cash, a link that never reported back).
export async function markInstalmentPaidManually({ orderId, reference, note, by }) {
  const ref = String(reference || "").trim().slice(0, 100);
  if (!ref) return { error: "Enter the payment reference (UTR, receipt or transaction id)", status: 400 };
  const order = await Order.findOne({ orderId }).lean();
  const second = secondInstalment(order);
  if (!second) return { error: "This order has no instalment balance", status: 404 };
  const result = await markInstalmentPaid({
    orderId, paymentId: `manual:${ref}`, amountMinor: second.amountMinor, markedBy: by || "admin", note: String(note || "").slice(0, 300),
  });
  if (!result.updated) return { error: result.reason === "already-paid" ? "This balance is already paid" : "Could not mark the balance paid", status: 409 };
  return { updated: true };
}

// Gives a learner more time: new due date, notices reset, and any access hold lifted (no fee, ever).
export async function extendInstalmentDue({ orderId, dueAt, by, note }, now = new Date()) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return { error: "Enter a valid date", status: 400 };
  if (due.getTime() <= now.getTime()) return { error: "The new due date must be in the future", status: 400 };
  if (due.getTime() - now.getTime() > 120 * DAY_MS) return { error: "The new due date can be at most 120 days away", status: 400 };
  const order = await Order.findOne({ orderId }).lean();
  const second = secondInstalment(order);
  if (!second) return { error: "This order has no instalment balance", status: 404 };
  if (second.status === "paid") return { error: "This balance is already paid", status: 409 };
  const res = await Order.updateOne(
    { orderId, instalments: { $elemMatch: { seq: 2, status: { $ne: "paid" } } } },
    {
      $set: { "instalments.$.dueAt": due, "instalments.$.status": "due", "instalments.$.remindersSent": [] },
      $push: { "instalments.$.adminLog": { action: "extend_due", by: by || "admin", note: String(note || "").slice(0, 300), at: new Date() } },
    },
  );
  if (!res.modifiedCount) return { error: "This balance was paid just now", status: 409 };
  await User.updateMany({ orderId }, { $set: { accessHold: false }, $unset: { holdSince: "" } });
  return { updated: true, dueAt: due };
}

// Razorpay gives Test and Live webhooks different secrets. The live one is RAZORPAY_WEBHOOK_SECRET; set
// RAZORPAY_WEBHOOK_SECRET_TEST as well to accept events from a Test-mode webhook pointed at the same URL.
export const webhookSecrets = (env = process.env) =>
  [env.RAZORPAY_WEBHOOK_SECRET, env.RAZORPAY_WEBHOOK_SECRET_TEST].filter(Boolean);

// Every secret is checked (no early exit), each with a constant-time compare.
export function webhookSignatureValid(raw, signature, secrets) {
  const given = Buffer.from(String(signature), "utf8");
  return secrets
    .map((secret) => {
      const expected = Buffer.from(crypto.createHmac("sha256", secret).update(raw).digest("hex"), "utf8");
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    })
    .some(Boolean);
}

// Razorpay webhook: POST /razorpay/webhook (raw body). payment_link.paid settles the balance; order.paid settles a
// checkout whose browser never came back to verify (settleOrder is supplied by index.js, which owns the checkout models).
export async function handleRazorpayWebhook(req, res, { settleOrder } = {}) {
  const secrets = webhookSecrets();
  if (!secrets.length) return res.status(503).json({ error: "Webhook is not configured" });
  const raw = req.body;
  const signature = String(req.headers["x-razorpay-signature"] || "");
  if (!webhookSignatureValid(raw, signature, secrets)) return res.status(400).json({ error: "Invalid signature" });

  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "Invalid payload" }); }
  if (event.event === "order.paid") {
    const payment = event.payload?.payment?.entity;
    if (!settleOrder || !payment?.id || !payment?.order_id) return res.json({ received: true, ignored: true });
    try {
      const result = await settleOrder({ razorpayOrderId: payment.order_id, paymentId: payment.id, amountMinor: payment.amount });
      return res.json({ received: true, ...result });
    } catch (err) {
      console.error("[razorpay-webhook] order.paid failed:", err.message);
      return res.status(500).json({ error: "Webhook handling failed" });
    }
  }
  if (!["payment_link.paid", "qr_code.credited"].includes(event.event)) return res.json({ received: true, ignored: true });

  try {
    const link = event.payload?.payment_link?.entity;
    const qr = event.payload?.qr_code?.entity;
    const payment = event.payload?.payment?.entity;
    if (!payment?.id) return res.json({ received: true, ignored: true });

    const crmLeadId = link?.notes?.crmLeadId;
    const crmContactId = link?.notes?.crmContactId;
    if (crmLeadId || crmContactId) {
      await syncCrmOnPaymentLinkPaid({ crmLeadId, crmContactId, paymentId: payment.id, amountMinor: payment.amount, currency: payment.currency, description: link.description });
      return res.json({ received: true, crm: true });
    }

    const orderId = event.event === "qr_code.credited"
      ? qr?.notes?.orderId
      : link?.notes?.orderId || String(link?.reference_id || "").replace(/-2(-\d+)?$/, "");
    if (!orderId) return res.json({ received: true, ignored: true });
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
export async function runInstalmentChecks(now = new Date(), { ensureLink = ensureSecondInstalmentLink, env = process.env, orderId } = {}) {
  const orders = await Order.find({
    ...(orderId && { orderId }), // optional: check a single order (used by the manual test script)
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
