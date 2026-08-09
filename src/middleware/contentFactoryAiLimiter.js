import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Own bucket for AI Content Factory interactive AI-adjacent actions —
// cloned from admin.routes.js's adminAiLimiter pattern (same config), kept
// separate per plan decision (e) so factory usage doesn't share a budget
// with the existing blog-AI actions.
export const contentFactoryAiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || ipKeyGenerator(req.ip),
  message: "AI Content Factory rate limit reached. Try again later.",
});
