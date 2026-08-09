import ContentOpportunity from "../../models/contentOpportunity.model.js";
import ContentRun from "../../models/contentRun.model.js";
import { generateOpportunityCandidates } from "../../services/contentFactory/contentStrategy.service.js";

export const listOpportunities = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);
    const { status, courseSlug, clusterId, contentType, minScore } = req.query;

    const query = {};
    if (status) query.status = status;
    if (courseSlug) query.courseSlug = courseSlug;
    if (clusterId) query.clusterId = clusterId;
    if (contentType) query.contentType = contentType;
    if (minScore) query.overallScore = { $gte: Number(minScore) };

    const [rows, total] = await Promise.all([
      ContentOpportunity.find(query)
        .sort({ overallScore: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ContentOpportunity.countDocuments(query),
    ]);

    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (err) {
    console.error("[ContentFactory] listOpportunities error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getOpportunity = async (req, res) => {
  try {
    const opportunity = await ContentOpportunity.findById(req.params.id).lean();
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    return res.json({ success: true, data: opportunity });
  } catch (err) {
    console.error("[ContentFactory] getOpportunity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/content-factory/plan/dry-run — the safe default entry point.
// Runs the full strategy pipeline through opportunity creation. Zero article
// generation, zero Blogs writes (Milestone 1 has no generation step at all —
// generateOpportunityCandidates() only ever writes ContentOpportunity/ContentRun).
export const runDryRunPlan = async (req, res) => {
  try {
    const { run, opportunities } = await generateOpportunityCandidates({ dryRun: true, triggeredBy: "MANUAL" });
    return res.json({ success: true, data: { run, opportunities }, message: "Dry-run plan complete" });
  } catch (err) {
    console.error("[ContentFactory] runDryRunPlan error:", err);
    return res.status(500).json({ success: false, message: "Dry-run plan failed" });
  }
};

export const listRuns = async (req, res) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 25);
    const runs = await ContentRun.find().sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ success: true, data: runs });
  } catch (err) {
    console.error("[ContentFactory] listRuns error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const rejectOpportunity = async (req, res) => {
  try {
    const { rejectionReason } = req.body || {};
    const opportunity = await ContentOpportunity.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: "REJECTED",
          rejectionReason: rejectionReason || null,
          reviewedBy: req.admin?.name || req.admin?.email || req.admin?.uid || null,
          reviewedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    return res.json({ success: true, data: opportunity, message: "Opportunity rejected" });
  } catch (err) {
    console.error("[ContentFactory] rejectOpportunity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const overrideScore = async (req, res) => {
  try {
    const { overallScore } = req.body || {};
    if (!Number.isFinite(Number(overallScore)) || overallScore < 0 || overallScore > 100) {
      return res.status(400).json({ success: false, message: "overallScore must be a number 0-100" });
    }
    const opportunity = await ContentOpportunity.findByIdAndUpdate(req.params.id, { $set: { overallScore: Number(overallScore) } }, { new: true });
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    return res.json({ success: true, data: opportunity, message: "Score overridden" });
  } catch (err) {
    console.error("[ContentFactory] overrideScore error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
