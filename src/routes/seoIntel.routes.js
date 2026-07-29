import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { authenticateAdmin, requirePage, requireMarketing } from "../middleware/authenticateAdmin.js";

import { listConnections, getConnectUrl, handleOAuthCallback, setGa4PropertyId, disconnect } from "../controllers/seoConnection.controller.js";
import {
  getGscSummary,
  getGscQueries,
  getGscPages,
  getGscCountries,
  getGscDevices,
  getGscSitemaps,
  inspectGscUrl,
  triggerGscSync,
} from "../controllers/seoGsc.controller.js";
import { getGa4Summary, getGa4LandingPages, getGa4Events, getGa4TrafficSources, triggerGa4Sync } from "../controllers/seoGa4.controller.js";
import { listCrawlRuns, getCrawlRun, getCrawlRunPages, triggerCrawl } from "../controllers/seoCrawl.controller.js";
import { getExecutiveDashboard, getHealthScore } from "../controllers/seoExecutive.controller.js";
import { listRecommendations, updateRecommendation } from "../controllers/seoRecommendation.controller.js";
import { listAlerts, acknowledgeAlert } from "../controllers/seoAlert.controller.js";
import { getIntelSettings, updateIntelSettings } from "../controllers/seoIntelSettings.controller.js";
import { getSystemHealth } from "../controllers/seoSystemHealth.controller.js";

const router = express.Router();

// Public and unauthenticated (Google redirects here with no auth header), so
// it's rate-limited by IP to blunt scraping/abuse of the callback endpoint.
const oauthCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: "Too many requests. Please try again later.",
});

// Manual sync/crawl triggers call out to Google APIs (subject to quota) or
// kick off a full site crawl — throttled per-admin so repeated clicks or a
// scripted loop can't exhaust quota or flood the queue.
const seoTriggerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || ipKeyGenerator(req.ip),
  message: "Too many sync/crawl requests. Please wait a moment before trying again.",
});

// OAuth callback is public (Google redirects the browser here with no auth
// header) — must be registered before the router-wide authenticateAdmin.
router.get("/oauth/callback", oauthCallbackLimiter, handleOAuthCallback);

router.use(authenticateAdmin);

const GSC_PAGE = "seo-intel-search-console";
const GA4_PAGE = "seo-intel-analytics";
const TECH_PAGE = "seo-intel-technical";
const EXEC_PAGE = "seo-intel-executive";
const REC_PAGE = "seo-intel-recommendations";
const HEALTH_PAGE = "seo-intel-system-health";

// ── Connections ──────────────────────────────────────────────────────────
router.get("/connections", requirePage(GSC_PAGE, GA4_PAGE), listConnections);
router.post("/connect/:provider", requirePage(GSC_PAGE, GA4_PAGE), requireMarketing, getConnectUrl);
router.patch("/connections/:id/ga4-property", requirePage(GA4_PAGE), requireMarketing, setGa4PropertyId);
router.delete("/connections/:id", requirePage(GSC_PAGE, GA4_PAGE), requireMarketing, disconnect);

// ── Google Search Console ───────────────────────────────────────────────
router.get("/gsc/summary", requirePage(GSC_PAGE), getGscSummary);
router.get("/gsc/queries", requirePage(GSC_PAGE), getGscQueries);
router.get("/gsc/pages", requirePage(GSC_PAGE), getGscPages);
router.get("/gsc/countries", requirePage(GSC_PAGE), getGscCountries);
router.get("/gsc/devices", requirePage(GSC_PAGE), getGscDevices);
router.get("/gsc/sitemaps", requirePage(GSC_PAGE), getGscSitemaps);
router.post("/gsc/inspect-url", requirePage(GSC_PAGE), requireMarketing, inspectGscUrl);
router.post("/sync/gsc", requirePage(GSC_PAGE), requireMarketing, seoTriggerLimiter, triggerGscSync);

// ── Google Analytics 4 ──────────────────────────────────────────────────
router.get("/ga4/summary", requirePage(GA4_PAGE), getGa4Summary);
router.get("/ga4/landing-pages", requirePage(GA4_PAGE), getGa4LandingPages);
router.get("/ga4/events", requirePage(GA4_PAGE), getGa4Events);
router.get("/ga4/traffic-sources", requirePage(GA4_PAGE), getGa4TrafficSources);
router.post("/sync/ga4", requirePage(GA4_PAGE), requireMarketing, seoTriggerLimiter, triggerGa4Sync);

// ── Technical SEO crawler ───────────────────────────────────────────────
router.get("/crawl/runs", requirePage(TECH_PAGE), listCrawlRuns);
router.get("/crawl/runs/:id", requirePage(TECH_PAGE), getCrawlRun);
router.get("/crawl/runs/:id/pages", requirePage(TECH_PAGE), getCrawlRunPages);
router.post("/crawl/trigger", requirePage(TECH_PAGE), requireMarketing, seoTriggerLimiter, triggerCrawl);

// ── Executive dashboard ─────────────────────────────────────────────────
router.get("/executive/dashboard", requirePage(EXEC_PAGE), getExecutiveDashboard);
router.get("/executive/health-score", requirePage(EXEC_PAGE), getHealthScore);

// ── Recommendations ─────────────────────────────────────────────────────
router.get("/recommendations", requirePage(REC_PAGE), listRecommendations);
router.patch("/recommendations/:id", requirePage(REC_PAGE), requireMarketing, updateRecommendation);

// ── Alerts ───────────────────────────────────────────────────────────────
router.get("/alerts", requirePage(EXEC_PAGE), listAlerts);
router.patch("/alerts/:id/acknowledge", requirePage(EXEC_PAGE), requireMarketing, acknowledgeAlert);

// ── System Health ────────────────────────────────────────────────────────
router.get("/system-health", requirePage(HEALTH_PAGE), getSystemHealth);

// ── Settings ─────────────────────────────────────────────────────────────
router.get("/settings", requirePage(TECH_PAGE), getIntelSettings);
router.patch("/settings", requirePage(TECH_PAGE), requireMarketing, updateIntelSettings);

export default router;
