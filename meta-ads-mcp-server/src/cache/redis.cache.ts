import { Redis } from 'ioredis';
import type { CacheAdapter } from './cache.interface.js';

function fullKey(namespace: string, key: string): string {
  return `cache:${namespace}:${key}`;
}

export class RedisCache implements CacheAdapter {
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    const raw = await this.client.get(fullKey(namespace, key));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(namespace: string, key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(fullKey(namespace, key), JSON.stringify(value), 'EX', ttlSeconds);
  }

  async invalidate(namespace: string, key?: string): Promise<void> {
    if (key) {
      await this.client.del(fullKey(namespace, key));
      return;
    }
    const prefix = fullKey(namespace, '');
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = nextCursor;
      if (batch.length > 0) await this.client.del(...batch);
    } while (cursor !== '0');
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
