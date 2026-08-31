import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Own bucket for Ad Creative Factory interactive AI-adjacent actions — cloned
// from contentFactoryAiLimiter.js's pattern, kept separate so ad-creative
// usage doesn't share a budget/rate bucket with the existing Content Factory
// AI actions.
export const adCreativeFactoryAiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.admin?.uid || ipKeyGenerator(req.ip),
  message: "Ad Creative Factory rate limit reached. Try again later.",
});
