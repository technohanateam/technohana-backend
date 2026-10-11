// Keeps a lead and its deal telling the same story. Lead statuses and the
// default Corporate pipeline's stage keys mostly line up; this maps between them.
import CRMLead from "../models/crm/crmLead.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMPipeline from "../models/crm/crmPipeline.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";

const STATUS_TO_STAGE = {
  new: "lead", discovery: "discovery", needs_analysis: "needs_analysis",
  skill_gap_assessed: "skill_gap", course_recommended: "course_recommended",
  proposal_sent: "proposal_sent", negotiation: "negotiation", quotation_sent: "quotation_sent",
  purchase_order: "purchase_order", won: "won", lost: "lost",
};
const STAGE_TO_STATUS = Object.fromEntries(Object.entries(STATUS_TO_STAGE).map(([status, stage]) => [stage, status]));

// The stage of `pipeline` that matches a lead status, falling back to the first stage.
export function stageForLeadStatus(pipeline, status) {
  const stages = pipeline.stages.slice().sort((a, b) => a.order - b.order);
  if (status === "won") return stages.find((s) => s.isWon) || stages[0];
  if (status === "lost" || status === "junk") return stages.find((s) => s.isLost) || stages[0];
  return stages.find((s) => s.key === STATUS_TO_STAGE[status]) || stages[0];
}

const log = (relatedToType, relatedToId, type, title, body, performedBy, metadata = {}) =>
  CRMActivity.create({ type, title, body, relatedToType, relatedToId, performedBy, metadata })
    .catch((e) => console.error("Activity log failed:", e.message));

// After a deal's status/stage changes: carry the outcome (and matching stage) onto its lead.
export async function syncLeadFromDeal(deal, performedBy) {
  if (!deal?.lead) return;
  const lead = await CRMLead.findOne({ _id: deal.lead, isDeleted: false });
  if (!lead) return;

  const next = deal.status === "won" ? "won"
    : deal.status === "lost" ? "lost"
    : STAGE_TO_STATUS[deal.stageKey] && !["won", "lost"].includes(STAGE_TO_STATUS[deal.stageKey])
      ? STAGE_TO_STATUS[deal.stageKey]
      : ["won", "lost"].includes(lead.status) ? "negotiation" : null;
  if (!next || next === lead.status) return;

  const prev = lead.status;
  lead.status = next;
  lead.pipelineStage = deal.stageKey;
  lead.wonAt = next === "won" ? deal.wonAt || new Date() : undefined;
  lead.lostAt = next === "lost" ? deal.lostAt || new Date() : undefined;
  if (next === "lost" && deal.lostReason && !lead.lostReason) lead.lostReason = deal.lostReason;
  await lead.save();
  await log("lead", lead._id, "status_change", "Status changed",
    `Status changed from ${prev} to ${next} (deal "${deal.title}")`, performedBy, { from: prev, to: next, dealId: deal._id });
}

// After a lead is marked won/lost by hand: close its open deal the same way.
export async function syncDealFromLead(lead, performedBy) {
  if (!lead?.dealId || !["won", "lost"].includes(lead.status)) return;
  const deal = await CRMDeal.findOne({ _id: lead.dealId, isDeleted: false, status: "open" });
  if (!deal) return;
  const pipeline = await CRMPipeline.findById(deal.pipeline);
  const stage = pipeline && stageForLeadStatus(pipeline, lead.status);
  const won = lead.status === "won";

  deal.status = lead.status;
  deal.wonAt = won ? new Date() : undefined;
  deal.lostAt = won ? undefined : new Date();
  if (!won && lead.lostReason) deal.lostReason = lead.lostReason;
  if (stage && (won ? stage.isWon : stage.isLost)) {
    deal.stageKey = stage.key;
    deal.stageOrder = stage.order;
    deal.probability = stage.probability ?? deal.probability;
  }
  await deal.save();
  await log("deal", deal._id, won ? "deal_won" : "deal_lost", won ? "Deal won" : "Deal lost",
    `${deal.title} marked as ${lead.status} from its lead`, performedBy);
}
