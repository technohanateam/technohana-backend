import express from "express";
import { getAllBlogs, getBlog, getBlogBySlug } from "../controllers/blog.controller.js";

const router = express.Router();

router.get("/blogs", getAllBlogs);
router.get("/blogs/:slug", getBlogBySlug);
router.get("/blog/:slug", getBlog);

export default router;
