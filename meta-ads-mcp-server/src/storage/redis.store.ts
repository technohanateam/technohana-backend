import { Redis } from 'ioredis';
import type { StorageAdapter } from '../types/storage.types.js';

const LOG_MAX_LENGTH = 10_000;

function entryKey(namespace: string, key: string): string {
  return `store:${namespace}:${key}`;
}

function logKey(namespace: string): string {
  return `log:${namespace}`;
}

export class RedisStore implements StorageAdapter {
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    const raw = await this.client.get(entryKey(namespace, key));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(namespace: string, key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(entryKey(namespace, key), payload, 'EX', ttlSeconds);
    } else {
      await this.client.set(entryKey(namespace, key), payload);
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.client.del(entryKey(namespace, key));
  }

  async listKeys(namespace: string): Promise<string[]> {
    const prefix = entryKey(namespace, '');
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = nextCursor;
      keys.push(...batch.map((k) => k.slice(prefix.length)));
    } while (cursor !== '0');
    return keys;
  }

  async appendLog<T>(namespace: string, entry: T): Promise<void> {
    const key = logKey(namespace);
    await this.client.lpush(key, JSON.stringify(entry));
    await this.client.ltrim(key, 0, LOG_MAX_LENGTH - 1);
  }

  async readLog<T>(namespace: string, limit = 100): Promise<T[]> {
    const raw = await this.client.lrange(logKey(namespace), 0, limit - 1);
    return raw.map((item) => JSON.parse(item) as T);
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
