import { Router } from "express";
import { crmRead, crmWrite, crmDelete } from "../middleware/crmPermission.js";

import { getDashboardStats, getFunnelData, getLeadSourcesBreakdown, getAnalytics, getCalendarEvents } from "../controllers/crmDashboard.controller.js";
import {
  getLeads, getLead, createLead, updateLead, deleteLead,
  bulkLeadAction, mergeLead, addNote, getLeadActivities,
  getLeadExport, importLeads, aiLeadSummary, aiScoreLead, aiEmailDraft,
  createLeadFromEnquiry,
} from "../controllers/crmLead.controller.js";
import {
  getContacts, getContact, createContact, updateContact, deleteContact,
  addContactNote, getContactActivities,
} from "../controllers/crmContact.controller.js";
import {
  getCompanies, getCompany, createCompany, updateCompany, deleteCompany, addCompanyNote,
} from "../controllers/crmCompany.controller.js";
import {
  getDeals, getDeal, createDeal, updateDeal, moveDealStage, deleteDeal, addDealNote,
} from "../controllers/crmDeal.controller.js";
import {
  getPipelines, getPipeline, createPipeline, updatePipeline, deletePipeline,
} from "../controllers/crmPipeline.controller.js";
import {
  getTasks, getTask, createTask, updateTask, deleteTask, addComment, toggleChecklistItem,
} from "../controllers/crmTask.controller.js";
import {
  getActivities, logActivity, getTags, createTag, deleteTag,
} from "../controllers/crmActivity.controller.js";

const router = Router();

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/dashboard/stats",   crmRead("dashboard"),  getDashboardStats);
router.get("/dashboard/funnel",  crmRead("dashboard"),  getFunnelData);
router.get("/dashboard/sources", crmRead("dashboard"),  getLeadSourcesBreakdown);
router.get("/analytics",         crmRead("dashboard"),  getAnalytics);
router.get("/calendar",          crmRead("dashboard"),  getCalendarEvents);

// ── Leads ─────────────────────────────────────────────────────────────────────
router.post("/leads/from-enquiry/:enquiryId", crmWrite("leads"), createLeadFromEnquiry);
router.get("/leads/export",         crmRead("leads"),         getLeadExport);
router.post("/leads/import",        crmWrite("leads"),        importLeads);
router.post("/leads/bulk",          crmWrite("leads"),        bulkLeadAction);
router.get("/leads",                crmRead("leads"),         getLeads);
router.post("/leads",               crmWrite("leads"),        createLead);
router.get("/leads/:id",            crmRead("leads"),         getLead);
router.put("/leads/:id",            crmWrite("leads"),        updateLead);
router.delete("/leads/:id",         crmDelete("leads"),       deleteLead);
router.post("/leads/:id/merge",     crmWrite("leads"),        mergeLead);
router.post("/leads/:id/notes",     crmWrite("leads"),        addNote);
router.get("/leads/:id/activities", crmRead("leads"),         getLeadActivities);

// ── AI on Leads ───────────────────────────────────────────────────────────────
router.get("/leads/:id/ai-summary", crmRead("ai"),   aiLeadSummary);
router.post("/leads/:id/ai-score",  crmWrite("ai"),  aiScoreLead);
router.post("/ai/email-draft",      crmWrite("ai"),  aiEmailDraft);

// ── Contacts ──────────────────────────────────────────────────────────────────
router.get("/contacts",                  crmRead("contacts"),   getContacts);
router.post("/contacts",                 crmWrite("contacts"),  createContact);
router.get("/contacts/:id",              crmRead("contacts"),   getContact);
router.put("/contacts/:id",              crmWrite("contacts"),  updateContact);
router.delete("/contacts/:id",           crmDelete("contacts"), deleteContact);
router.post("/contacts/:id/notes",       crmWrite("contacts"),  addContactNote);
router.get("/contacts/:id/activities",   crmRead("contacts"),   getContactActivities);

// ── Companies ─────────────────────────────────────────────────────────────────
router.get("/companies",              crmRead("companies"),   getCompanies);
router.post("/companies",             crmWrite("companies"),  createCompany);
router.get("/companies/:id",          crmRead("companies"),   getCompany);
router.put("/companies/:id",          crmWrite("companies"),  updateCompany);
router.delete("/companies/:id",       crmDelete("companies"), deleteCompany);
router.post("/companies/:id/notes",   crmWrite("companies"),  addCompanyNote);

// ── Deals ─────────────────────────────────────────────────────────────────────
router.get("/deals",                crmRead("deals"),   getDeals);
router.post("/deals",               crmWrite("deals"),  createDeal);
router.get("/deals/:id",            crmRead("deals"),   getDeal);
router.put("/deals/:id",            crmWrite("deals"),  updateDeal);
router.delete("/deals/:id",         crmDelete("deals"), deleteDeal);
router.patch("/deals/:id/stage",    crmWrite("deals"),  moveDealStage);
router.post("/deals/:id/notes",     crmWrite("deals"),  addDealNote);

// ── Pipelines ─────────────────────────────────────────────────────────────────
router.get("/pipelines",        crmRead("pipelines"),   getPipelines);
router.post("/pipelines",       crmWrite("pipelines"),  createPipeline);
router.get("/pipelines/:id",    crmRead("pipelines"),   getPipeline);
router.put("/pipelines/:id",    crmWrite("pipelines"),  updatePipeline);
router.delete("/pipelines/:id", crmDelete("pipelines"), deletePipeline);

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get("/tasks",                         crmRead("tasks"),   getTasks);
router.post("/tasks",                        crmWrite("tasks"),  createTask);
router.get("/tasks/:id",                     crmRead("tasks"),   getTask);
router.put("/tasks/:id",                     crmWrite("tasks"),  updateTask);
router.delete("/tasks/:id",                  crmDelete("tasks"), deleteTask);
router.post("/tasks/:id/comments",           crmWrite("tasks"),  addComment);
router.patch("/tasks/:id/checklist/:itemId", crmWrite("tasks"),  toggleChecklistItem);

// ── Activities ────────────────────────────────────────────────────────────────
router.get("/activities",  crmRead("activities"),  getActivities);
router.post("/activities", crmWrite("activities"), logActivity);

// ── Tags ──────────────────────────────────────────────────────────────────────
router.get("/tags",        crmRead("tags"),   getTags);
router.post("/tags",       crmWrite("tags"),  createTag);
router.delete("/tags/:id", crmDelete("tags"), deleteTag);

export default router;
