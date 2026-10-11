import CRMCompany from "../models/crm/crmCompany.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { parsePaging, isValidId, pick, ownerFilter, dealOwnerFilter, findMissingRef, sendCrmError } from "../utils/crmQuery.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Notes go through POST /companies/:id/notes so their author can't be forged.
const COMPANY_FIELDS = ["name", "gst", "pan", "industry", "subIndustry", "annualRevenue", "employees",
  "employeeRange", "website", "linkedIn", "email", "phone", "address", "primaryContact", "tags"];

const notFound = (res) => res.status(404).json({ success: false, message: "Company not found" });
const nameMatch = (name) => new RegExp(`^${escapeRegex(name.trim())}$`, "i");

export const getCompanies = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);

    const { search, industry, country } = req.query;
    const filter = { isDeleted: false };
    if (industry) filter.industry = industry;
    if (country)  filter["address.country"] = country;
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: re }, { gst: re }, { email: re }];
    }

    const [companies, total] = await Promise.all([
      CRMCompany.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .populate("primaryContact", "firstName lastName email phone")
        .populate("tags", "name color")
        .lean(),
      CRMCompany.countDocuments(filter),
    ]);

    // Enrich with contact and deal counts
    const ids = companies.map((c) => c._id);
    const [contactCounts, dealCounts] = await Promise.all([
      CRMContact.aggregate([
        { $match: { company: { $in: ids }, isDeleted: false } },
        { $group: { _id: "$company", count: { $sum: 1 } } },
      ]),
      CRMDeal.aggregate([
        { $match: { company: { $in: ids }, isDeleted: false } },
        { $group: { _id: "$company", count: { $sum: 1 }, totalValue: { $sum: "$value" } } },
      ]),
    ]);

    const ccMap = Object.fromEntries(contactCounts.map((c) => [c._id.toString(), c.count]));
    const dcMap = Object.fromEntries(dealCounts.map((d) => [d._id.toString(), { count: d.count, totalValue: d.totalValue }]));

    const enriched = companies.map((c) => ({
      ...c,
      contactCount: ccMap[c._id.toString()] || 0,
      dealCount: dcMap[c._id.toString()]?.count || 0,
      dealValue: dcMap[c._id.toString()]?.totalValue || 0,
    }));

    res.json({ success: true, data: enriched, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch companies");
  }
};

export const getCompany = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return notFound(res);
    const company = await CRMCompany.findOne({ _id: req.params.id, isDeleted: false })
      .populate("primaryContact", "firstName lastName email phone designation")
      .populate("tags", "name color")
      .lean();
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    const [contacts, deals, leads, activities] = await Promise.all([
      CRMContact.find({ company: company._id, isDeleted: false })
        .select("firstName lastName email phone designation isDecisionMaker").lean(),
      CRMDeal.find({ company: company._id, isDeleted: false, ...(await dealOwnerFilter(req)) })
        .select("title value currency status stageKey expectedCloseDate").limit(200).lean(),
      CRMLead.find({ companyId: company._id, isDeleted: false, ...ownerFilter(req) })
        .select("name email status priority leadScore assignedTo").limit(10).lean(),
      CRMActivity.find({ relatedToType: "company", relatedToId: company._id })
        .sort({ createdAt: -1 }).limit(30).populate("performedBy", "name").lean(),
    ]);

    res.json({ success: true, data: { ...company, contacts, deals, leads, activities } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch company");
  }
};

export const createCompany = async (req, res) => {
  try {
    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ success: false, message: "Company name is required" });

    const exists = await CRMCompany.exists({ name: nameMatch(name), isDeleted: false });
    if (exists) return res.status(409).json({ success: false, message: "Company with this name already exists" });

    const fields = pick(req.body, COMPANY_FIELDS);
    const missing = await findMissingRef({ primaryContact: ["contact", fields.primaryContact] });
    if (missing) return res.status(400).json({ success: false, message: "Invalid primary contact" });

    const company = await CRMCompany.create({ ...fields, name: name.trim(), createdBy: req.admin._id });
    res.status(201).json({ success: true, data: company, message: "Company created" });
  } catch (err) {
    sendCrmError(res, err, "Failed to create company");
  }
};

export const updateCompany = async (req, res) => {
  try {
    const company = isValidId(req.params.id) && await CRMCompany.findOne({ _id: req.params.id, isDeleted: false });
    if (!company) return notFound(res);

    const fields = pick(req.body, COMPANY_FIELDS);
    const missing = await findMissingRef({ primaryContact: ["contact", fields.primaryContact] });
    if (missing) return res.status(400).json({ success: false, message: "Invalid primary contact" });
    if (typeof fields.name === "string" && fields.name.trim().toLowerCase() !== company.name.toLowerCase()) {
      const clash = await CRMCompany.exists({ name: nameMatch(fields.name), isDeleted: false, _id: { $ne: company._id } });
      if (clash) return res.status(409).json({ success: false, message: "Company with this name already exists" });
    }
    Object.assign(company, fields);

    await company.save();
    res.json({ success: true, data: company, message: "Company updated" });
  } catch (err) {
    sendCrmError(res, err, "Failed to update company");
  }
};

export const deleteCompany = async (req, res) => {
  try {
    const company = await CRMCompany.findOne({ _id: req.params.id, isDeleted: false });
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });
    company.isDeleted = true;
    await company.save();
    res.json({ success: true, message: "Company deleted" });
  } catch (err) {
    sendCrmError(res, err, "Failed to delete company");
  }
};

export const addCompanyNote = async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: "Note body required" });
    const company = await CRMCompany.findOne({ _id: req.params.id, isDeleted: false });
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });
    company.notes.push({ body: body.trim(), createdBy: req.admin._id });
    await company.save();
    res.json({ success: true, data: company.notes[company.notes.length - 1] });
  } catch (err) {
    sendCrmError(res, err, "Failed to add note");
  }
};
