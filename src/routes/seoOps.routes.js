import express from "express";
import { authenticateAdmin, requirePage, requireMarketing } from "../middleware/authenticateAdmin.js";

import { getSeoDashboard } from "../controllers/seoDashboard.controller.js";
import {
  getAllOpportunities,
  getCompetitorGap,
  getResourcePages,
  getOpportunity,
  updateOpportunity,
  bulkUpdateOpportunities,
  importOpportunities,
} from "../controllers/seoOpportunity.controller.js";
import {
  getContacts,
  createContact,
  updateContact,
  archiveContact,
  addFollowUp,
  addResponse,
  getCampaigns,
  createCampaign,
  updateCampaign,
  archiveCampaign,
  importContacts,
} from "../controllers/seoOutreach.controller.js";
import {
  getMonitoring,
  getPublishedLinks,
  createMonitoringRecord,
  updateMonitoringRecord,
} from "../controllers/seoMonitoring.controller.js";
import { getReports, previewReport, downloadReport } from "../controllers/seoReport.controller.js";
import { getSettings, updateSettings } from "../controllers/seoSettings.controller.js";
import { validateCsv, checkDuplicates, scoreOpportunities, generateMonthlyReport } from "../controllers/seoScripts.controller.js";
import { runVerification, getVerificationStatus } from "../controllers/seoBacklinkVerification.controller.js";

const router = express.Router();

// All /admin/seo/* routes require an authenticated admin plus the relevant page grant.
router.use(authenticateAdmin);

// ── Dashboard ────────────────────────────────────────────────────────────
router.get("/dashboard", requirePage("seo-ops-dashboard"), getSeoDashboard);

// ── Opportunities ────────────────────────────────────────────────────────
// NOTE: "/bulk" and "/import" must be registered before "/:id" — otherwise
// Express matches the wildcard route first (id="bulk"/"import") and the
// specific routes below become unreachable.
router.get("/opportunities", requirePage("seo-ops-opportunities"), getAllOpportunities);
router.patch("/opportunities/bulk", requirePage("seo-ops-opportunities"), requireMarketing, bulkUpdateOpportunities);
router.post("/opportunities/import", requirePage("seo-ops-opportunities"), requireMarketing, importOpportunities);
router.get("/opportunities/:id", requirePage("seo-ops-opportunities"), getOpportunity);
router.patch("/opportunities/:id", requirePage("seo-ops-opportunities"), requireMarketing, updateOpportunity);

// ── Competitors (filtered opportunities view) ───────────────────────────
router.get("/competitors", requirePage("seo-ops-competitors"), getCompetitorGap);

// ── Resource Pages (filtered opportunities view) ────────────────────────
router.get("/resource-pages", requirePage("seo-ops-resource-pages"), getResourcePages);
router.get("/resource-pages/:id", requirePage("seo-ops-resource-pages"), getOpportunity);
router.patch("/resource-pages/:id", requirePage("seo-ops-resource-pages"), requireMarketing, updateOpportunity);

// ── Outreach CRM ─────────────────────────────────────────────────────────
router.get("/outreach/contacts", requirePage("seo-ops-outreach"), getContacts);
router.post("/outreach/contacts", requirePage("seo-ops-outreach"), requireMarketing, createContact);
router.patch("/outreach/contacts/:id", requirePage("seo-ops-outreach"), requireMarketing, updateContact);
router.patch("/outreach/contacts/:id/archive", requirePage("seo-ops-outreach"), requireMarketing, archiveContact);
router.post("/outreach/contacts/:id/followups", requirePage("seo-ops-outreach"), requireMarketing, addFollowUp);
router.post("/outreach/contacts/:id/responses", requirePage("seo-ops-outreach"), requireMarketing, addResponse);
router.post("/outreach/contacts/import", requirePage("seo-ops-outreach"), requireMarketing, importContacts);

router.get("/outreach/campaigns", requirePage("seo-ops-outreach"), getCampaigns);
router.post("/outreach/campaigns", requirePage("seo-ops-outreach"), requireMarketing, createCampaign);
router.patch("/outreach/campaigns/:id", requirePage("seo-ops-outreach"), requireMarketing, updateCampaign);
router.patch("/outreach/campaigns/:id/archive", requirePage("seo-ops-outreach"), requireMarketing, archiveCampaign);

// ── Published Links (filtered monitoring view) ──────────────────────────
router.get("/published-links", requirePage("seo-ops-published-links"), getPublishedLinks);

// ── Monitoring ───────────────────────────────────────────────────────────
router.get("/monitoring", requirePage("seo-ops-monitoring"), getMonitoring);
router.post("/monitoring", requirePage("seo-ops-monitoring"), requireMarketing, createMonitoringRecord);
router.post("/monitoring/verify", requirePage("seo-ops-monitoring"), requireMarketing, runVerification);
router.get("/monitoring/verify/status/:jobId", requirePage("seo-ops-monitoring"), getVerificationStatus);
router.patch("/monitoring/:id", requirePage("seo-ops-monitoring"), requireMarketing, updateMonitoringRecord);

// ── Reports ──────────────────────────────────────────────────────────────
router.get("/reports", requirePage("seo-ops-reports"), getReports);
router.get("/reports/:id/preview", requirePage("seo-ops-reports"), previewReport);
router.get("/reports/:id/download", requirePage("seo-ops-reports"), downloadReport);

// ── Settings ─────────────────────────────────────────────────────────────
router.get("/settings", requirePage("seo-ops-settings"), getSettings);
router.patch("/settings", requirePage("seo-ops-settings"), requireMarketing, updateSettings);

// ── Script actions (run against MongoDB — see seoOpsScripts.service.js) ────
router.post("/scripts/validate", requirePage("seo-ops-settings"), requireMarketing, validateCsv);
router.post("/scripts/duplicates", requirePage("seo-ops-settings"), requireMarketing, checkDuplicates);
router.post("/scripts/score", requirePage("seo-ops-settings"), requireMarketing, scoreOpportunities);
router.post("/scripts/generate-report", requirePage("seo-ops-reports"), requireMarketing, generateMonthlyReport);

export default router;
