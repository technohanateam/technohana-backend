import mongoose from 'mongoose';

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
  status: { type: String, default: 'paid' },
  paidAt: { type: Number },
  razorpayPaymentId: { type: String },
  learner: { type: Object },
  courseInfo: { type: Object },
  utm: { type: Object },
  createdAt: { type: Date, default: Date.now },
});

export const Order = mongoose.model('Order', OrderSchema);
