import express from 'express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { captureRawBody } from './middleware/requestSigning.js';
import { mcpTokenVerifier } from './auth/mcpTokenVerifier.js';
import { mcpOAuthProvider } from './auth/mcpOAuthProvider.js';
import { createMcpServer, createSessionTransport } from './mcp.js';
import { healthRouter } from './routes/health.routes.js';
import { readyRouter } from './routes/ready.routes.js';
import { metricsRouter } from './routes/metrics.routes.js';
import { oauthRouter } from './routes/oauth.routes.js';
import { linkedinOauthRouter } from './routes/linkedinOauth.routes.js';
import { oauthConsentRouter } from './routes/oauthConsent.routes.js';
import { initSentry } from './observability/sentry.js';

initSentry();

export const app = express();

const mcpIssuerUrl = new URL(env.MCP_OAUTH_ISSUER_URL);
const mcpResourceUrl = new URL('/mcp', mcpIssuerUrl);

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header (server-to-server, curl, the MCP connector) - always allow.
      if (!origin) return callback(null, true);
      // Same-origin requests (e.g. the OAuth consent form's own POST back to
      // this server) always carry an Origin header even though they aren't
      // cross-origin - CORS exists to gate cross-origin access, so this is
      // always safe to allow regardless of CORS_ALLOWED_ORIGINS.
      if (origin === mcpIssuerUrl.origin) return callback(null, true);
      // The literal string 'null' is the serialized form of an opaque origin,
      // which browsers send (not omit - actually send the string "null") for
      // requests from sandboxed contexts, e.g. the iframe/popup claude.ai runs
      // this OAuth flow's consent screen in. It isn't a spoofable value the way
      // a real origin string is, and every route on this app that carries a
      // real secret (the consent password, the /mcp bearer token, DCR/PKCE)
      // enforces that independently of CORS - CORS was never the security
      // boundary for those, only a browser-fetch convenience gate.
      if (origin === 'null') return callback(null, true);
      if (env.CORS_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`Origin '${origin}' is not allowed by CORS policy.`));
    },
  }),
);
app.use(requestLogger);
app.use(rateLimiter);
app.use(express.json({ verify: captureRawBody, limit: '10mb' }));

// Operational endpoints - unauthenticated by design (used by load balancers/orchestrators).
app.use(healthRouter);
app.use(readyRouter);
app.use(metricsRouter);

// Meta and LinkedIn OAuth (browser redirect flows, each protected by its own signed+time-boxed state parameter).
app.use(oauthRouter);
app.use(linkedinOauthRouter);

// OAuth 2.1 authorization server for /mcp itself - lets OAuth-only clients
// (e.g. claude.ai's web connector setup, which requires Dynamic Client
// Registration and a real authorize/token handshake) connect without a
// manually-pasted bearer token. Installs /register, /authorize, /token, and
// the .well-known metadata documents; the interactive consent step they all
// funnel through lives in oauthConsentRouter, since provider.authorize()
// itself has no access to the request body (see mcpOAuthProvider.ts).
app.use(
  mcpAuthRouter({
    provider: mcpOAuthProvider,
    issuerUrl: mcpIssuerUrl,
    resourceServerUrl: mcpResourceUrl,
    scopesSupported: ['admin'],
    // The app's own global rateLimiter (above) already covers these routes;
    // avoid double/inconsistent limiting from the SDK's per-endpoint defaults.
    authorizationOptions: { rateLimit: false },
    clientRegistrationOptions: { rateLimit: false },
    tokenOptions: { rateLimit: false },
  }),
);
app.use(oauthConsentRouter);

// --- MCP Streamable HTTP endpoint ---
const sessionTransports = new Map<string, StreamableHTTPServerTransport>();
const bearerAuth = requireBearerAuth({
  verifier: mcpTokenVerifier,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpResourceUrl),
});

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    if (sessionId && sessionTransports.has(sessionId)) {
      const transport = sessionTransports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = createSessionTransport((newSessionId) => {
        sessionTransports.set(newSessionId, transport);
        logger.info({ sessionId: newSessionId }, 'mcp_session_initialized');
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessionTransports.has(sid)) {
          sessionTransports.delete(sid);
          logger.info({ sessionId: sid }, 'mcp_session_closed');
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null,
    });
  } catch (error) {
    logger.error({ err: error, sessionId }, 'mcp_request_failed');
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

async function handleMcpSessionRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessionTransports.has(sessionId)) {
    res.status(400).send('Invalid or missing Mcp-Session-Id header.');
    return;
  }
  const transport = sessionTransports.get(sessionId)!;
  await transport.handleRequest(req, res);
}

app.post('/mcp', bearerAuth, handleMcpPost);
app.get('/mcp', bearerAuth, handleMcpSessionRequest);
app.delete('/mcp', bearerAuth, handleMcpSessionRequest);

app.use(notFoundHandler);
app.use(errorHandler);

if (process.env.VITEST !== 'true') {
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'meta_ads_mcp_server_started');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutdown_initiated');
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
