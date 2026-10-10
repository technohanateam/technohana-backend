import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateCrm } from "../middleware/authenticateCrm.js";
import {
  crmLogin, setupCrmOwner, crmMe, forgotCrmPassword, resetCrmPasswordViaToken,
} from "../controllers/crmUser.controller.js";

const router = Router();

const crmAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again after 15 minutes." },
});

router.post("/login", crmAuthLimiter, crmLogin);
router.post("/setup", crmAuthLimiter, setupCrmOwner);
router.post("/forgot-password", crmAuthLimiter, forgotCrmPassword);
router.post("/reset-password", crmAuthLimiter, resetCrmPasswordViaToken);
router.get("/me", authenticateCrm, crmMe);

export default router;
