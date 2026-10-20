import express from 'express';
import rateLimit from 'express-rate-limit';
import { createSubscription, sendNewsletter, showUnsubscribePage, confirmUnsubscribe } from '../controllers/subscription.controller.js';
import { authenticateAdmin, requirePage } from '../middleware/authenticateAdmin.js';

const router = express.Router();

const subscriptionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post('/subscription', subscriptionLimiter, createSubscription);
router.post('/newsletter/send', authenticateAdmin, requirePage('subscribers'), sendNewsletter);

// Public, HMAC-token-gated links from marketing emails (services/emailSuppression.js)
router.get('/unsubscribe', showUnsubscribePage);
router.post('/unsubscribe', confirmUnsubscribe);

export default router; 