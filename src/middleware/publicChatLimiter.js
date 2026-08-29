import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Public, unauthenticated LLM-backed chat/tools endpoints — IP-keyed since
// there is no req.user/req.admin on these routes.
export const publicChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: "Too many requests. Please try again in a few minutes." },
});

// Heavier one-shot AI generators (roadmap/LinkedIn/content-calendar/pdf-parse) —
// tighter cap since each call is a larger, more expensive completion.
export const publicAiGeneratorLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: "Too many requests. Please try again later." },
});
