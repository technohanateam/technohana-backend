import express from "express";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import { contentFactoryAiLimiter } from "../middleware/contentFactoryAiLimiter.js";

import { getSettings, updateSettings, toggleAutomation } from "../controllers/contentFactory/contentFactorySettings.controller.js";
import { listCourses, updateCourseSettings, recomputePriority } from "../controllers/contentFactory/courseIntelligence.controller.js";
import { listClusters, createCluster, updateCluster, deleteCluster, proposeMapping, applyMapping } from "../controllers/contentFactory/topicCluster.controller.js";
import { listOpportunities, getOpportunity, runDryRunPlan, listRuns, rejectOpportunity, overrideScore } from "../controllers/contentFactory/contentOpportunity.controller.js";

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

export default router;
