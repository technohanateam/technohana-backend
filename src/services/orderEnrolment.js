// Enrols the learner of a paid order. Shared by the Razorpay verify, the cart verify and the order.paid
// webhook, so an order that was marked paid but never enrolled (an earlier attempt died between the two)
// is finished by the next confirmation instead of staying "pending payment" for good.
import { User } from "../models/user.model.js";
import { tryEncryptToken } from "../utils/tokenCrypto.js";

// Safe to repeat: it only rewrites the same fields. Never throws, because the payment is already taken.
export async function enrolPaidOrder(order, { paymentPlan } = {}) {
  const orderId = order.orderId;
  const enrollmentToken = tryEncryptToken({ orderId, email: order.learner?.email, timestamp: Date.now() });
  const price = Number.isFinite(Number(order.expectedTotalMinor)) ? (Number(order.expectedTotalMinor) / 100).toFixed(2) : "";
  const fields = { status: "enrolled", price, enrolledAt: new Date(), ...(enrollmentToken && { enrollmentToken }), ...(paymentPlan && { paymentPlan }) };
  try {
    const updated = await User.findOneAndUpdate({ orderId }, fields, { new: true });
    if (!updated) {
      await User.create({
        name: order.learner?.fullName,
        email: order.learner?.email,
        phone: order.learner?.phone,
        courseTitle: order.courseInfo?.title,
        trainingLocation: order.learner?.trainingLocation,
        trainingType: order.enrollmentType,
        currency: order.currency?.toUpperCase(),
        orderId,
        ...fields,
      });
    }
    return true;
  } catch (err) {
    console.error(`Failed to enrol the learner for paid order ${orderId}:`, err);
    return false;
  }
}

// An already-paid order whose learner is not enrolled yet: finish the enrolment. Returns true when it did.
export async function healUnenrolledPaidOrder(order, options) {
  if (await User.exists({ orderId: order.orderId, status: "enrolled" })) return false;
  console.warn(`[enrolment] order ${order.orderId} is paid but the learner is not enrolled; finishing the enrolment`);
  return enrolPaidOrder(order, options);
}
