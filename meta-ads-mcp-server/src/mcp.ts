import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { allTools } from './tools/index.js';
import type { Role } from './config/roles.js';
import type { McpToolContext } from './types/mcp.types.js';
import { logger } from './utils/logger.js';

/** Default, least-privilege context used only if a call somehow reaches a tool with no auth info attached. */
const FALLBACK_CONTEXT: Omit<McpToolContext, 'requestId'> = { userId: 'unknown', role: 'viewer' };

function contextFromAuthInfo(authInfo: AuthInfo | undefined, requestId: string): McpToolContext {
  const extra = authInfo?.extra as { userId?: string; role?: Role } | undefined;
  if (!extra?.userId || !extra.role) {
    logger.warn({ requestId }, 'mcp_tool_call_missing_auth_context');
    return { requestId, ...FALLBACK_CONTEXT };
  }
  return { requestId, userId: extra.userId, role: extra.role };
}

/**
 * Builds a fresh McpServer instance with every tool registered. Called once
 * per new MCP session (see server.ts) - tool logic itself is stateless, so a
 * new McpServer per transport is the cheap, spec-aligned way to isolate
 * sessions rather than sharing one server across concurrent transports.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'meta-ads-mcp-server',
    version: '1.0.0',
  });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (
        args: unknown,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ): Promise<CallToolResult> => {
        const requestId = String(extra.requestId ?? randomUUID());
        const context = contextFromAuthInfo(extra.authInfo, requestId);
        const result = await tool.handler(args, context);
        return result as CallToolResult;
      },
    );
  }

  return server;
}

/** Creates a new session transport with a server-generated session ID. */
export function createSessionTransport(onSessionInitialized: (sessionId: string) => void): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: onSessionInitialized,
  });
}
