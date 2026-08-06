import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { verifyMcpToken } from './jwt.js';

/**
 * Adapts our own JWT verification (auth/jwt.ts) to the MCP SDK's
 * OAuthTokenVerifier contract, so `requireBearerAuth` can protect /mcp and
 * populate `req.auth` (which the SDK forwards to every tool call as
 * `extra.authInfo`). `extra.authInfo.extra` carries our userId/role so
 * createTool's RBAC + audit logging has real caller identity to work with.
 */
export const mcpTokenVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const claims = verifyMcpToken(token);
      return {
        token,
        clientId: claims.sub,
        scopes: [],
        expiresAt: claims.exp,
        extra: { userId: claims.sub, role: claims.role },
      };
    } catch (error) {
      // requireBearerAuth only maps its own SDK error classes to the correct
      // HTTP status - anything else (including our JwtVerificationError)
      // falls through to a 500. A malformed/expired/invalid token is a 401,
      // never a server error, so it must be rethrown as InvalidTokenError.
      throw new InvalidTokenError(error instanceof Error ? error.message : 'Invalid or expired token');
    }
  },
};

