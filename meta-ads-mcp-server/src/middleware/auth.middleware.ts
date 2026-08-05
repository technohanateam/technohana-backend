import type { NextFunction, Request, Response } from 'express';
import { verifyMcpToken } from '../auth/jwt.js';
import type { Role } from '../config/roles.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { userId: string; role: Role };
  }
}

/**
 * Verifies the bearer JWT presented by the Claude Remote MCP Connector (or any
 * other authenticated caller) and attaches `req.user`. Responds 401 on a
 * missing/malformed/expired token.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Missing or malformed Authorization header.' });
    return;
  }

  const token = header.slice('Bearer '.length);
  try {
    const claims = verifyMcpToken(token);
    req.user = { userId: claims.sub, role: claims.role };
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: error instanceof Error ? error.message : 'Invalid token.' });
  }
}
