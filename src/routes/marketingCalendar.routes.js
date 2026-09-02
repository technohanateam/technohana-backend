import express from "express";
import { authenticateAdmin, requirePage } from "../middleware/authenticateAdmin.js";
import { getCalendarHandler } from "../controllers/marketingCalendar/marketingCalendar.controller.js";

const router = express.Router();

// Read-only cross-factory view; gated on its own page key so it can be
// granted independently of any single factory's permissions.
router.use(authenticateAdmin, requirePage("marketing-calendar"));

router.get("/", getCalendarHandler);

export default router;
