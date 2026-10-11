import mongoose from "mongoose";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMPipeline from "../models/crm/crmPipeline.model.js";
import { parsePaging } from "../utils/crmQuery.js";

const logActivity = async (dealId, type, title, body, performedBy, metadata = {}) => {
  try {
    await CRMActivity.create({ type, title, body, metadata, relatedToType: "deal", relatedToId: dealId, performedBy });
  } catch (e) { console.error("Activity log failed:", e.message); }
};

// Keeps status/wonAt/lostAt consistent with the deal's stage and logs the
// transition. Returns the activity to log after the deal is saved, if any.
const applyStageStatus = (deal, stage, lostReason) => {
  const prevStatus = deal.status;
  const nextStatus = stage?.isWon ? "won" : stage?.isLost ? "lost" : "open";
  if (nextStatus === prevStatus) return null;

  deal.status = nextStatus;
  deal.wonAt  = nextStatus === "won" ? new Date() : undefined;
  deal.lostAt = nextStatus === "lost" ? new Date() : undefined;
  if (nextStatus === "won")  return ["deal_won", "Deal won", `${deal.title} marked as won!`];
  if (nextStatus === "lost") return ["deal_lost", "Deal lost", `${deal.title} marked as lost. Reason: ${lostReason || deal.lostReason || "N/A"}`];
  return ["status_change", "Deal reopened", `${deal.title} moved back to an open stage`];
};

export const getDeals = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req.query, { max: 200 });

    const { pipeline, status, assignedTo, company, search } = req.query;
    const filter = { isDeleted: false };
    if (typeof search === "string" && search.trim()) {
      filter.title = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    for (const [key, val] of [["pipeline", pipeline], ["assignedTo", assignedTo], ["company", company]]) {
      if (val && !mongoose.Types.ObjectId.isValid(val)) {
        return res.status(400).json({ success: false, message: `Invalid ${key} id` });
      }
    }
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
    if (!req.body.stageKey && !firstStage) {
      return res.status(400).json({ success: false, message: "Pipeline has no stages" });
    }

    const allowed = ["title", "value", "currency", "lead", "contact", "company",
      "proposalId", "quotationRef", "purchaseOrderRef", "purchaseOrderUrl", "invoiceRef",
      "tags", "notes", "attachments", "expectedCloseDate"];
    const fields = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });

    const deal = await CRMDeal.create({
      ...fields,
      pipeline,
      stageKey: req.body.stageKey || firstStage.key,
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

    const pending = [];
    if (req.body.status === "won" && prevStatus !== "won") {
      deal.wonAt = new Date();
      deal.lostAt = undefined;
      pending.push(["deal_won", "Deal won", `${deal.title} marked as won!`]);
    } else if (req.body.status === "lost" && prevStatus !== "lost") {
      deal.lostAt = new Date();
      deal.wonAt = undefined;
      pending.push(["deal_lost", "Deal lost", `${deal.title} marked as lost. Reason: ${req.body.lostReason || "N/A"}`]);
    } else if (req.body.status === "open" && prevStatus !== "open") {
      deal.wonAt = undefined;
      deal.lostAt = undefined;
    }

    await deal.save();
    for (const [type, title, body] of pending) await logActivity(deal._id, type, title, body, req.admin._id);
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
    if (!pipe) return res.status(400).json({ success: false, message: "Associated pipeline not found" });

    const stage = pipe.stages.find((s) => s.key === stageKey);
    if (!stage) return res.status(400).json({ success: false, message: "Stage not found in pipeline" });

    const prevStage = deal.stageKey;
    if (prevStage === stageKey) return res.json({ success: true, data: deal, message: "Stage unchanged" });

    deal.stageKey   = stageKey;
    deal.stageOrder = stage.order ?? deal.stageOrder;
    deal.probability = stage.probability ?? deal.probability;
    const statusActivity = applyStageStatus(deal, stage, req.body.lostReason);
    if (stage.isLost && req.body.lostReason) deal.lostReason = req.body.lostReason;

    await deal.save();
    await logActivity(deal._id, "stage_change", "Stage moved",
      `Deal moved from ${prevStage} → ${stageKey}`, req.admin._id, { from: prevStage, to: stageKey });
    if (statusActivity) await logActivity(deal._id, ...statusActivity, req.admin._id);

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
    deal.deletedAt = new Date();
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
