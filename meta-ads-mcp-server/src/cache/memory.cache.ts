import type { CacheAdapter } from './cache.interface.js';

interface MemoryCacheEntry {
  value: unknown;
  expiresAt: number;
}

function fullKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

export class MemoryCache implements CacheAdapter {
  private readonly store = new Map<string, MemoryCacheEntry>();

  async get<T>(namespace: string, key: string): Promise<T | null> {
    const entry = this.store.get(fullKey(namespace, key));
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(fullKey(namespace, key));
      return null;
    }
    return entry.value as T;
  }

  async set<T>(namespace: string, key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(fullKey(namespace, key), { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async invalidate(namespace: string, key?: string): Promise<void> {
    if (key) {
      this.store.delete(fullKey(namespace, key));
      return;
    }
    const prefix = `${namespace}:`;
    for (const existingKey of this.store.keys()) {
      if (existingKey.startsWith(prefix)) this.store.delete(existingKey);
    }
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
