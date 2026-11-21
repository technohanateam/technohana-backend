import mongoose from 'mongoose';

const InstalmentSchema = new mongoose.Schema({
  seq: { type: Number, required: true },
  amountMinor: { type: Number, required: true },
  dueAt: { type: Date },
  status: { type: String, enum: ['paid', 'due', 'overdue'], default: 'due' },
  paidAt: { type: Date },
  razorpayPaymentId: { type: String },
  paymentLinkId: { type: String },
  paymentLinkUrl: { type: String },
  paymentLinkExpiresAt: { type: Date },
  invoiceNumber: { type: String },
  // Which reminder emails have gone out ("before", "due", "hold"), so each is sent once.
  remindersSent: { type: [String], default: [] },
  // Manual changes an admin made to this instalment (marked paid by hand, due date extended).
  adminLog: { type: [new mongoose.Schema({
    action: { type: String },
    by: { type: String },
    note: { type: String },
    at: { type: Date },
  }, { _id: false })], default: undefined },
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true, index: true },
  invoiceNumber: { type: String, required: true, unique: true },
  provider: { type: String, enum: ['stripe', 'razorpay'] },
  courseId: { type: String },
  enrollmentType: { type: String },
  participants: { type: Number },
  currency: { type: String },
  basePriceMinor: { type: Number },
  unitAmountMinor: { type: Number },
  quantity: { type: Number },
  expectedTotalMinor: { type: Number },
  enrollmentDiscountPercent: { type: Number },
  couponApplied: { type: Boolean },
  couponCode: { type: String },
  couponDiscountPercent: { type: Number },
  referralCode: { type: String },
  referralDiscountPercent: { type: Number },
  totalDiscountPercent: { type: Number },
  // "paid" or, for a two-instalment plan with a balance outstanding, "partially_paid".
  status: { type: String, default: 'paid' },
  // Interest-free two-instalment plan. expectedTotalMinor stays the full price; amountPaidMinor is
  // what has actually been collected (unset on ordinary orders, which are paid in full).
  paymentPlan: { type: String, enum: ['full', 'two_instalment'], default: 'full' },
  amountPaidMinor: { type: Number },
  instalments: { type: [InstalmentSchema], default: undefined },
  businessUnit: { type: String, enum: ['b2c', 'b2b', 'ai'], default: 'b2c' },
  paidAt: { type: Number },
  razorpayPaymentId: { type: String },
  learner: { type: Object },
  courseInfo: { type: Object },
  utm: { type: Object },
  createdAt: { type: Date, default: Date.now },
});

export const Order = mongoose.model('Order', OrderSchema);
