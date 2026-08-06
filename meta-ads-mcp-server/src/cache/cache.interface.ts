export interface CacheAdapter {
  get<T>(namespace: string, key: string): Promise<T | null>;
  set<T>(namespace: string, key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Invalidates a single key, or every key in `namespace` when `key` is omitted. */
  invalidate(namespace: string, key?: string): Promise<void>;
  close(): Promise<void>;
}

export type CacheBackend = 'memory' | 'redis';
