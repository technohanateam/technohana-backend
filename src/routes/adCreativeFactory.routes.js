import express from "express";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import { adCreativeFactoryAiLimiter } from "../middleware/adCreativeFactoryAiLimiter.js";

import { getSettings, updateSettings, toggleAutomation } from "../controllers/adCreativeFactory/adCreativeFactorySettings.controller.js";
import { listOpportunities, getOpportunity, createOpportunity, rejectOpportunity } from "../controllers/adCreativeFactory/adCreativeOpportunity.controller.js";
import { generateOpportunityCreative, getGenerationJob, retryGenerationJob, submitStepResponse } from "../controllers/adCreativeFactory/adCreativeGeneration.controller.js";
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
} from "../controllers/adCreativeFactory/humanReview.controller.js";
import { getUsage } from "../controllers/adCreativeFactory/costControls.controller.js";

const router = express.Router();

// Every route requires admin-panel auth + the ad-creative-factory page permission.
router.use(authenticateAdmin, requirePage("ad-creative-factory"));

// ── Settings ────────────────────────────────────────────────────────────────
router.get("/settings", requireMarketing, getSettings);
router.patch("/settings", requireAdmin, updateSettings);
router.post("/settings/toggle-automation", requireAdmin, toggleAutomation);

// ── Opportunities ───────────────────────────────────────────────────────────
router.get("/opportunities", requireMarketing, listOpportunities);
router.post("/opportunities", requireMarketing, createOpportunity);
router.get("/opportunities/:id", requireMarketing, getOpportunity);
router.patch("/opportunities/:id/reject", requireMarketing, rejectOpportunity);

// ── Generation ──────────────────────────────────────────────────────────────
router.post("/opportunities/:id/generate", requireMarketing, adCreativeFactoryAiLimiter, generateOpportunityCreative);
router.get("/jobs/:id", requireMarketing, getGenerationJob);
router.post("/jobs/:id/retry", requireMarketing, adCreativeFactoryAiLimiter, retryGenerationJob);
router.post("/jobs/:id/submit-step", requireMarketing, submitStepResponse);

// ── Human Review ────────────────────────────────────────────────────────────
router.get("/review", requireMarketing, listReviewItems);
router.get("/review/:opportunityId", requireMarketing, getReviewItem);
router.patch("/review/:opportunityId", requireMarketing, updateReviewDraft);
router.post("/review/:opportunityId/regenerate", requireMarketing, adCreativeFactoryAiLimiter, regenerateReview);
router.post("/review/:opportunityId/request-revision", requireMarketing, requestRevision);
router.post("/review/:opportunityId/request-revision/submit", requireMarketing, submitRevisionResponse);
router.post("/review/:opportunityId/reject", requireMarketing, rejectReviewItem);
router.post("/review/:opportunityId/approve", requireMarketing, approveReviewItem);

// ── Bulk Review Actions ─────────────────────────────────────────────────────
router.post("/review/bulk-approve", requireMarketing, bulkApproveReview);
router.post("/review/bulk-reject", requireMarketing, bulkRejectReview);
router.post("/review/bulk-regenerate", requireMarketing, adCreativeFactoryAiLimiter, bulkRegenerateReview);

// ── Cost Controls ───────────────────────────────────────────────────────────
router.get("/usage", requireAdmin, getUsage);

export default router;
