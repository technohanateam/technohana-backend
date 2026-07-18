import mongoose from "mongoose";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMPipeline from "../models/crm/crmPipeline.model.js";

const logActivity = async (dealId, type, title, body, performedBy, metadata = {}) => {
  try {
    await CRMActivity.create({ type, title, body, metadata, relatedToType: "deal", relatedToId: dealId, performedBy });
  } catch (e) { console.error("Activity log failed:", e.message); }
};

export const getDeals = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip  = (page - 1) * limit;

    const { pipeline, status, assignedTo, company } = req.query;
    const filter = { isDeleted: false };
    if (pipeline)   filter.pipeline   = new mongoose.Types.ObjectId(pipeline);
    if (status)     filter.status     = status;
    if (assignedTo) filter.assignedTo = new mongoose.Types.ObjectId(assignedTo);
    if (company)    filter.company    = new mongoose.Types.ObjectId(company);

    const [deals, total] = await Promise.all([
      CRMDeal.find(filter)
        .sort({ stageOrder: 1, createdAt: -1 })
        .skip(skip).limit(limit)
        .populate("pipeline", "name type stages")
        .populate("lead", "name email phone")
        .populate("contact", "firstName lastName email")
        .populate("company", "name")
        .populate("assignedTo", "name email")
        .lean(),
      CRMDeal.countDocuments(filter),
    ]);

    res.json({ success: true, data: deals, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch deals" });
  }
};

export const getDeal = async (req, res) => {
  try {
    const deal = await CRMDeal.findOne({ _id: req.params.id, isDeleted: false })
      .populate("pipeline", "name type stages")
      .populate("lead", "name email phone company status")
      .populate("contact", "firstName lastName email phone")
      .populate("company", "name industry website")
      .populate("assignedTo", "name email")
      .populate("tags", "name color")
      .lean();
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });

    const activities = await CRMActivity.find({ relatedToType: "deal", relatedToId: deal._id })
      .sort({ createdAt: -1 }).limit(30).populate("performedBy", "name").lean();

    res.json({ success: true, data: { ...deal, activities } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch deal" });
  }
};

export const createDeal = async (req, res) => {
  try {
    const { title, pipeline } = req.body;
    if (!title)    return res.status(400).json({ success: false, message: "Deal title is required" });
    if (!pipeline) return res.status(400).json({ success: false, message: "Pipeline is required" });

    // Validate pipeline and default stage
    const pipe = await CRMPipeline.findById(pipeline);
    if (!pipe) return res.status(400).json({ success: false, message: "Invalid pipeline" });

    const firstStage = pipe.stages.sort((a, b) => a.order - b.order)[0];

    const deal = await CRMDeal.create({
      ...req.body,
      stageKey: req.body.stageKey || firstStage?.key,
      stageOrder: req.body.stageOrder ?? firstStage?.order ?? 0,
      probability: req.body.probability ?? firstStage?.probability ?? 20,
      assignedTo: req.body.assignedTo || req.admin._id,
      createdBy: req.admin._id,
    });

    await logActivity(deal._id, "created", "Deal created", `${title} added to pipeline`, req.admin._id);

    res.status(201).json({ success: true, data: deal, message: "Deal created" });
  } catch (err) {
    console.error("createDeal error:", err);
    res.status(500).json({ success: false, message: "Failed to create deal" });
  }
};

export const updateDeal = async (req, res) => {
  try {
    const deal = await CRMDeal.findOne({ _id: req.params.id, isDeleted: false });
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });

    const prevStatus = deal.status;
    const allowed = ["title", "value", "currency", "status", "lostReason", "stageKey", "stageOrder",
      "probability", "expectedCloseDate", "lead", "contact", "company", "assignedTo",
      "proposalId", "quotationRef", "purchaseOrderRef", "purchaseOrderUrl", "invoiceRef",
      "tags", "notes", "attachments"];
    allowed.forEach((f) => { if (req.body[f] !== undefined) deal[f] = req.body[f]; });

    if (req.body.status === "won" && prevStatus !== "won") {
      deal.wonAt = new Date();
      await logActivity(deal._id, "deal_won", "Deal won", `${deal.title} marked as won!`, req.admin._id);
    }
    if (req.body.status === "lost" && prevStatus !== "lost") {
      deal.lostAt = new Date();
      await logActivity(deal._id, "deal_lost", "Deal lost", `${deal.title} marked as lost. Reason: ${req.body.lostReason || "N/A"}`, req.admin._id);
    }

    await deal.save();
    res.json({ success: true, data: deal, message: "Deal updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update deal" });
  }
};

export const moveDealStage = async (req, res) => {
  try {
    const { stageKey } = req.body;
    if (!stageKey) return res.status(400).json({ success: false, message: "stageKey is required" });

    const deal = await CRMDeal.findOne({ _id: req.params.id, isDeleted: false });
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });

    const pipe = await CRMPipeline.findById(deal.pipeline);
    const stage = pipe?.stages.find((s) => s.key === stageKey);

    const prevStage = deal.stageKey;
    deal.stageKey   = stageKey;
    deal.stageOrder = stage?.order ?? deal.stageOrder;
    deal.probability = stage?.probability ?? deal.probability;

    if (stage?.isWon) { deal.status = "won"; deal.wonAt = new Date(); }
    if (stage?.isLost) { deal.status = "lost"; deal.lostAt = new Date(); }

    await deal.save();
    await logActivity(deal._id, "stage_change", "Stage moved",
      `Deal moved from ${prevStage} → ${stageKey}`, req.admin._id, { from: prevStage, to: stageKey });

    res.json({ success: true, data: deal, message: "Stage updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to move stage" });
  }
};

export const deleteDeal = async (req, res) => {
  try {
    const deal = await CRMDeal.findOne({ _id: req.params.id, isDeleted: false });
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });
    deal.isDeleted = true;
    await deal.save();
    res.json({ success: true, message: "Deal deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete deal" });
  }
};

export const addDealNote = async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: "Note body required" });
    const deal = await CRMDeal.findOne({ _id: req.params.id, isDeleted: false });
    if (!deal) return res.status(404).json({ success: false, message: "Deal not found" });
    deal.notes.push({ body: body.trim(), createdBy: req.admin._id });
    await deal.save();
    await logActivity(deal._id, "note", "Note added", body.trim(), req.admin._id);
    res.json({ success: true, data: deal.notes[deal.notes.length - 1] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};
