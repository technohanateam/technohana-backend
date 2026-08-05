import { Router } from 'express';

export const healthRouter = Router();

/** Pure liveness ping: the process is up and handling requests. */
healthRouter.get('/live', (_req, res) => {
  res.status(200).json({ success: true, status: 'alive' });
});

/** Shallow status summary - always 200 as long as the process can respond. */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ success: true, status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});
