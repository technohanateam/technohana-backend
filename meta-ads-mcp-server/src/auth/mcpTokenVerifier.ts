import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
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
    const claims = verifyMcpToken(token);
    return {
      token,
      clientId: claims.sub,
      scopes: [],
      expiresAt: claims.exp,
      extra: { userId: claims.sub, role: claims.role },
    };
  },
};
