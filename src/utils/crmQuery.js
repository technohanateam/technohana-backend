import CRMLead from "../models/crm/crmLead.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMCompany from "../models/crm/crmCompany.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";

export const parsePaging = (query, { defaultLimit = 25, max = 100 } = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

const RELATED = {
  lead:    { model: CRMLead,    fields: "name",               label: (d) => d.name },
  contact: { model: CRMContact, fields: "firstName lastName", label: (d) => [d.firstName, d.lastName].filter(Boolean).join(" ") },
  company: { model: CRMCompany, fields: "name",               label: (d) => d.name },
  deal:    { model: CRMDeal,    fields: "title",              label: (d) => d.title },
};

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
