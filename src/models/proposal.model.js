import mongoose from 'mongoose';

const { Schema } = mongoose;

const proposalSchema = new Schema({
  refNum: { type: String, required: true, unique: true, trim: true },
  client: {
    name:    { type: String, trim: true },
    company: { type: String, trim: true },
    email:   { type: String, trim: true },
    phone:   { type: String, trim: true },
  },
  validUntil: { type: Date, default: null },
  notes: { type: String, trim: true },
  courses: [{
    courseId:              { type: String, required: true },
    courseTitle:           { type: String },
    seats:                 { type: Number, required: true, min: 1 },
    currency:              { type: String, required: true },
    manualDiscountPercent: { type: Number, default: 0, min: 0, max: 25 },
    quote:                 { type: Object },
  }],
  totals: {
    grandTotalMinor:    { type: Number },
    originalTotalMinor: { type: Number },
    currency:           { type: String },
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'accepted', 'expired'],
    default: 'draft',
  },
  createdBy:               { type: String },
  manualDiscountAppliedBy: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('Proposal', proposalSchema);
