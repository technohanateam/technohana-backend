import express from "express";
import { authenticateAdmin, requirePage, requireMarketing, requireAdmin } from "../middleware/authenticateAdmin.js";
import { listAuthors, getAuthor, createAuthor, updateAuthor, deleteAuthor } from "../controllers/author.controller.js";

const router = express.Router();

router.use(authenticateAdmin);

router.get("/", requirePage("authors"), listAuthors);
router.post("/", requirePage("authors"), requireMarketing, createAuthor);
router.get("/:id", requirePage("authors"), getAuthor);
router.put("/:id", requirePage("authors"), requireMarketing, updateAuthor);
router.delete("/:id", requirePage("authors"), requireAdmin, deleteAuthor);

export default router;
