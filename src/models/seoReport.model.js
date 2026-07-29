import mongoose, { Schema } from "mongoose";

const seoReportSchema = new Schema({
  title: { type: String, required: true },
  type: { type: String, enum: ["weekly", "monthly", "quarterly"], required: true, index: true },
  period: String, // e.g. "2026-07"
  file: String, // relative filename under backlink-strategy/reports/ or root (dev-generated reports only)
  content: String, // generated markdown body, for reports created via generateMonthlyReport()
  date: Date,

  createdAt: { type: Date, default: Date.now },
});

const SeoReport = mongoose.model("SeoReport", seoReportSchema);
export default SeoReport;
