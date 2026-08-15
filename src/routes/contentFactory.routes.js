import express from "express";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import { contentFactoryAiLimiter } from "../middleware/contentFactoryAiLimiter.js";

import { getSettings, updateSettings, toggleAutomation } from "../controllers/contentFactory/contentFactorySettings.controller.js";
import { listCourses, updateCourseSettings, recomputePriority } from "../controllers/contentFactory/courseIntelligence.controller.js";
import { listClusters, createCluster, updateCluster, deleteCluster, proposeMapping, applyMapping } from "../controllers/contentFactory/topicCluster.controller.js";
import { listOpportunities, getOpportunity, runDryRunPlan, listRuns, rejectOpportunity, overrideScore } from "../controllers/contentFactory/contentOpportunity.controller.js";
import { generateOpportunityArticle, getGenerationJob, retryGenerationJob, submitStepResponse } from "../controllers/contentFactory/contentGeneration.controller.js";
import {
  listReviewItems,
  getReviewItem,
  updateReviewDraft,
  regenerateReview,
  requestRevision,
  submitRevisionResponse,
  rejectReviewItem,
  approveReviewItem,
  bulkApproveReview,
  bulkRejectReview,
  bulkRegenerateReview,
} from "../controllers/contentFactory/humanReview.controller.js";
import { getCalendarHandler, scheduleHandler, rescheduleHandler, unscheduleHandler } from "../controllers/contentFactory/contentCalendar.controller.js";
import { getBacklogHandler } from "../controllers/contentFactory/contentBacklog.controller.js";
import { getUsage } from "../controllers/contentFactory/costControls.controller.js";
import { runPlanningNow } from "../controllers/contentFactory/planning.controller.js";
import { startManualTrendResearch, submitManualTrendResearchStep } from "../controllers/contentFactory/trendResearch.controller.js";

const router = express.Router();

// Every route requires admin-panel auth + the content-factory page permission.
router.use(authenticateAdmin, requirePage("content-factory"));

// ── Settings ────────────────────────────────────────────────────────────────
router.get("/settings", requireMarketing, getSettings);
router.patch("/settings", requireAdmin, updateSettings);
router.post("/settings/toggle-automation", requireAdmin, toggleAutomation);

// ── Course Intelligence ─────────────────────────────────────────────────────
router.get("/courses", requireMarketing, listCourses);
router.patch("/courses/:courseSlug", requireAdmin, updateCourseSettings);
router.post("/courses/recompute-priority", requireAdmin, contentFactoryAiLimiter, recomputePriority);

// ── Topic Clusters ──────────────────────────────────────────────────────────
router.get("/clusters", requireMarketing, listClusters);
router.post("/clusters", requireAdmin, createCluster);
router.patch("/clusters/:id", requireAdmin, updateCluster);
router.delete("/clusters/:id", requireAdmin, deleteCluster);
router.post("/clusters/propose-mapping", requireAdmin, contentFactoryAiLimiter, proposeMapping);
router.post("/clusters/apply-mapping", requireAdmin, applyMapping);

// ── Opportunities & Planning ─────────────────────────────────────────────────
router.get("/opportunities", requireMarketing, listOpportunities);
router.get("/opportunities/:id", requireMarketing, getOpportunity);
router.patch("/opportunities/:id/reject", requireMarketing, rejectOpportunity);
router.patch("/opportunities/:id/score", requireAdmin, overrideScore);
router.post("/plan/dry-run", requireAdmin, contentFactoryAiLimiter, runDryRunPlan);
router.get("/runs", requireMarketing, listRuns);

// ── Milestone 2: Content Generation ─────────────────────────────────────────
router.post("/opportunities/:id/generate", requireMarketing, contentFactoryAiLimiter, generateOpportunityArticle);
router.get("/jobs/:id", requireMarketing, getGenerationJob);
router.post("/jobs/:id/retry", requireMarketing, contentFactoryAiLimiter, retryGenerationJob);
router.post("/jobs/:id/submit-step", requireMarketing, submitStepResponse);

// ── Milestone 2: Human Review ────────────────────────────────────────────────
router.get("/review", requireMarketing, listReviewItems);
router.get("/review/:opportunityId", requireMarketing, getReviewItem);
router.patch("/review/:opportunityId", requireMarketing, updateReviewDraft);
router.post("/review/:opportunityId/regenerate", requireMarketing, contentFactoryAiLimiter, regenerateReview);
router.post("/review/:opportunityId/request-revision", requireMarketing, requestRevision);
router.post("/review/:opportunityId/request-revision/submit", requireMarketing, submitRevisionResponse);
router.post("/review/:opportunityId/reject", requireMarketing, rejectReviewItem);
router.post("/review/:opportunityId/approve", requireMarketing, approveReviewItem);

// ── Milestone 3: Bulk Review Actions ────────────────────────────────────────
router.post("/review/bulk-approve", requireMarketing, bulkApproveReview);
router.post("/review/bulk-reject", requireMarketing, bulkRejectReview);
router.post("/review/bulk-regenerate", requireMarketing, contentFactoryAiLimiter, bulkRegenerateReview);

// ── Milestone 4: Calendar ────────────────────────────────────────────────────
router.get("/calendar", requireMarketing, getCalendarHandler);
router.post("/calendar/:opportunityId/schedule", requireMarketing, scheduleHandler);
router.post("/calendar/:opportunityId/reschedule", requireMarketing, rescheduleHandler);
router.post("/calendar/:opportunityId/unschedule", requireMarketing, unscheduleHandler);

// ── Milestone 4: Backlog ─────────────────────────────────────────────────────
router.get("/backlog", requireMarketing, getBacklogHandler);

// ── Milestone 4: Cost Controls (financial data — admin only) ────────────────
router.get("/usage", requireAdmin, getUsage);

// ── Milestone 4: Manual planning trigger ─────────────────────────────────────
router.post("/plan/run-now", requireAdmin, runPlanningNow);

// ── Manual trend research (admin-triggered, manual Claude Pro workflow) ─────
router.post("/trend-research/start", requireAdmin, startManualTrendResearch);
router.post("/trend-research/step", requireAdmin, submitManualTrendResearchStep);

export default router;
