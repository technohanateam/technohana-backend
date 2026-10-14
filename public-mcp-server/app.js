import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './registry.js';

const limiterMessage = { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests. Please slow down.' }, id: null };

const makeLimiter = (windowMs, limit) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: limiterMessage });

const usesCoupon = (body) =>
  (Array.isArray(body) ? body : [body]).some((m) => m?.method === 'tools/call' && m?.params?.arguments?.couponCode);

export function createApp({ requestLimit = 60, couponLimit = 10 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  const general = makeLimiter(60 * 1000, requestLimit);
  const coupon = makeLimiter(15 * 60 * 1000, couponLimit);

  app.post('/mcp', general, express.json({ limit: '16kb' }), (req, res, next) => (usesCoupon(req.body) ? coupon(req, res, next) : next()), async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[public-mcp] transport error:', err?.name);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  const methodNotAllowed = (_req, res) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err?.status === 400 || err?.type === 'entity.parse.failed' ? 400 : err?.status === 413 ? 413 : 500;
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32700, message: status === 500 ? 'Internal server error' : 'Invalid request' }, id: null });
  });

  return app;
}
