import express from "express";
import { authenticateJWT } from "../middleware/authenticateJWT.js";
import { saveReport, getMyReports, deleteReport } from "../controllers/aiToolReport.controller.js";

const router = express.Router();

router.post("/save", authenticateJWT, saveReport);
router.get("/mine", authenticateJWT, getMyReports);
router.delete("/:id", authenticateJWT, deleteReport);

export default router;
