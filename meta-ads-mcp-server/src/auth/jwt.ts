import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { Role } from '../config/roles.js';
import { isValidRole } from '../config/roles.js';

export interface McpJwtClaims {
  sub: string;
  role: Role;
}

type KeyId = 'current' | 'previous';

/**
 * Key set for JWT signing/verification. Only 'current' is ever used to sign new
 * tokens; 'previous' is accepted for verification during a rotation window so
 * tokens issued under the outgoing secret keep working until they expire.
 */
function getKeySet(): Record<KeyId, string | undefined> {
  return {
    current: env.MCP_JWT_SECRET,
    previous: env.MCP_JWT_SECRET_PREVIOUS,
  };
}

export class JwtVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtVerificationError';
  }
}

/** Issues a new bearer JWT for the /mcp endpoint, always signed with the current key. */
export function issueMcpToken(claims: McpJwtClaims): string {
  return jwt.sign(claims, env.MCP_JWT_SECRET, {
    algorithm: 'HS256',
    issuer: env.MCP_JWT_ISSUER,
    audience: env.MCP_JWT_AUDIENCE,
    expiresIn: env.MCP_JWT_TTL_SECONDS,
    keyid: 'current',
  });
}

/**
 * Verifies a bearer JWT, trying the current signing key first and falling back
 * to the previous key (if configured) to support seamless key rotation.
 */
export function verifyMcpToken(token: string): McpJwtClaims {
  const keySet = getKeySet();
  const candidateKeys: string[] = [keySet.current, keySet.previous].filter(
    (key): key is string => Boolean(key),
  );

  let lastError: unknown;
  for (const key of candidateKeys) {
    try {
      const decoded = jwt.verify(token, key, {
        algorithms: ['HS256'],
        issuer: env.MCP_JWT_ISSUER,
        audience: env.MCP_JWT_AUDIENCE,
      });

      if (typeof decoded === 'string' || !decoded.sub || typeof decoded.role !== 'string' || !isValidRole(decoded.role)) {
        throw new JwtVerificationError('Malformed JWT claims');
      }

      return { sub: decoded.sub, role: decoded.role };
    } catch (error) {
      lastError = error;
    }
  }

  throw new JwtVerificationError(
    lastError instanceof Error ? `Invalid or expired token: ${lastError.message}` : 'Invalid or expired token',
  );
}
