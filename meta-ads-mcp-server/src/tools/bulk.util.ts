import pLimit from 'p-limit';
import { BULK_OPERATION_LIMITS } from '../config/constants.js';
import type { BulkOperationItemResult, BulkOperationResult } from '../types/mcp.types.js';

/** Runs `fn` over `items` with bounded concurrency, collecting a per-item success/failure result. */
export async function runBulk<TInput, TResult>(
  items: TInput[],
  fn: (item: TInput) => Promise<TResult>,
): Promise<BulkOperationResult<TResult>> {
  if (items.length > BULK_OPERATION_LIMITS.maxBatchSize) {
    throw new Error(
      `Bulk operation exceeds the maximum batch size of ${BULK_OPERATION_LIMITS.maxBatchSize} (received ${items.length}).`,
    );
  }

  const limit = pLimit(BULK_OPERATION_LIMITS.maxConcurrency);
  const results = await Promise.all(
    items.map((item) =>
      limit(async (): Promise<BulkOperationItemResult<TResult>> => {
        try {
          const result = await fn(item);
          return { input: item, success: true, result };
        } catch (error) {
          return { input: item, success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    ),
  );

  return {
    total: results.length,
    succeeded: results.filter((item) => item.success).length,
    failed: results.filter((item) => !item.success).length,
    items: results,
  };
}
