// Shared intake for leads that arrive without a human creating them: paid-ad
// site forms (adLeadRouter), Meta Lead Ads (metaLeadAds), CSV import, and
// admin-created leads left unassigned. Handles dedupe and round-robin owner.
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CrmUser from "../models/crmUser.model.js";
import { normalizePhone } from "../utils/phone.js";

const CLOSED_STATUSES = ["won", "lost", "junk"];

// Returns next() → the least-loaded active sales rep (ties broken at random),
// counting each pick so a batch spreads evenly. Owners/admins are the fallback
// so a lead is never left invisible.
export async function createAssigner() {
  for (const roles of [["sales"], ["super_admin", "admin"]]) {
    const users = await CrmUser.find({ active: true, crmRole: { $in: roles } }).select("_id").lean();
    if (!users.length) continue;
    const ids = users.map((u) => u._id);
    const loads = await CRMLead.aggregate([
      { $match: { assignedTo: { $in: ids }, isDeleted: false, status: { $nin: CLOSED_STATUSES } } },
      { $group: { _id: "$assignedTo", open: { $sum: 1 } } },
    ]);
    const openBy = new Map(ids.map((id) => [String(id), 0]));
    loads.forEach((l) => openBy.set(String(l._id), l.open));
    return () => {
      const min = Math.min(...openBy.values());
      const candidates = ids.filter((id) => openBy.get(String(id)) === min);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      openBy.set(String(pick), min + 1);
      return pick;
    };
  }
  return () => undefined;
}

export const pickAssignee = async () => (await createAssigner())();

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
  fields, externalId, activityTitle, activityBody, repeatTitle, metadata = {},
}) {
  if (externalId) {
    const already = await CRMLead.findOne({ metaLeadgenId: externalId }).select("_id name assignedTo");
    if (already) return { lead: already, created: false };
  }

  const existing = await findDuplicateLead(fields);
  if (existing) {
    await logIntake(existing._id, repeatTitle || "Submitted again", activityBody, metadata);
    return { lead: existing, created: false };
  }

  const lead = await CRMLead.create({
    status: "new",
    ...fields,
    email: typeof fields.email === "string" ? fields.email.toLowerCase().trim() : undefined,
    ...(externalId && { metaLeadgenId: externalId }),
    assignedTo: fields.assignedTo || await pickAssignee(),
  });
  await logIntake(lead._id, activityTitle, activityBody, metadata);
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
