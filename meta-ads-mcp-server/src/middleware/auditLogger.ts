import { STORAGE_NAMESPACES } from '../config/constants.js';
import { getStorageAdapter } from '../storage/storage.factory.js';
import { logger } from '../utils/logger.js';

export interface AuditLogEntry {
  timestamp: string;
  requestId: string;
  userId: string;
  role: string;
  toolName: string;
  argsSummary: Record<string, unknown>;
  success: boolean;
  error?: string;
  metaRequestId?: string;
}

/**
 * Appends an immutable audit record for a mutating MCP tool call. Failures to
 * write the audit log are logged but never block the underlying tool response.
 */
export async function recordAuditEntry(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
  const record: AuditLogEntry = { ...entry, timestamp: new Date().toISOString() };
  try {
    await getStorageAdapter().appendLog(STORAGE_NAMESPACES.AUDIT_LOG, record);
  } catch (error) {
    logger.error(
      { requestId: entry.requestId, err: error instanceof Error ? error.message : error },
      'audit_log_write_failed',
    );
  }
}

/** Reads the most recent audit entries, newest first. Used by admin/debug tooling. */
export async function readAuditLog(limit = 100): Promise<AuditLogEntry[]> {
  return getStorageAdapter().readLog<AuditLogEntry>(STORAGE_NAMESPACES.AUDIT_LOG, limit);
}
