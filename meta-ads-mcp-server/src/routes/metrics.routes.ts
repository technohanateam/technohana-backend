import { Router } from 'express';
import { env } from '../config/env.js';
import { metricsRegistry } from '../observability/metrics.js';

export const metricsRouter = Router();

metricsRouter.get('/metrics', async (_req, res) => {
  if (!env.METRICS_ENABLED) {
    res.status(404).json({ success: false, message: 'Metrics are disabled (set METRICS_ENABLED=true).' });
    return;
  }
  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});
