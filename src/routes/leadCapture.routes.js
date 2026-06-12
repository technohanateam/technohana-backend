import express from "express";
import { capturePersonaLead } from "../controllers/leadCapture.controller.js";

const router = express.Router();

router.post("/lead-capture", capturePersonaLead);

export default router;
