/**
 * Generic key-value persistence contract used by the OAuth token manager and the
 * audit logger. Every backend (file/redis/mongo/postgres) implements this same
 * interface so callers never depend on a concrete storage technology.
 */
export interface StorageAdapter {
  /** Returns the parsed value stored at `key`, or null if absent/expired. */
  get<T>(namespace: string, key: string): Promise<T | null>;

  /** Stores `value` at `key`. `ttlSeconds`, if provided, expires the entry. */
  set<T>(namespace: string, key: string, value: T, ttlSeconds?: number): Promise<void>;

  /** Removes the entry at `key`. No-op if absent. */
  delete(namespace: string, key: string): Promise<void>;

  /** Lists all keys currently stored under `namespace`. */
  listKeys(namespace: string): Promise<string[]>;

  /** Appends an item to a namespace-scoped append-only log (used for audit trail). */
  appendLog<T>(namespace: string, entry: T): Promise<void>;

  /** Reads the most recent `limit` entries from an append-only log, newest first. */
  readLog<T>(namespace: string, limit?: number): Promise<T[]>;

  /** Lightweight connectivity check used by the /ready endpoint. Throws on failure. */
  ping(): Promise<void>;

  /** Releases underlying connections/handles. Called on graceful shutdown. */
  close(): Promise<void>;
}

export type StorageBackend = 'file' | 'redis' | 'mongo' | 'postgres';
