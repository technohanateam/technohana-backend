import mongoose from "mongoose";

export const KPI_METRICS = [
  "revenue_collected", "revenue_booked", "revenue_combined",
  "leads_created", "leads_qualified", "deals_won", "enrolments", "conversion_rate",
];

// Planning targets only. Actuals are never stored here; they are computed from live records.
const kpiTargetSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    metric: { type: String, enum: KPI_METRICS, required: true },
    businessUnit: { type: String, enum: ["b2c", "b2b", "ai"], default: null },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    // Money targets are integers in minor units (paise/cents). Counts and percents are plain numbers.
    target: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ["money", "count", "percent"], required: true },
    currency: { type: String, default: "INR" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" },
    notes: { type: String, trim: true, maxlength: 500 },
    isPlan: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "CrmUser" },
  },
  { timestamps: true }
);

kpiTargetSchema.index({ period: 1, businessUnit: 1, metric: 1 }, { unique: true });

export default mongoose.model("KpiTarget", kpiTargetSchema);
