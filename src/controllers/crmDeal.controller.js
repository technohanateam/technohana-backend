import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMPipeline from "../models/crm/crmPipeline.model.js";
import {
  parsePaging, isValidId, pick, isCrmAdmin, dealOwnerFilter, canAccessRelated,
  findMissingRef, activeUserExists, sendCrmError,
} from "../utils/crmQuery.js";

const DEAL_FIELDS = ["title", "value", "currency", "probability", "expectedCloseDate", "lostReason",
  "lead", "contact", "company", "proposalId", "quotationRef", "purchaseOrderRef", "purchaseOrderUrl",
  "invoiceRef", "tags"];

const logActivity = async (dealId, type, title, body, performedBy, metadata = {}) => {
  try {
    await CRMActivity.create({ type, title, body, metadata, relatedToType: "deal", relatedToId: dealId, performedBy });
  } catch (e) { console.error("Activity log failed:", e.message); }
};

const notFound = (res) => res.status(404).json({ success: false, message: "Deal not found" });

const findScopedDeal = async (req, id) => {
  if (!isValidId(String(id))) return null;
  return CRMDeal.findOne({ _id: id, isDeleted: false, ...(await dealOwnerFilter(req)) });
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

// Shared validation for create/update: refs exist, a rep only links their own
// lead, the PO link is a real http(s) URL, and only admins pick the owner.
async function validateDealInput(req, fields) {
  const missing = await findMissingRef({
    lead: ["lead", fields.lead], contact: ["contact", fields.contact], company: ["company", fields.company],
  });
  if (missing) return `Invalid ${missing}`;
  if (fields.lead && !(await canAccessRelated(req, "lead", String(fields.lead)))) return "Invalid lead";
  if (fields.purchaseOrderUrl && !/^https?:\/\//i.test(String(fields.purchaseOrderUrl))) return "Purchase order link must be an http(s) URL";
  if (req.body.assignedTo !== undefined && isCrmAdmin(req) && req.body.assignedTo && !(await activeUserExists(req.body.assignedTo))) {
    return "Invalid assignee";
  }
  return null;
}

export const getDeals = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req.query, { max: 200 });

    const { pipeline, status, assignedTo, company, search } = req.query;
    for (const [key, val] of [["pipeline", pipeline], ["assignedTo", assignedTo], ["company", company]]) {
      if (val && !isValidId(val)) return res.status(400).json({ success: false, message: `Invalid ${key} id` });
    }

    const filter = { isDeleted: false, ...(await dealOwnerFilter(req)) };
    if (search?.trim()) filter.title = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (pipeline)   filter.pipeline   = pipeline;
    if (status)     filter.status     = status;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (company)    filter.company    = company;

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
    sendCrmError(res, err, "Failed to fetch deals");
  }
};

export const getDeal = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return notFound(res);
    const deal = await CRMDeal.findOne({ _id: req.params.id, isDeleted: false, ...(await dealOwnerFilter(req)) })
      .populate("pipeline", "name type stages")
      .populate("lead", "name email phone company status")
      .populate("contact", "firstName lastName email phone")
      .populate("company", "name industry website")
      .populate("assignedTo", "name email")
      .populate("tags", "name color")
      .lean();
    if (!deal) return notFound(res);

    const activities = await CRMActivity.find({ relatedToType: "deal", relatedToId: deal._id })
      .sort({ createdAt: -1 }).limit(30).populate("performedBy", "name").lean();

    res.json({ success: true, data: { ...deal, activities } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch deal");
  }
};

export const createDeal = async (req, res) => {
  try {
    const { title, pipeline } = req.body;
    if (typeof title !== "string" || !title.trim()) return res.status(400).json({ success: false, message: "Deal title is required" });
    if (!isValidId(String(pipeline))) return res.status(400).json({ success: false, message: "Pipeline is required" });

    const pipe = await CRMPipeline.findOne({ _id: pipeline, isActive: true });
    if (!pipe) return res.status(400).json({ success: false, message: "Invalid pipeline" });

    const stages = pipe.stages.slice().sort((a, b) => a.order - b.order);
    const stage = req.body.stageKey ? stages.find((s) => s.key === req.body.stageKey) : stages[0];
    if (!stage) return res.status(400).json({ success: false, message: req.body.stageKey ? "Stage not found in pipeline" : "Pipeline has no stages" });

    const fields = pick(req.body, DEAL_FIELDS);
    const invalid = await validateDealInput(req, fields);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const deal = new CRMDeal({
      ...fields,
      title: title.trim(),
      pipeline: pipe._id,
      stageKey: stage.key,
      stageOrder: stage.order ?? 0,
      probability: fields.probability ?? stage.probability ?? 20,
      assignedTo: isCrmAdmin(req) && req.body.assignedTo ? req.body.assignedTo : req.admin._id,
      createdBy: req.admin._id,
    });
    const statusActivity = applyStageStatus(deal, stage, fields.lostReason);
    await deal.save();

    await logActivity(deal._id, "created", "Deal created", `${deal.title} added to pipeline`, req.admin._id);
    if (statusActivity) await logActivity(deal._id, ...statusActivity, req.admin._id);

    res.status(201).json({ success: true, data: deal, message: "Deal created" });
  } catch (err) {
    sendCrmError(res, err, "Failed to create deal");
  }
};

export const updateDeal = async (req, res) => {
  try {
    const deal = await findScopedDeal(req, req.params.id);
    if (!deal) return notFound(res);

    const fields = pick(req.body, DEAL_FIELDS);
    const invalid = await validateDealInput(req, fields);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const pending = [];
    const prevStatus = deal.status;
    Object.assign(deal, fields);
    if (isCrmAdmin(req) && req.body.assignedTo !== undefined) deal.assignedTo = req.body.assignedTo || null;

    // Pipeline/stage changes are validated together, and the stage decides the status.
    const nextPipelineId = req.body.pipeline ?? String(deal.pipeline);
    const stageChanged = req.body.stageKey !== undefined && req.body.stageKey !== deal.stageKey;
    const pipelineChanged = req.body.pipeline !== undefined && String(req.body.pipeline) !== String(deal.pipeline);
    if (stageChanged || pipelineChanged) {
      if (!isValidId(String(nextPipelineId))) return res.status(400).json({ success: false, message: "Invalid pipeline" });
      const pipe = await CRMPipeline.findOne({ _id: nextPipelineId, isActive: true });
      const stage = pipe?.stages.find((s) => s.key === (req.body.stageKey ?? deal.stageKey));
      if (!stage) return res.status(400).json({ success: false, message: "Stage not found in pipeline" });

      const prevStage = deal.stageKey;
      deal.pipeline = pipe._id;
      deal.stageKey = stage.key;
      deal.stageOrder = stage.order ?? deal.stageOrder;
      if (fields.probability === undefined) deal.probability = stage.probability ?? deal.probability;
      pending.push(["stage_change", "Stage moved", `Deal moved from ${prevStage} → ${stage.key}`, { from: prevStage, to: stage.key }]);
      const statusActivity = applyStageStatus(deal, stage, fields.lostReason);
      if (statusActivity) pending.push(statusActivity);
    } else if (["open", "won", "lost"].includes(req.body.status) && req.body.status !== prevStatus) {
      deal.status = req.body.status;
      deal.wonAt  = req.body.status === "won" ? new Date() : undefined;
      deal.lostAt = req.body.status === "lost" ? new Date() : undefined;
      if (req.body.status === "won")  pending.push(["deal_won", "Deal won", `${deal.title} marked as won!`]);
      if (req.body.status === "lost") pending.push(["deal_lost", "Deal lost", `${deal.title} marked as lost. Reason: ${fields.lostReason || "N/A"}`]);
    }

    await deal.save();
    for (const [type, title, body, metadata] of pending) await logActivity(deal._id, type, title, body, req.admin._id, metadata);
    res.json({ success: true, data: deal, message: "Deal updated" });
  } catch (err) {
    sendCrmError(res, err, "Failed to update deal");
  }
};

export const moveDealStage = async (req, res) => {
  try {
    const { stageKey } = req.body;
    if (typeof stageKey !== "string" || !stageKey) return res.status(400).json({ success: false, message: "stageKey is required" });

    const deal = await findScopedDeal(req, req.params.id);
    if (!deal) return notFound(res);

    const pipe = await CRMPipeline.findById(deal.pipeline);
    if (!pipe) return res.status(400).json({ success: false, message: "Associated pipeline not found" });

    const stage = pipe.stages.find((s) => s.key === stageKey);
    if (!stage) return res.status(400).json({ success: false, message: "Stage not found in pipeline" });

    const prevStage = deal.stageKey;
    if (prevStage === stageKey) return res.json({ success: true, data: deal, message: "Stage unchanged" });

    deal.stageKey   = stageKey;
    deal.stageOrder = stage.order ?? deal.stageOrder;
    deal.probability = stage.probability ?? deal.probability;
    const lostReason = typeof req.body.lostReason === "string" ? req.body.lostReason : undefined;
    const statusActivity = applyStageStatus(deal, stage, lostReason);
    if (stage.isLost && lostReason) deal.lostReason = lostReason;

    await deal.save();
    await logActivity(deal._id, "stage_change", "Stage moved",
      `Deal moved from ${prevStage} → ${stageKey}`, req.admin._id, { from: prevStage, to: stageKey });
    if (statusActivity) await logActivity(deal._id, ...statusActivity, req.admin._id);

    res.json({ success: true, data: deal, message: "Stage updated" });
  } catch (err) {
    sendCrmError(res, err, "Failed to move stage");
  }
};

export const deleteDeal = async (req, res) => {
  try {
    const deal = await findScopedDeal(req, req.params.id);
    if (!deal) return notFound(res);
    deal.isDeleted = true;
    deal.deletedAt = new Date();
    await deal.save();
    res.json({ success: true, message: "Deal deleted" });
  } catch (err) {
    sendCrmError(res, err, "Failed to delete deal");
  }
};

export const addDealNote = async (req, res) => {
  try {
    const { body } = req.body;
    if (typeof body !== "string" || !body.trim()) return res.status(400).json({ success: false, message: "Note body required" });
    const deal = await findScopedDeal(req, req.params.id);
    if (!deal) return notFound(res);
    deal.notes.push({ body: body.trim(), createdBy: req.admin._id });
    await deal.save();
    await logActivity(deal._id, "note", "Note added", body.trim(), req.admin._id);
    res.json({ success: true, data: deal.notes[deal.notes.length - 1] });
  } catch (err) {
    sendCrmError(res, err, "Failed to add note");
  }
};
