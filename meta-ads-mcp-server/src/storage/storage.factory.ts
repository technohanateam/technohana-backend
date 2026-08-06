import { env } from '../config/env.js';
import type { StorageAdapter } from '../types/storage.types.js';
import { FileStore } from './file.store.js';
import { RedisStore } from './redis.store.js';
import { MongoStore } from './mongo.store.js';
import { PostgresStore } from './postgres.store.js';

let instance: StorageAdapter | null = null;

function build(): StorageAdapter {
  switch (env.STORAGE_BACKEND) {
    case 'file':
      return new FileStore(env.FILE_STORE_PATH, env.FILE_STORE_ENCRYPTION_KEY);
    case 'redis':
      return new RedisStore(env.STORAGE_REDIS_URL);
    case 'mongo':
      return new MongoStore(env.STORAGE_MONGO_URI);
    case 'postgres':
      return new PostgresStore(env.STORAGE_POSTGRES_URL);
    default:
      throw new Error(`Unsupported STORAGE_BACKEND: ${env.STORAGE_BACKEND as string}`);
  }
}

/** Returns the process-wide singleton StorageAdapter selected by STORAGE_BACKEND. */
export function getStorageAdapter(): StorageAdapter {
  instance ??= build();
  return instance;
}

/** Test/shutdown helper: closes and clears the singleton so a fresh one is built next call. */
export async function resetStorageAdapter(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}
