import express from "express";
import { authenticateAdmin, requirePage, requireMarketing, requireAdmin } from "../middleware/authenticateAdmin.js";
import {
  listClusters,
  getCluster,
  createCluster,
  updateCluster,
  deleteCluster,
  suggestClusterMembers,
} from "../controllers/seoTopicCluster.controller.js";

const router = express.Router();

router.use(authenticateAdmin);

router.get("/", requirePage("seo-topic-clusters"), listClusters);
router.post("/", requirePage("seo-topic-clusters"), requireMarketing, createCluster);
router.get("/:id", requirePage("seo-topic-clusters"), getCluster);
router.put("/:id", requirePage("seo-topic-clusters"), requireMarketing, updateCluster);
router.delete("/:id", requirePage("seo-topic-clusters"), requireAdmin, deleteCluster);
router.get("/:id/suggest-members", requirePage("seo-topic-clusters"), requireMarketing, suggestClusterMembers);

export default router;
