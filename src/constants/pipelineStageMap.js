// Adds the master-plan stages to the seeded pipelines without renaming or reordering anything.
// Existing stage keys, labels, flags and orders are never touched, so no deal needs rewriting;
// new stages are slotted between existing ones with fractional `order`. Every stage also gets an
// optional canonical `alias` so legacy and new stages roll up together in cross-pipeline funnels.
// See docs/TECHNOHANA_PIPELINE_STAGE_MAPPING.md.

const stage = (key, label, probability, alias = key) => ({ key, label, probability, alias });

// `sequence` is the intended order of keys (existing + new). `aliases` maps existing keys to their
// canonical alias; keys without an entry alias to themselves.
export const PIPELINE_PLANS = {
  individual: {
    sequence: ["enquiry", "contacted", "counselling_scheduled", "counselling_completed", "course_suggest", "trial", "fee_shared", "payment_pending", "enrolled", "lost"],
    added: [
      stage("contacted", "Contacted", 18),
      stage("counselling_scheduled", "Counselling Scheduled", 22),
      stage("counselling_completed", "Counselling Completed", 26),
      stage("fee_shared", "Proposal / Fee Shared", 70),
      stage("payment_pending", "Payment Pending", 85),
    ],
    aliases: { enquiry: "new_lead", course_suggest: "interested", trial: "interested" },
  },
  corporate: {
    sequence: ["target_account", "lead", "contacted", "discovery", "needs_analysis", "skill_gap", "qualified_opportunity", "course_recommended", "proposal_sent", "negotiation", "quotation_sent", "purchase_order", "won", "lost"],
    added: [
      stage("target_account", "Target Account", 5),
      stage("contacted", "Contacted", 15),
      stage("qualified_opportunity", "Qualified Opportunity", 38),
    ],
    aliases: {
      lead: "prospect_identified", discovery: "discovery_meeting",
      needs_analysis: "requirement_analysis", skill_gap: "requirement_analysis",
      course_recommended: "qualified_opportunity",
      proposal_sent: "proposal_submitted", quotation_sent: "proposal_submitted",
      purchase_order: "contract_po_received",
    },
  },
  ai_projects: {
    sequence: ["prospect", "discovery", "readiness_assessment", "scoping", "proposal", "paid_poc", "production_proposal", "contract", "won", "lost"],
    added: [
      stage("discovery", "Discovery", 15),
      stage("readiness_assessment", "AI Readiness Assessment", 20, "ai_readiness_assessment"),
      stage("paid_poc", "Paid Discovery / PoC", 60, "paid_discovery_poc"),
      stage("production_proposal", "Production Proposal", 70),
    ],
    aliases: { prospect: "new_inquiry", scoping: "technical_requirement_analysis", proposal: "architecture_proposal" },
  },
};

const DEFAULT_COLOR = "#8B5CF6";

// Plans the additions for one pipeline. Pure: takes the stages as stored, returns what the stages
// should become plus a report. Existing stages are returned unchanged except for a missing alias.
export function planStageChanges(existingStages, type) {
  const plan = PIPELINE_PLANS[type];
  if (!plan) return { stages: existingStages, addedKeys: [], aliasedKeys: [], skipped: true };

  const present = new Map(existingStages.map((s) => [s.key, s]));
  const addedKeys = [];
  const aliasedKeys = [];

  const stages = existingStages.map((s) => {
    const alias = s.alias || plan.aliases[s.key];
    if (alias && !s.alias) { aliasedKeys.push(s.key); return { ...s, alias }; }
    return s;
  });

  // A new stage sits halfway between the nearest placed neighbours in the intended sequence
  // (stages added earlier in this loop count as placed), so existing orders never move.
  const seq = plan.sequence;
  const defs = new Map(plan.added.map((d) => [d.key, d]));
  const placedOrder = (key) => present.get(key)?.order;
  for (let i = 0; i < seq.length; i++) {
    const key = seq[i];
    if (present.has(key) || !defs.has(key)) continue;

    let lo = i - 1; while (lo >= 0 && placedOrder(seq[lo]) === undefined) lo--;
    let hi = i + 1; while (hi < seq.length && placedOrder(seq[hi]) === undefined) hi++;
    const loOrder = lo >= 0 ? placedOrder(seq[lo]) : undefined;
    const hiOrder = hi < seq.length ? placedOrder(seq[hi]) : undefined;

    let order;
    if (loOrder !== undefined && hiOrder !== undefined) order = (loOrder + hiOrder) / 2;
    else if (loOrder !== undefined) order = loOrder + 1;
    else if (hiOrder !== undefined) order = hiOrder - 0.5;
    else order = i + 1;
    order = Math.round(order * 1000) / 1000;

    const def = defs.get(key);
    const added = { key, label: def.label, order, probability: def.probability, color: DEFAULT_COLOR, isWon: false, isLost: false, alias: def.alias };
    stages.push(added);
    present.set(key, added);
    addedKeys.push(key);
  }

  return { stages, addedKeys, aliasedKeys, skipped: false };
}
