import CRMLead from "../models/crm/crmLead.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMCompany from "../models/crm/crmCompany.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMPipeline from "../models/crm/crmPipeline.model.js";
import CrmUser from "../models/crmUser.model.js";

export const parsePaging = (query, { defaultLimit = 25, max = 100 } = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

export const isValidId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);

export const pick = (obj, fields) =>
  Object.fromEntries(fields.filter((f) => obj?.[f] !== undefined).map((f) => [f, obj[f]]));

// ── Ownership ────────────────────────────────────────────────────────────────
// Sales reps work only their own book. Admins see everything; marketing and
// readonly keep read access to all records (they don't own leads).

export const CRM_ADMIN_ROLES = ["super_admin", "admin"];
export const crmRoleOf = (req) => req.crmRole || req.admin?.crmRole || req.admin?.role;
export const isCrmAdmin = (req) => CRM_ADMIN_ROLES.includes(crmRoleOf(req));
export const isOwnerScoped = (req) => crmRoleOf(req) === "sales";

export const ownerFilter = (req, field = "assignedTo") =>
  (isOwnerScoped(req) ? { [field]: req.admin._id } : {});

// Filter for one lead the caller may see, or null when the id is malformed.
export const leadScope = (req, id) =>
  (isValidId(String(id)) ? { _id: id, isDeleted: false, ...ownerFilter(req) } : null);

// A rep sees deals assigned to them or attached to one of their leads.
export async function dealOwnerFilter(req) {
  if (!isOwnerScoped(req)) return {};
  const myLeads = await CRMLead.distinct("_id", { assignedTo: req.admin._id, isDeleted: false });
  return { $or: [{ assignedTo: req.admin._id }, { lead: { $in: myLeads } }] };
}

export const taskOwnerFilter = (req) =>
  (isOwnerScoped(req) ? { $or: [{ assignedTo: req.admin._id }, { createdBy: req.admin._id }] } : {});

const RELATED = {
  lead:    { model: CRMLead,    fields: "name",               label: (d) => d.name },
  contact: { model: CRMContact, fields: "firstName lastName", label: (d) => [d.firstName, d.lastName].filter(Boolean).join(" ") },
  company: { model: CRMCompany, fields: "name",               label: (d) => d.name },
  deal:    { model: CRMDeal,    fields: "title",              label: (d) => d.title },
};

export async function canAccessRelated(req, type, id) {
  if (!RELATED[type] || !isValidId(String(id))) return false;
  if (type === "lead") return !!(await CRMLead.exists({ _id: id, isDeleted: false, ...ownerFilter(req) }));
  if (type === "deal") return !!(await CRMDeal.exists({ _id: id, isDeleted: false, ...(await dealOwnerFilter(req)) }));
  return !!(await RELATED[type].model.exists({ _id: id, isDeleted: false }));
}

// Tasks and activities point at other records via relatedToType + relatedToId
// (no ref, so populate() can't follow them). Adds `related: { type, id, label }`.
export async function attachRelated(items) {
  const idsByType = {};
  for (const it of items) {
    if (it.relatedToId && RELATED[it.relatedToType]) {
      (idsByType[it.relatedToType] ||= new Set()).add(String(it.relatedToId));
    }
  }

  const labels = new Map();
  await Promise.all(Object.entries(idsByType).map(async ([type, ids]) => {
    const { model, fields, label } = RELATED[type];
    const docs = await model.find({ _id: { $in: [...ids] } }).select(fields).lean();
    docs.forEach((d) => labels.set(`${type}:${d._id}`, label(d)));
  }));

  return items.map((it) => {
    const key = `${it.relatedToType}:${it.relatedToId}`;
    return {
      ...it,
      related: labels.has(key) ? { type: it.relatedToType, id: it.relatedToId, label: labels.get(key) } : null,
    };
  });
}

// ── Reference validation ─────────────────────────────────────────────────────

const REF_MODELS = {
  lead: CRMLead, contact: CRMContact, company: CRMCompany, deal: CRMDeal, pipeline: CRMPipeline,
};

// refs: { fieldName: [modelKey, value] }. Returns the first field whose value
// isn't an existing record (null/"" clear the field and are always allowed).
export async function findMissingRef(refs) {
  for (const [field, [modelKey, value]] of Object.entries(refs)) {
    if (value == null || value === "") continue;
    const model = REF_MODELS[modelKey];
    const filter = model === CRMPipeline ? { _id: value } : { _id: value, isDeleted: false };
    if (!isValidId(String(value)) || !(await model.exists(filter))) return field;
  }
  return null;
}

export const activeUserExists = async (id) =>
  isValidId(String(id)) && !!(await CrmUser.exists({ _id: id, active: true }));

// Malformed ids and schema violations are the client's fault, not a server error.
export function sendCrmError(res, err, message) {
  if (err?.name === "CastError") {
    return res.status(400).json({ success: false, message: `Invalid value for ${err.path}` });
  }
  if (err?.name === "ValidationError") {
    const first = Object.values(err.errors || {})[0];
    return res.status(400).json({ success: false, message: first?.message || "Invalid input" });
  }
  console.error(`${message}:`, err);
  return res.status(500).json({ success: false, message });
}
