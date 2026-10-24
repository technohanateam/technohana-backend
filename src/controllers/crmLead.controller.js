import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import CRMTask from "../models/crm/crmTask.model.js";
import CRMDeal from "../models/crm/crmDeal.model.js";
import CRMContact from "../models/crm/crmContact.model.js";
import CRMCompany from "../models/crm/crmCompany.model.js";
import CRMPipeline from "../models/crm/crmPipeline.model.js";
import CrmUser from "../models/crmUser.model.js";
import { hasCrmPermission } from "../middleware/crmPermission.js";
import {
  parsePaging, isValidId, pick, isCrmAdmin, isOwnerScoped, crmRoleOf, ownerFilter, leadScope,
  findMissingRef, activeUserExists, sendCrmError,
} from "../utils/crmQuery.js";
import { pickAssignee, createAssigner } from "../services/crmLeadIntake.js";
import { stageForLeadStatus, syncDealFromLead } from "../services/crmLifecycle.js";
import { startOutreach, cancelOutreach, reassignOutreach } from "../services/crmOutreach.js";
import { resolveRange } from "../services/crmDailyReport.js";
import { normalizePhone } from "../utils/phone.js";
import { callClaude } from "../services/aiAgent.service.js";
import { computeQuote } from "../utils/pricing.js";

// Site-page leads (forms, chat) belong to the admin panel, not the CRM.
const SITE_SOURCES = ["website", "enquiry_form", "chat"];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LEAD_STATUSES   = CRMLead.schema.path("status").enumValues;
const LEAD_PRIORITIES = CRMLead.schema.path("priority").enumValues;
const SORT_FIELDS = ["createdAt", "updatedAt", "name", "leadScore", "aiScore", "expectedRevenue", "nextFollowUp", "status", "priority"];

const EDITABLE_FIELDS = [
  "name", "email", "phone", "whatsApp", "designation", "company",
  "country", "state", "city", "source", "website", "linkedIn", "utm",
  "interest", "budget", "currency", "teamSize", "industry",
  "priority", "leadScore", "expectedRevenue", "probability",
  "status", "lostReason", "pipeline", "pipelineStage", "assignedTo",
  "nextFollowUp", "contactId", "companyId", "dealId", "proposalId",
  "tags", "customFields", "skillGapData", "recommendedCourses",
];

const normEmail = (email) => (typeof email === "string" ? email.toLowerCase().trim() : email);

const leadRefs = (body) => ({
  contactId: ["contact", body.contactId],
  companyId: ["company", body.companyId],
  dealId:    ["deal", body.dealId],
  pipeline:  ["pipeline", body.pipeline],
});

const logActivity = async (leadId, type, title, body, performedBy, metadata = {}) => {
  try {
    await CRMActivity.create({
      type, title, body, metadata,
      relatedToType: "lead",
      relatedToId: leadId,
      performedBy,
    });
  } catch (e) {
    console.error("Activity log failed:", e.message);
  }
};

const notFound = (res) => res.status(404).json({ success: false, message: "Lead not found" });

export const getLeads = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);
    const { search, status, assignedTo, source, priority, pipeline, aiScoreBand, followUpDue, sort = "createdAt", order = "desc" } = req.query;

    if (pipeline && !isValidId(pipeline)) return res.status(400).json({ success: false, message: "Invalid pipeline id" });
    if (assignedTo && assignedTo !== "unassigned" && !isValidId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Invalid assignedTo id" });
    }

    const filter = { isDeleted: false, ...ownerFilter(req) };
    if (!filter.assignedTo && assignedTo) filter.assignedTo = assignedTo === "unassigned" ? null : assignedTo;

    if (status)      filter.status      = status;
    if (source)      filter.source      = source;
    if (priority)    filter.priority    = priority;
    if (pipeline)    filter.pipeline    = pipeline;
    if (aiScoreBand) filter.aiScoreBand = aiScoreBand;
    if (typeof req.query.campaign === "string" && req.query.campaign) filter["utm.utm_campaign"] = req.query.campaign;
    const PLATFORM_SOURCES = { instagram: ["instagram", "ig"], facebook: ["facebook", "fb"], linkedin: ["linkedin", "li"] };
    if (PLATFORM_SOURCES[req.query.platform]) filter["utm.utm_source"] = { $in: PLATFORM_SOURCES[req.query.platform] };
    // Follow-ups due today or earlier (IST) on leads that are still open.
    if (followUpDue === "true") {
      filter.nextFollowUp = { $lt: resolveRange().end };
      if (!status) filter.status = { $nin: ["won", "lost", "junk"] };
    }

    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: re }, { email: re }, { phone: re }, { company: re }];
    }

    const sortObj = { [SORT_FIELDS.includes(sort) ? sort : "createdAt"]: order === "asc" ? 1 : -1 };

    const [leads, total] = await Promise.all([
      CRMLead.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .populate("assignedTo", "name email")
        .populate("pipeline", "name type")
        .populate("tags", "name color")
        .lean(),
      CRMLead.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: leads,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch leads");
  }
};

export const getLead = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    if (!scope) return notFound(res);

    const lead = await CRMLead.findOne(scope)
      .populate("assignedTo", "name email")
      .populate("pipeline", "name type stages")
      .populate("tags", "name color")
      .populate("contactId", "firstName lastName email phone")
      .populate("companyId", "name industry")
      .populate("dealId", "title value status stageKey")
      .lean();

    if (!lead) return notFound(res);

    const activities = await CRMActivity.find({ relatedToType: "lead", relatedToId: lead._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("performedBy", "name")
      .lean();

    res.json({ success: true, data: { ...lead, activities } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch lead");
  }
};

export const createLead = async (req, res) => {
  try {
    const { name, email, source, assignedTo, notes } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required" });
    }
    if (SITE_SOURCES.includes(source)) {
      return res.status(400).json({ success: false, message: "Site-page leads are managed in the admin panel, not the CRM" });
    }

    if (email) {
      const existing = await CRMLead.findOne({ email: normEmail(email), isDeleted: false }).select("assignedTo").lean();
      if (existing) {
        // Only hand back the id to someone allowed to open that lead.
        const visible = !isOwnerScoped(req) || String(existing.assignedTo) === String(req.admin._id);
        return res.status(409).json({
          success: false,
          message: visible ? "A lead with this email already exists" : "A lead with this email already exists and is owned by another rep",
          data: visible ? { existingId: existing._id } : undefined,
        });
      }
    }

    // Only admins choose the owner ("auto" = least-loaded rep); everyone else creates leads for themselves.
    let owner = req.admin._id;
    if (isCrmAdmin(req) && assignedTo === "auto") {
      owner = (await pickAssignee()) || req.admin._id;
    } else if (isCrmAdmin(req) && assignedTo) {
      if (!(await activeUserExists(assignedTo))) return res.status(400).json({ success: false, message: "Invalid assignee" });
      owner = assignedTo;
    }

    const missing = await findMissingRef(leadRefs(req.body));
    if (missing) return res.status(400).json({ success: false, message: `Invalid ${missing}` });

    const fields = pick(req.body, EDITABLE_FIELDS.filter((f) => !["assignedTo", "leadScore", "lostReason"].includes(f)));
    const lead = await CRMLead.create({
      ...fields,
      name: name.trim(),
      email: normEmail(email),
      status: fields.status || "new",
      assignedTo: owner,
      notes: typeof notes === "string" && notes.trim() ? [{ body: notes.trim(), createdBy: req.admin._id }] : [],
      createdBy: req.admin._id,
    });

    await logActivity(lead._id, "created", "Lead created", `${lead.name} was added to the CRM`, req.admin._id);
    if (lead.notes.length) await logActivity(lead._id, "note", "Note added", lead.notes[0].body, req.admin._id);

    res.status(201).json({ success: true, data: lead, message: "Lead created" });
  } catch (err) {
    sendCrmError(res, err, "Failed to create lead");
  }
};

export const updateLead = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope);
    if (!lead) return notFound(res);

    if (SITE_SOURCES.includes(req.body.source)) {
      return res.status(400).json({ success: false, message: "Site-page leads are managed in the admin panel, not the CRM" });
    }

    const updates = pick(req.body, EDITABLE_FIELDS);
    if (!isCrmAdmin(req)) delete updates.assignedTo;
    if (updates.email !== undefined) updates.email = normEmail(updates.email);

    if (updates.assignedTo && String(updates.assignedTo) !== String(lead.assignedTo) && !(await activeUserExists(updates.assignedTo))) {
      return res.status(400).json({ success: false, message: "Invalid assignee" });
    }
    const missing = await findMissingRef(leadRefs(updates));
    if (missing) return res.status(400).json({ success: false, message: `Invalid ${missing}` });

    const prevStatus = lead.status;
    const prevStage  = lead.pipelineStage;
    const prevOwner  = lead.assignedTo ? String(lead.assignedTo) : null;

    Object.assign(lead, updates);

    if (updates.status && updates.status !== prevStatus) {
      lead.wonAt  = updates.status === "won" ? new Date() : undefined;
      lead.lostAt = ["lost", "junk"].includes(updates.status) ? new Date() : undefined;
    }

    await lead.save();

    if (updates.status && updates.status !== prevStatus) {
      await logActivity(lead._id, "status_change", "Status changed",
        `Status changed from ${prevStatus} to ${updates.status}${updates.lostReason ? ` (${updates.lostReason})` : ""}`,
        req.admin._id, { from: prevStatus, to: updates.status });
      await syncDealFromLead(lead, req.admin._id);
      if (["won", "lost", "junk"].includes(updates.status)) await cancelOutreach(lead._id);
    }
    if (updates.pipelineStage && updates.pipelineStage !== prevStage) {
      await logActivity(lead._id, "stage_change", "Stage moved",
        `Moved from ${prevStage || "—"} to ${updates.pipelineStage}`,
        req.admin._id, { from: prevStage, to: updates.pipelineStage });
    }
    if (updates.assignedTo !== undefined && String(updates.assignedTo || "") !== String(prevOwner || "")) {
      await logActivity(lead._id, "assigned", "Lead reassigned", "Lead owner changed",
        req.admin._id, { from: prevOwner, to: updates.assignedTo || null });
      if (updates.assignedTo) await reassignOutreach(lead._id, updates.assignedTo);
    }

    res.json({ success: true, data: lead, message: "Lead updated" });
  } catch (err) {
    sendCrmError(res, err, "Failed to update lead");
  }
};

export const deleteLead = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope);
    if (!lead) return notFound(res);

    lead.isDeleted = true;
    lead.deletedAt = new Date();
    await lead.save();

    res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
    sendCrmError(res, err, "Failed to delete lead");
  }
};

export const bulkLeadAction = async (req, res) => {
  try {
    const { action, ids, payload } = req.body;
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "action and ids are required" });
    }
    if (ids.length > 500) return res.status(400).json({ success: false, message: "Max 500 leads per bulk action" });
    if (ids.some((id) => !isValidId(String(id)))) {
      return res.status(400).json({ success: false, message: "Invalid lead id in ids" });
    }

    // Bulk actions only ever touch leads the caller could open one by one.
    const inScope = { _id: { $in: ids }, isDeleted: false, ...ownerFilter(req) };
    const role = crmRoleOf(req);

    if (action === "delete") {
      if (!hasCrmPermission(role, "leads", "delete")) {
        return res.status(403).json({ success: false, message: `Your role (${role}) cannot delete leads.` });
      }
      const result = await CRMLead.updateMany(inScope, { isDeleted: true, deletedAt: new Date() });
      return res.json({ success: true, message: `${result.modifiedCount} leads deleted` });
    }

    if (action === "assign") {
      if (!isCrmAdmin(req)) return res.status(403).json({ success: false, message: "Only admins can reassign leads." });
      if (!(await activeUserExists(payload?.assignedTo))) {
        return res.status(400).json({ success: false, message: "Invalid assignee" });
      }
      const moving = await CRMLead.find({ ...inScope, assignedTo: { $ne: payload.assignedTo } }).select("assignedTo").lean();
      if (moving.length) {
        await CRMLead.updateMany({ _id: { $in: moving.map((l) => l._id) } }, { assignedTo: payload.assignedTo });
        await reassignOutreach(moving.map((l) => l._id), payload.assignedTo);
        await CRMActivity.insertMany(moving.map((l) => ({
          type: "assigned",
          title: "Lead reassigned",
          body: "Lead owner changed",
          relatedToType: "lead",
          relatedToId: l._id,
          performedBy: req.admin._id,
          metadata: { from: l.assignedTo || null, to: payload.assignedTo, bulk: true },
        })));
      }
      return res.json({ success: true, message: `${moving.length} leads reassigned` });
    }

    if (action === "status" && payload?.status) {
      if (!LEAD_STATUSES.includes(payload.status)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      const changing = await CRMLead.find({ ...inScope, status: { $ne: payload.status } }).select("status").lean();
      if (changing.length) {
        const now = new Date();
        const isWon = payload.status === "won";
        const isLost = ["lost", "junk"].includes(payload.status);
        const update = {
          $set: { status: payload.status, ...(isWon && { wonAt: now }), ...(isLost && { lostAt: now }) },
          $unset: { ...(!isWon && { wonAt: 1 }), ...(!isLost && { lostAt: 1 }) },
        };
        await CRMLead.updateMany({ _id: { $in: changing.map((l) => l._id) } }, update);
        await CRMActivity.insertMany(changing.map((l) => ({
          type: "status_change",
          title: "Status changed",
          body: `Status changed from ${l.status} to ${payload.status}`,
          relatedToType: "lead",
          relatedToId: l._id,
          performedBy: req.admin._id,
          metadata: { from: l.status, to: payload.status, bulk: true },
        })));
        if (isWon || isLost) await cancelOutreach(changing.map((l) => l._id));
        if (isWon || payload.status === "lost") {
          const withDeals = await CRMLead.find({ _id: { $in: changing.map((l) => l._id) }, dealId: { $ne: null } });
          for (const l of withDeals) await syncDealFromLead(l, req.admin._id);
        }
      }
      return res.json({ success: true, message: `${changing.length} leads status updated` });
    }

    if (action === "priority" && payload?.priority) {
      if (!LEAD_PRIORITIES.includes(payload.priority)) {
        return res.status(400).json({ success: false, message: "Invalid priority" });
      }
      const result = await CRMLead.updateMany(inScope, { priority: payload.priority });
      return res.json({ success: true, message: `${result.modifiedCount} leads priority updated` });
    }

    if (action === "start_outreach") {
      const leads = await CRMLead.find(inScope).select("name phone country status assignedTo").populate("assignedTo", "name").lean();
      const result = await startOutreach(leads, req.admin._id);
      return res.json({
        success: true,
        message: `Outreach started for ${result.started} leads (${result.tasks} tasks)${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`,
        data: result,
      });
    }

    res.status(400).json({ success: false, message: "Unknown bulk action" });
  } catch (err) {
    sendCrmError(res, err, "Bulk action failed");
  }
};

const MERGE_SCALARS = ["email", "phone", "whatsApp", "designation", "company", "country", "state", "city",
  "website", "linkedIn", "utm", "interest", "budget", "teamSize", "industry", "priority",
  "leadScore", "expectedRevenue", "probability", "nextFollowUp", "lostReason",
  "contactId", "companyId", "dealId", "proposalId", "enrollmentId", "pipeline", "pipelineStage"];
const isBlank = (v) => v == null || v === "";

export const mergeLead = async (req, res) => {
  try {
    const { targetId } = req.body;
    const sourceId = req.params.id;

    if (!isValidId(sourceId) || !isValidId(targetId)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }
    if (sourceId === targetId) {
      return res.status(400).json({ success: false, message: "Cannot merge a lead with itself" });
    }

    const [source, target] = await Promise.all([
      CRMLead.findOne(leadScope(req, sourceId)),
      CRMLead.findOne(leadScope(req, targetId)),
    ]);

    if (!source || !target) return notFound(res);

    // Fill gaps on the target from the source; the target's own values win.
    MERGE_SCALARS.forEach((f) => {
      if (isBlank(target[f]) && !isBlank(source[f])) target[f] = source[f];
    });
    target.tags = [...new Set([...target.tags, ...source.tags].map(String))];
    for (const [k, v] of source.customFields || []) {
      if (!target.customFields.has(k)) target.customFields.set(k, v);
    }
    target.notes.push(...source.notes.map((n) => n.toObject()));
    target.attachments.push(...source.attachments.map((a) => a.toObject()));

    // Re-point everything that referenced the source lead.
    await Promise.all([
      CRMActivity.updateMany({ relatedToType: "lead", relatedToId: source._id }, { relatedToId: target._id }),
      CRMTask.updateMany({ relatedToType: "lead", relatedToId: source._id }, { relatedToId: target._id }),
      CRMDeal.updateMany({ lead: source._id }, { lead: target._id }),
    ]);

    source.isDeleted  = true;
    source.deletedAt  = new Date();
    source.isDuplicate = true;
    source.mergedInto = target._id;
    await source.save();
    await target.save();

    await logActivity(target._id, "merged", "Lead merged",
      `Lead ${source.name} (${source.email || source._id}) was merged into this record`,
      req.admin._id, { mergedLeadId: source._id });

    res.json({ success: true, data: target, message: "Leads merged" });
  } catch (err) {
    sendCrmError(res, err, "Merge failed");
  }
};

export const addNote = async (req, res) => {
  try {
    const { body } = req.body;
    if (typeof body !== "string" || !body.trim()) return res.status(400).json({ success: false, message: "Note body is required" });

    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope);
    if (!lead) return notFound(res);

    lead.notes.push({ body: body.trim(), createdBy: req.admin._id });
    await lead.save();

    await logActivity(lead._id, "note", "Note added", body.trim(), req.admin._id);

    res.json({ success: true, data: lead.notes[lead.notes.length - 1], message: "Note added" });
  } catch (err) {
    sendCrmError(res, err, "Failed to add note");
  }
};

// POST /leads/:id/convert — turns a qualified lead into a contact (+ company) and
// a deal in the chosen (or default) pipeline, and links all three to the lead.
export const convertLead = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope);
    if (!lead) return notFound(res);

    if (lead.dealId && await CRMDeal.exists({ _id: lead.dealId, isDeleted: false })) {
      return res.status(409).json({ success: false, message: "This lead already has a deal", data: { dealId: lead.dealId } });
    }

    const pipelineQuery = isValidId(String(req.body.pipeline || ""))
      ? { _id: req.body.pipeline, isActive: true }
      : { isActive: true };
    const pipeline = await CRMPipeline.findOne(pipelineQuery).sort({ isDefault: -1, createdAt: 1 });
    if (!pipeline?.stages?.length) return res.status(400).json({ success: false, message: "No usable pipeline" });
    const stage = stageForLeadStatus(pipeline, lead.status);

    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let company = lead.companyId && await CRMCompany.findOne({ _id: lead.companyId, isDeleted: false });
    let companyCreated = false;
    if (!company && lead.company?.trim()) {
      company = await CRMCompany.findOne({ name: new RegExp(`^${escape(lead.company.trim())}$`, "i"), isDeleted: false });
      if (!company) {
        company = await CRMCompany.create({ name: lead.company.trim(), industry: lead.industry, website: lead.website, createdBy: req.admin._id });
        companyCreated = true;
      }
    }

    let contact = lead.contactId && await CRMContact.findOne({ _id: lead.contactId, isDeleted: false });
    let contactCreated = false;
    if (!contact && lead.email) contact = await CRMContact.findOne({ email: lead.email, isDeleted: false });
    if (!contact) {
      const [firstName, ...rest] = lead.name.trim().split(/\s+/);
      contact = await CRMContact.create({
        firstName, lastName: rest.join(" ") || undefined,
        email: lead.email, phone: lead.phone, whatsApp: lead.whatsApp, designation: lead.designation,
        linkedIn: lead.linkedIn, country: lead.country, state: lead.state, city: lead.city,
        company: company?._id, isDecisionMaker: false, createdBy: req.admin._id,
      });
      contactCreated = true;
    } else if (company && !contact.company) {
      contact.company = company._id;
      await contact.save();
    }

    const title = typeof req.body.title === "string" && req.body.title.trim()
      ? req.body.title.trim()
      : `${lead.company || lead.name} — ${lead.interest ? lead.interest.slice(0, 60) : "Training"}`;
    const value = Number.isFinite(Number(req.body.value)) && req.body.value !== "" && req.body.value != null
      ? Number(req.body.value)
      : lead.expectedRevenue ?? lead.budget ?? 0;

    const deal = await CRMDeal.create({
      title, value, currency: lead.currency || "INR",
      pipeline: pipeline._id, stageKey: stage.key, stageOrder: stage.order ?? 0,
      probability: stage.probability ?? lead.probability ?? 20,
      status: stage.isWon ? "won" : stage.isLost ? "lost" : "open",
      ...(stage.isWon && { wonAt: new Date() }), ...(stage.isLost && { lostAt: new Date() }),
      lead: lead._id, contact: contact._id, company: company?._id,
      assignedTo: lead.assignedTo || req.admin._id, createdBy: req.admin._id,
    });

    lead.contactId = contact._id;
    if (company) lead.companyId = company._id;
    lead.dealId = deal._id;
    lead.pipeline = pipeline._id;
    lead.pipelineStage = stage.key;
    await lead.save();

    await Promise.all([
      logActivity(lead._id, "note", "Converted to deal", `Deal "${deal.title}" created in ${pipeline.name}`, req.admin._id, { dealId: deal._id }),
      CRMActivity.create({ type: "created", title: "Deal created", body: `${deal.title} created from lead ${lead.name}`, relatedToType: "deal", relatedToId: deal._id, performedBy: req.admin._id }),
      contactCreated && CRMActivity.create({ type: "created", title: "Contact created", body: `${contact.firstName} created from lead ${lead.name}`, relatedToType: "contact", relatedToId: contact._id, performedBy: req.admin._id }),
    ]);

    res.status(201).json({
      success: true,
      data: { deal, contact, company: company || null, contactCreated, companyCreated },
      message: "Lead converted",
    });
  } catch (err) {
    sendCrmError(res, err, "Failed to convert lead");
  }
};

export const getLeadActivities = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    if (!scope || !(await CRMLead.exists(scope))) return notFound(res);

    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 30 });

    const [activities, total] = await Promise.all([
      CRMActivity.find({ relatedToType: "lead", relatedToId: req.params.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("performedBy", "name email")
        .lean(),
      CRMActivity.countDocuments({ relatedToType: "lead", relatedToId: req.params.id }),
    ]);

    res.json({ success: true, data: activities, meta: { page, limit, total } });
  } catch (err) {
    sendCrmError(res, err, "Failed to fetch activities");
  }
};

const EXPORT_LIMIT = 10000;

export const getLeadExport = async (req, res) => {
  try {
    const { status, assignedTo, source, priority } = req.query;
    if (assignedTo && !isValidId(assignedTo)) {
      return res.status(400).json({ success: false, message: "Invalid assignedTo id" });
    }
    const filter = { isDeleted: false, ...ownerFilter(req) };
    if (status)     filter.status     = status;
    if (source)     filter.source     = source;
    if (priority)   filter.priority   = priority;
    if (assignedTo && !filter.assignedTo) filter.assignedTo = assignedTo;

    const leads = await CRMLead.find(filter)
      .sort({ createdAt: -1 })
      .limit(EXPORT_LIMIT)
      .populate("assignedTo", "name email")
      .select("-notes -attachments -customFields -__v")
      .lean();

    const fields = ["name", "email", "phone", "company", "designation", "country", "state", "city",
      "source", "status", "priority", "leadScore", "budget", "teamSize", "industry",
      "expectedRevenue", "probability", "assignedTo", "createdAt"];

    const header = fields.join(",");
    const rows = leads.map((l) => fields.map((f) => {
      let v = f === "assignedTo" ? (l.assignedTo?.name || "") : (l[f] ?? "");
      if (v instanceof Date) v = v.toISOString();
      let s = String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    }).join(","));

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="crm-leads-${Date.now()}.csv"`);
    res.send([header, ...rows].join("\n"));
  } catch (err) {
    sendCrmError(res, err, "Export failed");
  }
};

export const importLeads = async (req, res) => {
  try {
    const { leads: rawLeads } = req.body;
    if (!Array.isArray(rawLeads) || rawLeads.length === 0) {
      return res.status(400).json({ success: false, message: "No leads provided" });
    }
    if (rawLeads.length > 1000) {
      return res.status(400).json({ success: false, message: "Max 1000 leads per import" });
    }

    // Plain-text columns only — refs, scores and ownership aren't importable.
    const allowed = ["name", "email", "phone", "whatsApp", "designation", "company", "country", "state", "city",
      "source", "website", "linkedIn", "interest", "budget", "currency", "teamSize", "industry",
      "priority", "expectedRevenue", "probability", "status", "nextFollowUp"];
    const text = (v) => (v == null ? undefined : String(v).trim() || undefined);
    const num = (v) => (v == null || String(v).trim() === "" ? undefined : Number(String(v).replace(/[^\d.-]/g, "")));

    // Admins may map an "owner email" column; otherwise leads go round-robin (admins) or to the importer.
    const ownerEmails = isCrmAdmin(req)
      ? [...new Set(rawLeads.map((r) => text(r?.ownerEmail)?.toLowerCase()).filter(Boolean))]
      : [];
    const owners = ownerEmails.length
      ? new Map((await CrmUser.find({ email: { $in: ownerEmails }, active: true }).select("email").lean()).map((u) => [u.email, u._id]))
      : new Map();

    // One query for every email/phone in the file, plus in-file duplicate tracking.
    const emails = rawLeads.map((r) => normEmail(text(r?.email))).filter(Boolean);
    const phones = rawLeads.map((r) => normalizePhone(text(r?.phone), text(r?.country))).filter(Boolean);
    const existing = await CRMLead.find({ isDeleted: false, $or: [{ email: { $in: emails } }, { phoneNormalized: { $in: phones } }] })
      .select("email phoneNormalized").lean();
    const seenEmails = new Set(existing.map((l) => l.email).filter(Boolean));
    const seenPhones = new Set(existing.map((l) => l.phoneNormalized).filter(Boolean));

    const results = { created: 0, skipped: 0, errors: [] };
    const toInsert = [];
    const nextOwner = isCrmAdmin(req) ? await createAssigner() : null;

    for (const [index, raw] of rawLeads.entries()) {
      const row = index + 1;
      if (!raw || typeof raw !== "object") { results.errors.push({ row, reason: "Not a row object" }); continue; }
      const fields = Object.fromEntries(Object.entries(pick(raw, allowed)).map(([k, v]) => [k,
        ["budget", "teamSize", "expectedRevenue", "probability"].includes(k) ? num(v) : text(v)]));
      fields.email = normEmail(fields.email);
      fields.source = fields.source ? fields.source.toLowerCase().replace(/\s+/g, "_") : "other";
      fields.status = fields.status ? fields.status.toLowerCase().replace(/\s+/g, "_") : "new";
      fields.priority = fields.priority ? fields.priority.toLowerCase() : "medium";

      if (!fields.name) { results.errors.push({ row, reason: "Missing name" }); continue; }
      if (SITE_SOURCES.includes(fields.source)) { results.errors.push({ row, reason: "Site-page source not allowed in CRM" }); continue; }

      const phoneKey = normalizePhone(fields.phone, fields.country);
      if ((fields.email && seenEmails.has(fields.email)) || (phoneKey && seenPhones.has(phoneKey))) { results.skipped++; continue; }

      const ownerEmail = text(raw.ownerEmail)?.toLowerCase();
      if (ownerEmail && isCrmAdmin(req) && !owners.has(ownerEmail)) {
        results.errors.push({ row, reason: `Unknown owner email: ${ownerEmail}` });
        continue;
      }
      const assignedTo = owners.get(ownerEmail) || (nextOwner ? nextOwner() || req.admin._id : req.admin._id);

      const doc = new CRMLead({ ...fields, assignedTo, createdBy: req.admin._id });
      const invalid = doc.validateSync();
      if (invalid) {
        results.errors.push({ row, reason: Object.values(invalid.errors)[0]?.message || "Invalid row" });
        continue;
      }
      if (fields.email) seenEmails.add(fields.email);
      if (phoneKey) seenPhones.add(phoneKey);
      toInsert.push(doc);
    }

    if (toInsert.length > 0) {
      const inserted = await CRMLead.insertMany(toInsert, { ordered: false });
      results.created = inserted.length;
      await CRMActivity.insertMany(inserted.map((l) => ({
        type: "created", title: "Lead imported", body: `${l.name} was imported from CSV`,
        relatedToType: "lead", relatedToId: l._id, performedBy: req.admin._id,
      })));
    }

    res.json({
      success: true,
      data: results,
      message: `Imported ${results.created} leads, skipped ${results.skipped} duplicates${results.errors.length ? `, ${results.errors.length} rows had errors` : ""}`,
    });
  } catch (err) {
    sendCrmError(res, err, "Import failed");
  }
};

export const aiLeadSummary = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope).populate("assignedTo", "name").lean();
    if (!lead) return notFound(res);

    const prompt = `You are a CRM assistant for TechnoHana, an AI Training & Corporate Learning company.
Summarize the following lead in 3-4 sentences for the sales team. Focus on: who they are, their training need, buying intent signals, and recommended next action.

Lead data:
Name: ${lead.name}
Company: ${lead.company || "Unknown"}
Designation: ${lead.designation || "Unknown"}
Location: ${[lead.city, lead.state, lead.country].filter(Boolean).join(", ") || "Unknown"}
Industry: ${lead.industry || "Unknown"}
Team Size: ${lead.teamSize || "Unknown"}
Budget: ${lead.budget ? `${lead.currency || "INR"} ${lead.budget.toLocaleString()}` : "Not specified"}
Interest: ${lead.interest || "Not specified"}
Source: ${lead.source}
Status: ${lead.status}
Lead Score: ${lead.leadScore ?? "Not scored"}
Expected Revenue: ${lead.expectedRevenue || "Not specified"}
Assigned To: ${lead.assignedTo?.name || "Unassigned"}
Created: ${new Date(lead.createdAt).toLocaleDateString()}

Write a concise, actionable summary for the sales rep.`;

    const { text: summary } = await callClaude({ system: "You are a helpful CRM assistant.", prompt, maxTokens: 300 });
    res.json({ success: true, data: { summary } });
  } catch (err) {
    sendCrmError(res, err, "AI summary failed");
  }
};

export const aiScoreLead = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope).lean();
    if (!lead) return notFound(res);

    const prompt = `You are a lead scoring AI for TechnoHana, an AI Training & Corporate Learning company.
Score this lead from 0-100 and classify as hot/warm/cold based on buying intent.

Lead:
- Company: ${lead.company || "N/A"}, Industry: ${lead.industry || "N/A"}
- Team Size: ${lead.teamSize || "N/A"}, Budget: ${lead.budget ? `${lead.currency} ${lead.budget}` : "N/A"}
- Interest: ${lead.interest || "N/A"}
- Source: ${lead.source}, Status: ${lead.status}
- Country: ${lead.country || "N/A"}
- Designation: ${lead.designation || "N/A"}

Rules:
- hot (70-100): clear budget + decision maker + active interest + corporate
- warm (40-69): some qualification signals but incomplete
- cold (0-39): minimal info, no budget, generic interest

Respond ONLY with valid JSON: {"score": <number>, "band": "<hot|warm|cold>", "reasoning": "<2 sentences>", "suggestedFollowUp": "<1 sentence action>"}`;

    const { text: raw } = await callClaude({ system: "You are a precise JSON-only lead scoring assistant.", prompt, maxTokens: 200 });

    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match?.[0] || raw);
    } catch {
      return res.status(500).json({ success: false, message: "AI response parsing failed" });
    }

    const score = Number(parsed.score);
    if (!Number.isFinite(score) || score < 0 || score > 100 || !["hot", "warm", "cold"].includes(parsed.band)) {
      return res.status(500).json({ success: false, message: "AI response failed validation" });
    }

    await CRMLead.updateOne({ _id: lead._id }, {
      aiScore: score,
      aiScoreBand: parsed.band,
      aiReasoning: parsed.reasoning,
      aiSuggestedFollowUp: parsed.suggestedFollowUp,
      aiScoredAt: new Date(),
    }, { runValidators: true });

    res.json({ success: true, data: parsed });
  } catch (err) {
    sendCrmError(res, err, "AI scoring failed");
  }
};

export const aiEmailDraft = async (req, res) => {
  try {
    const { leadId, tone = "professional", context = "" } = req.body;
    if (!leadId) return res.status(400).json({ success: false, message: "leadId is required" });

    const scope = leadScope(req, leadId);
    const lead = scope && await CRMLead.findOne(scope).lean();
    if (!lead) return notFound(res);

    const safeTone = ["professional", "friendly", "formal", "casual", "persuasive"].includes(tone) ? tone : "professional";
    const extra = typeof context === "string" ? context.slice(0, 1000) : "";

    const prompt = `Write a ${safeTone} follow-up email for this lead on behalf of TechnoHana's sales team.

Lead: ${lead.name}, ${lead.designation || ""} at ${lead.company || "their company"}
Interest: ${lead.interest || "AI/Corporate Training"}
Status: ${lead.status}
${extra ? `Additional context: ${extra}` : ""}

Write subject line and email body. Keep it concise (under 150 words). Focus on value, not features. End with a short closing line such as "Best regards," but no name or signature block — the sender's signature is added automatically. Output plain text only (no markdown, no ** or #); start with "Subject: ...".`;

    const { text } = await callClaude({ system: "You are a B2B sales email writer.", prompt, maxTokens: 1000 });
    const draft = text.replace(/\*\*/g, "");
    res.json({ success: true, data: { draft } });
  } catch (err) {
    sendCrmError(res, err, "AI email draft failed");
  }
};

export const draftProposal = async (req, res) => {
  try {
    const scope = leadScope(req, req.params.id);
    const lead = scope && await CRMLead.findOne(scope).populate("assignedTo", "name email").lean();
    if (!lead) return notFound(res);

    // Compute server-side pricing for the recommended courses / team size
    let pricingContext = "";
    if (lead.recommendedCourses?.length > 0 && lead.currency && lead.teamSize) {
      const enrollmentType = lead.teamSize >= 2 ? "group" : "individual";
      const snippets = [];
      for (const { courseId, courseTitle } of lead.recommendedCourses.slice(0, 5)) {
        if (!courseId) continue;
        try {
          const quote = await computeQuote({
            courseId,
            enrollmentType,
            participants: lead.teamSize,
            currency: (lead.currency || "INR").toLowerCase(),
          });
          const symbol = { inr: "₹", usd: "$", aed: "AED", gbp: "£", eur: "€" }[quote.currency] || "";
          const totalMajor = (quote.expectedTotalMinor / 100).toLocaleString();
          snippets.push(`${courseTitle || `Course ${courseId}`}: ${symbol}${totalMajor} total for ${lead.teamSize} participants (${quote.discountPercent}% group discount applied)`);
        } catch {
          // skip courses that can't be priced
        }
      }
      if (snippets.length) pricingContext = `\n\nPricing (server-computed):\n${snippets.join("\n")}`;
    }

    const prompt = `You are a B2B sales proposal writer for TechnoHana, an AI Training & Corporate Learning company.
Draft a professional training proposal for this client.

Client: ${lead.name}, ${lead.designation || "Decision Maker"} at ${lead.company || "their company"}
Industry: ${lead.industry || "N/A"}
Team Size: ${lead.teamSize || "N/A"} participants
Budget: ${lead.budget ? `${lead.currency || "INR"} ${lead.budget.toLocaleString()}` : "To be discussed"}
Training Need: ${lead.interest || "AI and digital skills training"}
Skill Gap Data: ${lead.skillGapData ? JSON.stringify(lead.skillGapData) : "Not assessed"}
Recommended Courses: ${(lead.recommendedCourses || []).map((c) => c.courseTitle || c.courseId).filter(Boolean).join(", ") || "To be recommended"}${pricingContext}

Write a structured proposal with these sections:
1. Executive Summary (2-3 sentences)
2. Training Objectives (3 bullet points)
3. Recommended Program (1-2 sentences per recommended course)
4. Pricing Summary (use the pricing data provided above if available, otherwise say "pricing available on request")
5. Next Steps (3 bullet points)

Format as clean HTML using only: <h3>, <p>, <ul>, <li>, <strong>, <br>.
Keep total length under 400 words. Sign as "TechnoHana Corporate Learning Team".`;

    const { text: html } = await callClaude({
      system: "You are a professional B2B proposal writer for a corporate training company.",
      prompt,
      maxTokens: 800,
    });

    await logActivity(
      lead._id, "ai_draft", "AI Proposal Draft Generated",
      `Draft generated by ${req.admin.name || req.admin.email}`,
      req.admin._id
    );

    res.json({ success: true, data: { html, leadName: lead.name, company: lead.company }, message: "Proposal draft generated" });
  } catch (err) {
    sendCrmError(res, err, "Proposal generation failed");
  }
};

// POST /ai/ask — free-form question for the sales assistant, optionally about one
// lead the caller can see (its details and recent activity go in as context).
export const aiAsk = async (req, res) => {
  try {
    const { question, leadId } = req.body;
    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ success: false, message: "Ask a question" });
    }
    if (question.length > 2000) return res.status(400).json({ success: false, message: "Question is too long" });

    let leadContext = "No specific lead selected.";
    if (leadId) {
      const scope = leadScope(req, leadId);
      const lead = scope && await CRMLead.findOne(scope).lean();
      if (!lead) return notFound(res);
      const recent = await CRMActivity.find({ relatedToType: "lead", relatedToId: lead._id })
        .sort({ createdAt: -1 }).limit(10).select("type title body createdAt").lean();
      leadContext = `Lead: ${lead.name}${lead.designation ? `, ${lead.designation}` : ""}${lead.company ? ` at ${lead.company}` : ""}
Status: ${lead.status} · Priority: ${lead.priority} · Source: ${lead.source}
Industry: ${lead.industry || "N/A"} · Team size: ${lead.teamSize || "N/A"} · Budget: ${lead.budget ? `${lead.currency || "INR"} ${lead.budget}` : "N/A"}
Interest: ${lead.interest || "N/A"}
Next follow-up: ${lead.nextFollowUp ? new Date(lead.nextFollowUp).toDateString() : "not set"}
Recent activity (newest first):
${recent.map((a) => `- ${new Date(a.createdAt).toDateString()} ${a.type}: ${(a.title || "")} ${(a.body || "").slice(0, 200)}`).join("\n") || "- none"}`;
    }

    const prompt = `You help TechnoHana's sales team (AI & corporate training) work their CRM.
Answer the rep's question concisely and practically. Use only the context below for facts about the lead; say so if something isn't known rather than guessing.

${leadContext}

Question: ${question.trim()}`;

    const { text } = await callClaude({ system: "You are a pragmatic B2B sales assistant inside a CRM.", prompt, maxTokens: 700 });
    res.json({ success: true, data: { answer: text } });
  } catch (err) {
    sendCrmError(res, err, "AI request failed");
  }
};
