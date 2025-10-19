import express from 'express';
import { createSubscription, sendNewsletter } from '../controllers/subscription.controller.js';

const router = express.Router();

router.post('/subscription', createSubscription);
router.post('/newsletter/send', sendNewsletter);

export default router; 