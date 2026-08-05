import type { ZodTypeAny, z } from 'zod';
import type { Role } from '../config/roles.js';

export interface McpToolContext {
  requestId: string;
  userId: string;
  role: Role;
}

export interface McpToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type McpToolHandler<TSchema extends ZodTypeAny> = (
  input: z.infer<TSchema>,
  context: McpToolContext,
) => Promise<McpToolTextResult>;

export interface McpToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;
  handler: McpToolHandler<TSchema>;
}

export interface BulkOperationItemResult<TResult> {
  input: unknown;
  success: boolean;
  result?: TResult;
  error?: string;
}

export interface BulkOperationResult<TResult> {
  total: number;
  succeeded: number;
  failed: number;
  items: Array<BulkOperationItemResult<TResult>>;
}
