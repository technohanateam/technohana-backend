import express from "express";
import { requireContentFactoryServiceKey } from "../middleware/requireContentFactoryServiceKey.js";
import { ingestExternalTrends } from "../controllers/contentFactory/externalTrendIngest.controller.js";

// Mounted separately from contentFactory.routes.js (which requires an
// interactive admin JWT via authenticateAdmin) since this is called by an
// unattended cloud agent with no admin login — see requireContentFactoryServiceKey.js.
const router = express.Router();

router.post("/import/external-trend", requireContentFactoryServiceKey, ingestExternalTrends);

export default router;
