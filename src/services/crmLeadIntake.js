// Shared intake for leads that arrive without a human creating them: paid-ad
// site forms (adLeadRouter), Meta Lead Ads (metaLeadAds), CSV import, and
// admin-created leads left unassigned. Handles dedupe and round-robin owner.
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CrmUser from "../models/crmUser.model.js";
import { normalizePhone } from "../utils/phone.js";
import { notifyLeadAssigned } from "./crmLeadNotify.js";

const CLOSED_STATUSES = ["won", "lost", "junk"];

const AD_SOURCES = ["meta_ads", "google_ads", "linkedin_ads"];
const AD_SOCIAL_UTM = /^(instagram|ig|facebook|fb|meta)\b/i;

// Paid-ad leads, including Instagram comment/DM leads (source "social" with an Instagram/Meta utm_source).
export const isAdPoolLead = ({ source, utm } = {}) =>
  AD_SOURCES.includes(source) || (source === "social" && AD_SOCIAL_UTM.test(String(utm?.utm_source || "")));

// The same rule as a Mongo filter, for jobs that scan leads.
export const AD_POOL_QUERY = {
  $or: [{ source: { $in: AD_SOURCES } }, { source: "social", "utm.utm_source": AD_SOCIAL_UTM }],
};

// Returns next(fields) → the least-loaded rep of the right pool (ties broken at random), counting
// each pick so a batch spreads evenly. Paid-ad leads go to the ads pool lead, then the rest of the ads
// pool; everything else goes to direct-pool reps. Owners/admins are the last fallback so a lead is
// never left invisible.
export async function createAssigner() {
  const users = await CrmUser.find({ active: true, crmRole: { $in: ["sales", "super_admin", "admin"] } })
    .select("_id crmRole leadPool poolLead").lean();
  const sales = users.filter((u) => u.crmRole === "sales");
  const adsPool = sales.filter((u) => u.leadPool === "ads");
  const directPool = sales.filter((u) => u.leadPool !== "ads");
  const admins = users.filter((u) => u.crmRole !== "sales");
  const tiers = {
    ads: [adsPool.filter((u) => u.poolLead), adsPool, directPool, admins],
    direct: [directPool, admins],
  };

  const ids = users.map((u) => u._id);
  const loads = ids.length ? await CRMLead.aggregate([
    { $match: { assignedTo: { $in: ids }, isDeleted: false, status: { $nin: CLOSED_STATUSES } } },
    { $group: { _id: "$assignedTo", open: { $sum: 1 } } },
  ]) : [];
  const openBy = new Map(ids.map((id) => [String(id), 0]));
  loads.forEach((l) => openBy.set(String(l._id), l.open));

  return (fields) => {
    const group = tiers[isAdPoolLead(fields) ? "ads" : "direct"].find((g) => g.length);
    if (!group) return undefined;
    const min = Math.min(...group.map((u) => openBy.get(String(u._id))));
    const candidates = group.filter((u) => openBy.get(String(u._id)) === min);
    const pick = candidates[Math.floor(Math.random() * candidates.length)]._id;
    openBy.set(String(pick), min + 1);
    return pick;
  };
}

export const pickAssignee = async (fields) => (await createAssigner())(fields);

// Existing (non-deleted) lead with the same email or phone, if any.
export function findDuplicateLead({ email, phone, country }) {
  const normalizedEmail = typeof email === "string" && email.trim() ? email.toLowerCase().trim() : null;
  const normalizedPhone = normalizePhone(phone, country);
  const or = [
    ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
    ...(normalizedPhone ? [{ phoneNormalized: normalizedPhone }] : []),
  ];
  return or.length ? CRMLead.findOne({ isDeleted: false, $or: or }).select("_id name assignedTo") : null;
}

const logIntake = (leadId, title, body, metadata) =>
  CRMActivity.create({ type: "created", title, body, relatedToType: "lead", relatedToId: leadId, metadata });

/**
 * Creates (or matches) a lead for an automated source.
 * `externalId` makes repeat deliveries idempotent (e.g. a Meta leadgen id).
 * Returns { lead, created }.
 */
export async function upsertCrmLead({
  fields, externalId, externalField = "metaLeadgenId", activityTitle, activityBody, repeatTitle, metadata = {},
}) {
  if (externalId) {
    const already = await CRMLead.findOne({ [externalField]: externalId }).select("_id name assignedTo");
    if (already) return { lead: already, created: false };
  }

  const existing = await findDuplicateLead(fields);
  if (existing) {
    await logIntake(existing._id, repeatTitle || "Submitted again", activityBody, metadata);
    notifyLeadAssigned({ leads: existing, assigneeId: existing.assignedTo, reason: "repeat" });
    return { lead: existing, created: false };
  }

  const lead = await CRMLead.create({
    status: "new",
    ...fields,
    email: typeof fields.email === "string" ? fields.email.toLowerCase().trim() : undefined,
    ...(externalId && { [externalField]: externalId }),
    assignedTo: fields.assignedTo || await pickAssignee(fields),
  });
  await logIntake(lead._id, activityTitle, activityBody, metadata);
  notifyLeadAssigned({ leads: lead, assigneeId: lead.assignedTo, reason: "new" });
  return { lead, created: true };
}

// One-off at boot: fill phoneNormalized on leads created before the field existed.
export async function backfillPhoneNormalized(limit = 5000) {
  const leads = await CRMLead.find({ phone: { $nin: [null, ""] }, phoneNormalized: { $exists: false } })
    .select("phone country").limit(limit).lean();
  const ops = leads
    .map((l) => ({ id: l._id, value: normalizePhone(l.phone, l.country) }))
    .map(({ id, value }) => ({ updateOne: { filter: { _id: id }, update: value ? { $set: { phoneNormalized: value } } : { $set: { phoneNormalized: null } } } }));
  if (ops.length) await CRMLead.bulkWrite(ops, { ordered: false });
  return ops.length;
}
