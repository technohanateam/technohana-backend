import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { authenticateAdmin, requirePage } from "../middleware/authenticateAdmin.js";
import { keywordSearch } from "../services/globalSearch.service.js";
import { askDatabase } from "../services/globalSearchAi.service.js";
import { SearchQueryError } from "../utils/compileSearchQuery.js";
import { SEARCH_ENTITIES } from "../config/globalSearchEntities.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("globalSearch");
const router = express.Router();

// Every route here reads PII from every collection at once, so it is gated on
// the "global-search" page key — granted to admin/super_admin only, because
// every other role's page list in constants/adminPages.js is explicit.
router.use(authenticateAdmin, requirePage("global-search"));

// Mirrors adminDataLimiter in admin.routes.js: PII-bearing reads, keyed by
// admin id so one token cannot bulk-scrape the database.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || ipKeyGenerator(req.ip),
  message: "Too many searches. Please slow down.",
});

// Mirrors adminAiLimiter: bounds Claude spend per admin session.
const askLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || ipKeyGenerator(req.ip),
  message: "AI search rate limit reached. Try again later.",
});

// Lets the UI render group labels/icons before the first search, without
// duplicating the registry on the frontend.
router.get("/entities", (req, res) => {
  res.json({
    success: true,
    data: SEARCH_ENTITIES.map((e) => ({ key: e.key, label: e.label, icon: e.icon })),
  });
});

router.get("/keyword", searchLimiter, async (req, res) => {
  try {
    const { q, entities, limit } = req.query;
    const result = await keywordSearch({ q, entities, limit });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error("keyword search failed:", err.message);
    return res.status(500).json({ success: false, message: "Search failed" });
  }
});

router.post("/ask", askLimiter, async (req, res) => {
  try {
    const result = await askDatabase(req.body?.question, req.admin?.uid);
    return res.json({ success: true, ...result });
  } catch (err) {
    // A rejected query is the admin's phrasing problem, not a server fault —
    // 422 with the compiler's own reason so the UI can show it verbatim.
    if (err instanceof SearchQueryError) {
      return res.status(422).json({ success: false, message: err.message, code: err.code });
    }
    if (err.message?.includes("ANTHROPIC_API_KEY")) {
      return res.status(503).json({ success: false, message: "AI search is not configured on this server." });
    }
    logger.error("ask failed:", err.message);
    return res.status(500).json({ success: false, message: "AI search failed" });
  }
});

export default router;
