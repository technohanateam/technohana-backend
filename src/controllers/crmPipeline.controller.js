import CRMPipeline from "../models/crm/crmPipeline.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";

const DEFAULT_PIPELINES = [
  {
    name: "Corporate Training",
    type: "corporate",
    isDefault: true,
    stages: [
      { key: "lead",              label: "Lead",              order: 1,  probability: 10, color: "#6B7280" },
      { key: "discovery",         label: "Discovery",         order: 2,  probability: 20, color: "#3B82F6" },
      { key: "needs_analysis",    label: "Needs Analysis",    order: 3,  probability: 30, color: "#8B5CF6" },
      { key: "skill_gap",         label: "Skill Gap",         order: 4,  probability: 35, color: "#A78BFA" },
      { key: "course_recommended",label: "Course Recommended",order: 5,  probability: 40, color: "#7C3AED" },
      { key: "proposal_sent",     label: "Proposal Sent",     order: 6,  probability: 55, color: "#F59E0B" },
      { key: "negotiation",       label: "Negotiation",       order: 7,  probability: 65, color: "#F97316" },
      { key: "quotation_sent",    label: "Quotation Sent",    order: 8,  probability: 75, color: "#EF4444" },
      { key: "purchase_order",    label: "Purchase Order",    order: 9,  probability: 85, color: "#10B981" },
      { key: "won",               label: "Won",               order: 10, probability: 100, color: "#059669", isWon: true },
      { key: "lost",              label: "Lost",              order: 11, probability: 0,   color: "#DC2626", isLost: true },
    ],
  },
  {
    name: "Individual Training",
    type: "individual",
    stages: [
      { key: "enquiry",        label: "Enquiry",         order: 1, probability: 15, color: "#6B7280" },
      { key: "course_suggest", label: "Course Suggested", order: 2, probability: 30, color: "#8B5CF6" },
      { key: "trial",         label: "Trial / Demo",     order: 3, probability: 50, color: "#F59E0B" },
      { key: "enrolled",      label: "Enrolled",         order: 4, probability: 100, color: "#059669", isWon: true },
      { key: "lost",          label: "Lost",             order: 5, probability: 0,   color: "#DC2626", isLost: true },
    ],
  },
  {
    name: "AI/Consulting Projects",
    type: "ai_projects",
    stages: [
      { key: "prospect",    label: "Prospect",       order: 1, probability: 10, color: "#6B7280" },
      { key: "scoping",     label: "Scoping",        order: 2, probability: 25, color: "#3B82F6" },
      { key: "proposal",    label: "Proposal",       order: 3, probability: 50, color: "#8B5CF6" },
      { key: "contract",    label: "Contract",       order: 4, probability: 80, color: "#F59E0B" },
      { key: "won",         label: "Won",            order: 5, probability: 100, color: "#059669", isWon: true },
      { key: "lost",        label: "Lost",           order: 6, probability: 0,   color: "#DC2626", isLost: true },
    ],
  },
];

export const getPipelines = async (req, res) => {
  try {
    let pipelines = await CRMPipeline.find({ isActive: true }).sort({ isDefault: -1, createdAt: 1 }).lean();

    // Seed default pipelines on first call if none exist
    if (pipelines.length === 0) {
      const seeded = await CRMPipeline.insertMany(
        DEFAULT_PIPELINES.map((p) => ({ ...p, createdBy: req.admin._id }))
      );
      pipelines = seeded;
    }

    // Add deal counts per pipeline
    const ids = pipelines.map((p) => p._id);
    const dealCounts = await CRMDeal.aggregate([
      { $match: { pipeline: { $in: ids }, isDeleted: false, status: "open" } },
      { $group: { _id: "$pipeline", count: { $sum: 1 }, totalValue: { $sum: "$value" } } },
    ]);
    const dcMap = Object.fromEntries(dealCounts.map((d) => [d._id.toString(), d]));

    const enriched = pipelines.map((p) => ({
      ...p,
      openDeals: dcMap[p._id.toString()]?.count || 0,
      openValue: dcMap[p._id.toString()]?.totalValue || 0,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch pipelines" });
  }
};

export const getPipeline = async (req, res) => {
  try {
    const pipeline = await CRMPipeline.findById(req.params.id).lean();
    if (!pipeline) return res.status(404).json({ success: false, message: "Pipeline not found" });

    // Deals grouped by stage
    const dealsByStage = await CRMDeal.aggregate([
      { $match: { pipeline: pipeline._id, isDeleted: false, status: "open" } },
      {
        $group: {
          _id: "$stageKey",
          count: { $sum: 1 },
          totalValue: { $sum: "$value" },
          deals: { $push: { _id: "$_id", title: "$title", value: "$value", probability: "$probability", expectedCloseDate: "$expectedCloseDate" } },
        },
      },
    ]);

    res.json({ success: true, data: { ...pipeline, dealsByStage } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch pipeline" });
  }
};

export const createPipeline = async (req, res) => {
  try {
    const { name, stages } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Pipeline name is required" });
    if (!stages?.length) return res.status(400).json({ success: false, message: "At least one stage is required" });

    if (req.body.isDefault) {
      await CRMPipeline.updateMany({}, { isDefault: false });
    }

    const pipeline = await CRMPipeline.create({ ...req.body, createdBy: req.admin._id });
    res.status(201).json({ success: true, data: pipeline, message: "Pipeline created" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create pipeline" });
  }
};

export const updatePipeline = async (req, res) => {
  try {
    const pipeline = await CRMPipeline.findById(req.params.id);
    if (!pipeline) return res.status(404).json({ success: false, message: "Pipeline not found" });

    if (req.body.isDefault) await CRMPipeline.updateMany({ _id: { $ne: pipeline._id } }, { isDefault: false });

    const allowed = ["name", "type", "description", "isDefault", "isActive", "stages", "currency"];
    allowed.forEach((f) => { if (req.body[f] !== undefined) pipeline[f] = req.body[f]; });

    await pipeline.save();
    res.json({ success: true, data: pipeline, message: "Pipeline updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update pipeline" });
  }
};

export const deletePipeline = async (req, res) => {
  try {
    const pipeline = await CRMPipeline.findById(req.params.id);
    if (!pipeline) return res.status(404).json({ success: false, message: "Pipeline not found" });
    if (pipeline.isDefault) return res.status(400).json({ success: false, message: "Cannot delete the default pipeline" });

    const dealCount = await CRMDeal.countDocuments({ pipeline: pipeline._id, isDeleted: false });
    if (dealCount > 0) {
      return res.status(400).json({ success: false, message: `Cannot delete — ${dealCount} active deals in this pipeline. Move them first.` });
    }

    pipeline.isActive = false;
    await pipeline.save();
    res.json({ success: true, message: "Pipeline archived" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete pipeline" });
  }
};
