import express from 'express';
import { createSubscription, sendNewsletter } from '../controllers/subscription.controller.js';
import { authenticateAdmin, requirePage } from '../middleware/authenticateAdmin.js';

const router = express.Router();

router.post('/subscription', createSubscription);
router.post('/newsletter/send', authenticateAdmin, requirePage('subscribers'), sendNewsletter);

export default router; 