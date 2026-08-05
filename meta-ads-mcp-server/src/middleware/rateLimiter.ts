import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Global request-rate limiter protecting /mcp and REST routes from abuse.
 * Window/limit are configurable via RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX_REQUESTS.
 */
export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down and try again shortly.' },
});
