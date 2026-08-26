import Course from "../../models/course.model.js";
import AdCreativeOpportunity, { CAMPAIGN_OBJECTIVES, PLATFORMS } from "../../models/adCreativeFactory/adCreativeOpportunity.model.js";

// GET /admin/ad-creative-factory/opportunities
export const listOpportunities = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.courseSlug) query.courseSlug = req.query.courseSlug;
    if (req.query.platform) query.platform = req.query.platform;

    const [rows, total] = await Promise.all([
      AdCreativeOpportunity.find(query).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AdCreativeOpportunity.countDocuments(query),
    ]);

    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (err) {
    console.error("[AdCreativeFactory] listOpportunities error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /admin/ad-creative-factory/opportunities/:id
export const getOpportunity = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findById(req.params.id).lean();
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    return res.json({ success: true, data: opportunity });
  } catch (err) {
    console.error("[AdCreativeFactory] getOpportunity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /admin/ad-creative-factory/opportunities — admin-initiated: pick a
// course + objective + platform. No automated discovery stage — ad creative
// is always deliberately requested, unlike Content Factory's trend-sourced
// opportunities.
export const createOpportunity = async (req, res) => {
  try {
    const { courseSlug, campaignObjective, platform, targetAudience, angle } = req.body || {};

    if (!courseSlug) return res.status(400).json({ success: false, message: "courseSlug is required" });
    if (!CAMPAIGN_OBJECTIVES.includes(campaignObjective)) {
      return res.status(400).json({ success: false, message: `campaignObjective must be one of ${CAMPAIGN_OBJECTIVES.join(", ")}` });
    }
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: `platform must be one of ${PLATFORMS.join(", ")}` });
    }

    const course = await Course.findOne({ courseSlug }).lean();
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const opportunity = await AdCreativeOpportunity.create({
      courseId: course.id || null,
      courseSlug: course.courseSlug,
      courseTitle: course.courseTitle,
      campaignObjective,
      platform,
      targetAudience: targetAudience || null,
      angle: angle || null,
      status: "SELECTED",
    });

    return res.json({ success: true, data: opportunity, message: "Opportunity created" });
  } catch (err) {
    console.error("[AdCreativeFactory] createOpportunity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PATCH /admin/ad-creative-factory/opportunities/:id/reject
export const rejectOpportunity = async (req, res) => {
  try {
    const opportunity = await AdCreativeOpportunity.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: "REJECTED",
          rejectionReason: req.body?.rejectionReason || null,
          reviewedBy: req.admin?.name || req.admin?.email || req.admin?.uid || null,
          reviewedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!opportunity) return res.status(404).json({ success: false, message: "Opportunity not found" });
    return res.json({ success: true, data: opportunity, message: "Opportunity rejected" });
  } catch (err) {
    console.error("[AdCreativeFactory] rejectOpportunity error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
