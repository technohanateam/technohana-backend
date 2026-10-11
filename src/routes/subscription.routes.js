import express from 'express';
import { createSubscription, sendNewsletter, showUnsubscribePage, confirmUnsubscribe } from '../controllers/subscription.controller.js';
import { authenticateAdmin, requirePage } from '../middleware/authenticateAdmin.js';

const router = express.Router();

router.post('/subscription', createSubscription);
router.post('/newsletter/send', authenticateAdmin, requirePage('subscribers'), sendNewsletter);

// Public, HMAC-token-gated links from marketing emails (services/emailSuppression.js)
router.get('/unsubscribe', showUnsubscribePage);
router.post('/unsubscribe', confirmUnsubscribe);

export default router; 