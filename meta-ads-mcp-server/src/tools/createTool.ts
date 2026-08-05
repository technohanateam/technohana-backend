import type { ZodTypeAny, z } from 'zod';
import { assertToolPermission } from '../auth/rbac.js';
import { recordAuditEntry } from '../middleware/auditLogger.js';
import { logger } from '../utils/logger.js';
import type { McpToolContext, McpToolDefinition, McpToolHandler, McpToolTextResult } from '../types/mcp.types.js';

interface CreateToolOptions<TSchema extends ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;
  /** True for tools that create/update/delete Meta resources - these get an audit log entry. */
  mutating?: boolean;
  handler: (input: z.infer<TSchema>, context: McpToolContext) => Promise<unknown>;
}

function toTextResult(value: unknown): McpToolTextResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function toErrorResult(error: unknown): McpToolTextResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Truncates long string values so a single oversized arg can't blow up a log line. */
function summarizeArgs(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value,
      ]),
    );
  }
  return {};
}

/**
 * Wraps a plain async handler into a full McpToolDefinition: enforces RBAC,
 * logs every invocation (requestId/toolName/duration/userId/status), writes
 * an audit trail entry for mutating tools, and normalizes both success and
 * error paths into the MCP text-content result shape.
 */
export function createTool<TSchema extends ZodTypeAny>(
  options: CreateToolOptions<TSchema>,
): McpToolDefinition<TSchema> {
  const handler: McpToolHandler<TSchema> = async (input, context) => {
    const { requestId, userId, role } = context;
    const startedAt = Date.now();

    try {
      assertToolPermission(role, options.name);
      const result = await options.handler(input, context);
      const duration = Date.now() - startedAt;

      logger.info({ requestId, toolName: options.name, duration, userId, status: 'success' }, 'mcp_tool_invocation');

      if (options.mutating) {
        await recordAuditEntry({
          requestId,
          userId,
          role,
          toolName: options.name,
          argsSummary: summarizeArgs(input),
          success: true,
        });
      }

      return toTextResult(result);
    } catch (error) {
      const duration = Date.now() - startedAt;
      logger.error(
        { requestId, toolName: options.name, duration, userId, status: 'error', err: error },
        'mcp_tool_invocation',
      );

      if (options.mutating) {
        await recordAuditEntry({
          requestId,
          userId,
          role,
          toolName: options.name,
          argsSummary: summarizeArgs(input),
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return toErrorResult(error);
    }
  };

  return { name: options.name, description: options.description, inputSchema: options.inputSchema, handler };
}
