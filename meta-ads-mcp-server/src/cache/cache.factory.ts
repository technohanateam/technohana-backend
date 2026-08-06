import { env } from '../config/env.js';
import type { CacheAdapter } from './cache.interface.js';
import { MemoryCache } from './memory.cache.js';
import { RedisCache } from './redis.cache.js';

let instance: CacheAdapter | null = null;

function build(): CacheAdapter {
  switch (env.CACHE_BACKEND) {
    case 'memory':
      return new MemoryCache();
    case 'redis':
      return new RedisCache(env.CACHE_REDIS_URL);
    default:
      throw new Error(`Unsupported CACHE_BACKEND: ${env.CACHE_BACKEND as string}`);
  }
}

/** Returns the process-wide singleton CacheAdapter selected by CACHE_BACKEND. */
export function getCacheAdapter(): CacheAdapter {
  instance ??= build();
  return instance;
}

/** Test/shutdown helper: closes and clears the singleton so a fresh one is built next call. */
export async function resetCacheAdapter(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
