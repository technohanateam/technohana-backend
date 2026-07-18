import mongoose from "mongoose";
import CRMLead from "../models/crm/crmLead.model.js";
import CRMActivity from "../models/crm/crmActivity.model.js";
import { callClaude } from "../services/aiAgent.service.js";
import { v2 as cloudinary } from "cloudinary";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

export const getLeads = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip  = (page - 1) * limit;

    const { search, status, assignedTo, source, priority, pipeline, aiScoreBand, sort = "createdAt", order = "desc" } = req.query;

    const role    = req.crmRole || req.admin.role;
    const adminId = req.admin._id;

    const filter = { isDeleted: false };

    // Sales reps only see their own leads
    if (role === "sales") filter.assignedTo = adminId;
    else if (assignedTo) filter.assignedTo = new mongoose.Types.ObjectId(assignedTo);

    if (status)      filter.status      = status;
    if (source)      filter.source      = source;
    if (priority)    filter.priority    = priority;
    if (pipeline)    filter.pipeline    = new mongoose.Types.ObjectId(pipeline);
    if (aiScoreBand) filter.aiScoreBand = aiScoreBand;

    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: re }, { email: re }, { phone: re }, { company: re }];
    }

    const sortObj = { [sort]: order === "asc" ? 1 : -1 };

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
    console.error("getLeads error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch leads" });
  }
};

export const getLead = async (req, res) => {
  try {
    const lead = await CRMLead.findOne({ _id: req.params.id, isDeleted: false })
      .populate("assignedTo", "name email")
      .populate("pipeline", "name type stages")
      .populate("tags", "name color")
      .populate("contactId", "firstName lastName email phone")
      .populate("companyId", "name industry")
      .populate("dealId", "title value status stageKey")
      .lean();

    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const activities = await CRMActivity.find({ relatedToType: "lead", relatedToId: lead._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("performedBy", "name")
      .lean();

    res.json({ success: true, data: { ...lead, activities } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch lead" });
  }
};

export const createLead = async (req, res) => {
  try {
    const {
      name, email, phone, whatsApp, designation, company,
      country, state, city, source, website, linkedIn, utm,
      interest, budget, currency, teamSize, industry,
      priority, expectedRevenue, probability,
      status, pipeline, pipelineStage, assignedTo, tags, customFields,
    } = req.body;

    if (!name) return res.status(400).json({ success: false, message: "Name is required" });

    // Duplicate detection by email
    if (email) {
      const existing = await CRMLead.findOne({ email: email.toLowerCase().trim(), isDeleted: false });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "A lead with this email already exists",
          data: { existingId: existing._id },
        });
      }
    }

    const lead = await CRMLead.create({
      name, email, phone, whatsApp, designation, company,
      country, state, city, source, website, linkedIn, utm,
      interest, budget, currency, teamSize, industry,
      priority, expectedRevenue, probability,
      status: status || "new",
      pipeline, pipelineStage,
      assignedTo: assignedTo || req.admin._id,
      tags, customFields,
      createdBy: req.admin._id,
    });

    await logActivity(lead._id, "created", "Lead created", `${name} was added to the CRM`, req.admin._id);

    res.status(201).json({ success: true, data: lead, message: "Lead created" });
  } catch (err) {
    console.error("createLead error:", err);
    res.status(500).json({ success: false, message: "Failed to create lead" });
  }
};

export const updateLead = async (req, res) => {
  try {
    const lead = await CRMLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const prevStatus = lead.status;
    const prevStage  = lead.pipelineStage;

    const allowed = [
      "name", "email", "phone", "whatsApp", "designation", "company",
      "country", "state", "city", "source", "website", "linkedIn",
      "interest", "budget", "currency", "teamSize", "industry",
      "priority", "leadScore", "expectedRevenue", "probability",
      "status", "lostReason", "pipeline", "pipelineStage", "assignedTo",
      "nextFollowUp", "contactId", "companyId", "dealId", "proposalId",
      "tags", "customFields", "skillGapData", "recommendedCourses",
    ];

    allowed.forEach((f) => { if (req.body[f] !== undefined) lead[f] = req.body[f]; });

    if (req.body.status === "won" && prevStatus !== "won") lead.wonAt = new Date();
    if (req.body.status === "lost" && prevStatus !== "lost") lead.lostAt = new Date();

    await lead.save();

    // Log status/stage changes
    if (req.body.status && req.body.status !== prevStatus) {
      await logActivity(lead._id, "status_change", "Status changed",
        `Status changed from ${prevStatus} to ${req.body.status}`,
        req.admin._id, { from: prevStatus, to: req.body.status });
    }
    if (req.body.pipelineStage && req.body.pipelineStage !== prevStage) {
      await logActivity(lead._id, "stage_change", "Stage moved",
        `Moved from ${prevStage || "—"} to ${req.body.pipelineStage}`,
        req.admin._id, { from: prevStage, to: req.body.pipelineStage });
    }

    res.json({ success: true, data: lead, message: "Lead updated" });
  } catch (err) {
    console.error("updateLead error:", err);
    res.status(500).json({ success: false, message: "Failed to update lead" });
  }
};

export const deleteLead = async (req, res) => {
  try {
    const lead = await CRMLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    lead.isDeleted = true;
    lead.deletedAt = new Date();
    await lead.save();

    res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete lead" });
  }
};

export const bulkLeadAction = async (req, res) => {
  try {
    const { action, ids, payload } = req.body;
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "action and ids are required" });
    }

    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

    if (action === "delete") {
      await CRMLead.updateMany({ _id: { $in: objectIds } }, { isDeleted: true, deletedAt: new Date() });
      return res.json({ success: true, message: `${ids.length} leads deleted` });
    }

    if (action === "assign" && payload?.assignedTo) {
      await CRMLead.updateMany({ _id: { $in: objectIds }, isDeleted: false }, { assignedTo: payload.assignedTo });
      return res.json({ success: true, message: `${ids.length} leads reassigned` });
    }

    if (action === "status" && payload?.status) {
      await CRMLead.updateMany({ _id: { $in: objectIds }, isDeleted: false }, { status: payload.status });
      return res.json({ success: true, message: `${ids.length} leads status updated` });
    }

    if (action === "priority" && payload?.priority) {
      await CRMLead.updateMany({ _id: { $in: objectIds }, isDeleted: false }, { priority: payload.priority });
      return res.json({ success: true, message: `${ids.length} leads priority updated` });
    }

    res.status(400).json({ success: false, message: "Unknown bulk action" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Bulk action failed" });
  }
};

export const mergeLead = async (req, res) => {
  try {
    const { targetId } = req.body;
    const sourceId = req.params.id;

    if (sourceId === targetId) {
      return res.status(400).json({ success: false, message: "Cannot merge a lead with itself" });
    }

    const [source, target] = await Promise.all([
      CRMLead.findOne({ _id: sourceId, isDeleted: false }),
      CRMLead.findOne({ _id: targetId, isDeleted: false }),
    ]);

    if (!source || !target) return res.status(404).json({ success: false, message: "Lead not found" });

    // Merge non-null fields from source into target
    const mergeFields = ["phone", "whatsApp", "designation", "company", "country", "state", "city",
      "website", "linkedIn", "interest", "budget", "teamSize", "industry", "priority",
      "expectedRevenue", "probability", "tags", "customFields"];

    mergeFields.forEach((f) => {
      if (!target[f] && source[f]) target[f] = source[f];
    });

    // Move activities
    await CRMActivity.updateMany(
      { relatedToType: "lead", relatedToId: source._id },
      { relatedToId: target._id }
    );

    // Soft-delete source
    source.isDeleted  = true;
    source.deletedAt  = new Date();
    source.isDuplicate = true;
    source.mergedInto = target._id;
    await source.save();
    await target.save();

    await logActivity(target._id, "created", "Lead merged",
      `Lead ${source.name} (${source.email || source._id}) was merged into this record`,
      req.admin._id);

    res.json({ success: true, data: target, message: "Leads merged" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Merge failed" });
  }
};

export const addNote = async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: "Note body is required" });

    const lead = await CRMLead.findOne({ _id: req.params.id, isDeleted: false });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    lead.notes.push({ body: body.trim(), createdBy: req.admin._id });
    await lead.save();

    await logActivity(lead._id, "note", "Note added", body.trim(), req.admin._id);

    res.json({ success: true, data: lead.notes[lead.notes.length - 1], message: "Note added" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to add note" });
  }
};

export const getLeadActivities = async (req, res) => {
  try {
    const lead = await CRMLead.findOne({ _id: req.params.id, isDeleted: false }).lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const skip  = (page - 1) * limit;

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
    res.status(500).json({ success: false, message: "Failed to fetch activities" });
  }
};

export const getLeadExport = async (req, res) => {
  try {
    const { status, assignedTo, source, priority } = req.query;
    const filter = { isDeleted: false };
    if (status)     filter.status     = status;
    if (source)     filter.source     = source;
    if (priority)   filter.priority   = priority;
    if (assignedTo) filter.assignedTo = new mongoose.Types.ObjectId(assignedTo);

    const leads = await CRMLead.find(filter)
      .populate("assignedTo", "name email")
      .select("-notes -attachments -customFields -__v")
      .lean();

    // CSV generation
    const fields = ["name", "email", "phone", "company", "designation", "country", "state", "city",
      "source", "status", "priority", "leadScore", "budget", "teamSize", "industry",
      "expectedRevenue", "probability", "assignedTo", "createdAt"];

    const header = fields.join(",");
    const rows = leads.map((l) => {
      return fields.map((f) => {
        let v = f === "assignedTo" ? (l.assignedTo?.name || "") : (l[f] ?? "");
        if (v instanceof Date) v = v.toISOString();
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(",");
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="crm-leads-${Date.now()}.csv"`);
    res.send([header, ...rows].join("\n"));
  } catch (err) {
    res.status(500).json({ success: false, message: "Export failed" });
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

    const results = { created: 0, skipped: 0, errors: [] };
    const toInsert = [];

    for (const raw of rawLeads) {
      if (!raw.name) { results.errors.push({ row: raw, reason: "Missing name" }); continue; }

      if (raw.email) {
        const exists = await CRMLead.exists({ email: raw.email.toLowerCase().trim(), isDeleted: false });
        if (exists) { results.skipped++; continue; }
      }

      toInsert.push({ ...raw, createdBy: req.admin._id, assignedTo: raw.assignedTo || req.admin._id });
    }

    if (toInsert.length > 0) {
      const inserted = await CRMLead.insertMany(toInsert, { ordered: false });
      results.created = inserted.length;
    }

    res.json({ success: true, data: results, message: `Imported ${results.created} leads, skipped ${results.skipped} duplicates` });
  } catch (err) {
    console.error("importLeads error:", err);
    res.status(500).json({ success: false, message: "Import failed" });
  }
};

export const aiLeadSummary = async (req, res) => {
  try {
    const lead = await CRMLead.findOne({ _id: req.params.id, isDeleted: false })
      .populate("assignedTo", "name")
      .lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

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

    const summary = await callClaude({ system: "You are a helpful CRM assistant.", prompt, maxTokens: 300 });
    res.json({ success: true, data: { summary } });
  } catch (err) {
    res.status(500).json({ success: false, message: "AI summary failed" });
  }
};

export const aiScoreLead = async (req, res) => {
  try {
    const lead = await CRMLead.findOne({ _id: req.params.id, isDeleted: false }).lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

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

    const raw = await callClaude({ system: "You are a precise JSON-only lead scoring assistant.", prompt, maxTokens: 200 });

    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match?.[0] || raw);
    } catch {
      return res.status(500).json({ success: false, message: "AI response parsing failed" });
    }

    await CRMLead.updateOne({ _id: lead._id }, {
      aiScore: parsed.score,
      aiScoreBand: parsed.band,
      aiReasoning: parsed.reasoning,
      aiSuggestedFollowUp: parsed.suggestedFollowUp,
      aiScoredAt: new Date(),
    });

    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, message: "AI scoring failed" });
  }
};

export const aiEmailDraft = async (req, res) => {
  try {
    const { leadId, tone = "professional", context = "" } = req.body;
    if (!leadId) return res.status(400).json({ success: false, message: "leadId is required" });

    const lead = await CRMLead.findOne({ _id: leadId, isDeleted: false }).lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const prompt = `Write a ${tone} follow-up email for this lead on behalf of TechnoHana's sales team.

Lead: ${lead.name}, ${lead.designation || ""} at ${lead.company || "their company"}
Interest: ${lead.interest || "AI/Corporate Training"}
Status: ${lead.status}
${context ? `Additional context: ${context}` : ""}

Write subject line and email body. Keep it concise (under 150 words). Focus on value, not features. Sign as "TechnoHana Sales Team".`;

    const draft = await callClaude({ system: "You are a B2B sales email writer.", prompt, maxTokens: 400 });
    res.json({ success: true, data: { draft } });
  } catch (err) {
    res.status(500).json({ success: false, message: "AI email draft failed" });
  }
};
