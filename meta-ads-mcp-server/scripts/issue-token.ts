#!/usr/bin/env node
/**
 * Mints a bearer JWT for the /mcp endpoint - the credential you paste into
 * Claude's Custom Connector "Bearer Token" field. This server has no dynamic
 * OAuth client registration flow; a self-issued long-lived token is the
 * supported way to connect a single operator's Claude client.
 *
 * Usage:
 *   npm run issue-token -- --role admin --sub my-claude-connector
 *
 * MCP_JWT_TTL_SECONDS controls how long the token is valid (see .env.example).
 * For a personal-use token you paste into Claude once, set it to something
 * long-lived (e.g. 31536000 for one year) rather than the 1-hour default,
 * which is sized for short-lived, frequently-reissued tokens instead.
 */
import { issueMcpToken } from '../src/auth/jwt.js';
import { isValidRole, ROLES } from '../src/config/roles.js';

function parseArgs(argv: string[]): { sub: string; role: string } {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    if (index === -1 || index === argv.length - 1) return fallback;
    return argv[index + 1]!;
  };
  return {
    sub: get('--sub', 'claude-connector'),
    role: get('--role', 'admin'),
  };
}

const { sub, role } = parseArgs(process.argv.slice(2));

if (!isValidRole(role)) {
  console.error(`Invalid --role '${role}'. Must be one of: ${ROLES.join(', ')}.`);
  process.exit(1);
}

const token = issueMcpToken({ sub, role });
console.log(token);
