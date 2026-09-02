import express from "express";
import { authenticateAdmin, requireAdmin, requireMarketing, requirePage } from "../middleware/authenticateAdmin.js";
import {
  listPosts,
  getPost,
  createPost,
  submitResponse,
  updatePost,
  approvePost,
  rejectPost,
  schedulePost,
  deletePost,
} from "../controllers/socialFactory/socialPost.controller.js";

const router = express.Router();

// Every route requires admin-panel auth + the social-factory page permission.
router.use(authenticateAdmin, requirePage("social-factory"));

router.get("/posts", requireMarketing, listPosts);
router.post("/posts", requireMarketing, createPost);
router.get("/posts/:id", requireMarketing, getPost);
router.patch("/posts/:id", requireMarketing, updatePost);
router.post("/posts/:id/submit-response", requireMarketing, submitResponse);
router.post("/posts/:id/approve", requireMarketing, approvePost);
router.post("/posts/:id/reject", requireMarketing, rejectPost);
router.post("/posts/:id/schedule", requireMarketing, schedulePost);
router.delete("/posts/:id", requireAdmin, deletePost);

export default router;
