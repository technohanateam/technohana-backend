import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateCrm } from "../middleware/authenticateCrm.js";
import { crmInputGuard } from "../middleware/crmInputGuard.js";
import {
  crmLogin, setupCrmOwner, crmMe, forgotCrmPassword, resetCrmPasswordViaToken,
} from "../controllers/crmUser.controller.js";

const router = Router();

const limiter = (max, windowMs, message, extra = {}) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message },
  ...extra,
});

// Per-IP limits; the login handler also locks an account after repeated failures.
const loginLimiter = limiter(10, 15 * 60 * 1000,
  'Too many failed login attempts. Please try again in 15 minutes, or use "Forgot password".',
  { skipSuccessfulRequests: true });
const passwordLimiter = limiter(5, 15 * 60 * 1000, "Too many attempts. Please try again after 15 minutes.");
const setupLimiter = limiter(3, 60 * 60 * 1000, "Too many attempts. Please try again later.");

router.use(crmInputGuard);
router.post("/login", loginLimiter, crmLogin);
router.post("/setup", setupLimiter, setupCrmOwner);
router.post("/forgot-password", passwordLimiter, forgotCrmPassword);
router.post("/reset-password", passwordLimiter, resetCrmPasswordViaToken);
router.get("/me", authenticateCrm, crmMe);

export default router;
