import CRMPipeline from "../models/crm/crmPipeline.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import { isValidId, pick, dealOwnerFilter, sendCrmError } from "../utils/crmQuery.js";

const PIPELINE_FIELDS = ["name", "type", "description", "isDefault", "isActive", "currency"];
const notFound = (res) => res.status(404).json({ success: false, message: "Pipeline not found" });

// Returns cleaned stages, or an error message string.
const cleanStages = (stages) => {
  if (!Array.isArray(stages) || stages.length === 0) return "At least one stage is required";
  if (stages.length > 30) return "A pipeline can have at most 30 stages";
  const cleaned = stages.map((s, i) => ({
    key: typeof s?.key === "string" ? s.key.trim() : "",
    label: typeof s?.label === "string" ? s.label.trim() : "",
    order: Number.isFinite(Number(s?.order)) ? Number(s.order) : i,
    probability: Math.min(100, Math.max(0, Number(s?.probability) || 0)),
    color: typeof s?.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#8B5CF6",
    isWon: !!s?.isWon,
    isLost: !!s?.isLost && !s?.isWon,
  }));
  if (cleaned.some((s) => !s.key || !s.label)) return "Every stage needs a key and a label";
  if (new Set(cleaned.map((s) => s.key)).size !== cleaned.length) return "Stage keys must be unique";
  return cleaned;
};

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

// Called once at server start. Upserting on `type` with $setOnInsert never
// touches pipelines that already exist, so it is safe on every boot.
export async function ensureDefaultPipelines() {
  if (await CRMPipeline.exists({})) return;
  await Promise.all(DEFAULT_PIPELINES.map((p) =>
    CRMPipeline.updateOne({ type: p.type }, { $setOnInsert: p }, { upsert: true })
  ));
}

export const getPipelines = async (req, res) => {
  try {
    const pipelines = await CRMPipeline.find({ isActive: true }).sort({ isDefault: -1, createdAt: 1 }).lean();

    // Open deal counts/value per pipeline — a rep's numbers cover only their deals.
    const ids = pipelines.map((p) => p._id);
    const dealCounts = await CRMDeal.aggregate([
      { $match: { pipeline: { $in: ids }, isDeleted: false, status: "open", ...(await dealOwnerFilter(req)) } },
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
    sendCrmError(res, err, "Failed to fetch pipelines");
  }
};

export const getPipeline = async (req, res) => {
  try {
    const pipeline = isValidId(req.params.id) && await CRMPipeline.findById(req.params.id).lean();
    if (!pipeline) return notFound(res);

    // Deals grouped by stage (at most 50 listed per stage; count/value cover all)
    const dealsByStage = await CRMDeal.aggregate([
      { $match: { pipeline: pipeline._id, isDeleted: false, status: "open", ...(await dealOwnerFilter(req)) } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$stageKey",
          count: { $sum: 1 },
          totalValue: { $sum: "$value" },
          deals: { $push: { _id: "$_id", title: "$title", value: "$value", probability: "$probability", expectedCloseDate: "$expectedCloseDate" } },
        },
      },
      { $project: { count: 1, totalValue: 1, deals: { $slice: ["$deals", 50] } } },
    ]);

    res.json({ success: true, data: { ...pipeline, dealsByStage } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch pipeline");
  }
};

export const createPipeline = async (req, res) => {
  try {
    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ success: false, message: "Pipeline name is required" });
    const stages = cleanStages(req.body.stages);
    if (typeof stages === "string") return res.status(400).json({ success: false, message: stages });

    if (req.body.isDefault) {
      await CRMPipeline.updateMany({}, { isDefault: false });
    }

    const fields = pick(req.body, PIPELINE_FIELDS);
    const pipeline = await CRMPipeline.create({ ...fields, name: name.trim(), stages, createdBy: req.admin._id });
    res.status(201).json({ success: true, data: pipeline, message: "Pipeline created" });
  } catch (err) {
    sendCrmError(res, err, "Failed to create pipeline");
  }
};

export const updatePipeline = async (req, res) => {
  try {
    const pipeline = isValidId(req.params.id) && await CRMPipeline.findById(req.params.id);
    if (!pipeline) return notFound(res);

    const stages = req.body.stages === undefined ? undefined : cleanStages(req.body.stages);
    if (typeof stages === "string") return res.status(400).json({ success: false, message: stages });

    // Removing a stage that still holds deals would orphan them (they'd vanish from every board).
    if (stages) {
      const nextKeys = new Set(stages.map((s) => s.key));
      const removed = pipeline.stages.map((s) => s.key).filter((k) => !nextKeys.has(k));
      if (removed.length) {
        const stuck = await CRMDeal.aggregate([
          { $match: { pipeline: pipeline._id, stageKey: { $in: removed }, isDeleted: false } },
          { $group: { _id: "$stageKey", count: { $sum: 1 } } },
        ]);
        if (stuck.length) {
          const detail = stuck.map((s) => `${s.count} in "${s._id}"`).join(", ");
          return res.status(400).json({ success: false, message: `Move these deals out before removing their stages: ${detail}` });
        }
      }
    }

    if (req.body.isDefault) await CRMPipeline.updateMany({ _id: { $ne: pipeline._id } }, { isDefault: false });

    Object.assign(pipeline, pick(req.body, PIPELINE_FIELDS));
    if (stages) pipeline.stages = stages;

    await pipeline.save();
    res.json({ success: true, data: pipeline, message: "Pipeline updated" });
  } catch (err) {
    sendCrmError(res, err, "Failed to update pipeline");
  }
};

export const deletePipeline = async (req, res) => {
  try {
    const pipeline = isValidId(req.params.id) && await CRMPipeline.findById(req.params.id);
    if (!pipeline) return notFound(res);
    if (pipeline.isDefault) return res.status(400).json({ success: false, message: "Cannot delete the default pipeline" });

    const dealCount = await CRMDeal.countDocuments({ pipeline: pipeline._id, isDeleted: false });
    if (dealCount > 0) {
      return res.status(400).json({ success: false, message: `Cannot delete — ${dealCount} active deals in this pipeline. Move them first.` });
    }

    pipeline.isActive = false;
    await pipeline.save();
    res.json({ success: true, message: "Pipeline archived" });
  } catch (err) {
    sendCrmError(res, err, "Failed to delete pipeline");
  }
};
