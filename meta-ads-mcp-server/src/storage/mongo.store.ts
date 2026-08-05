import { MongoClient } from 'mongodb';
import type { Collection, Db } from 'mongodb';
import type { StorageAdapter } from '../types/storage.types.js';

interface KvDocument {
  namespace: string;
  key: string;
  value: unknown;
  expiresAt: Date | null;
}

interface LogDocument {
  namespace: string;
  entry: unknown;
  createdAt: Date;
}

export class MongoStore implements StorageAdapter {
  private readonly client: MongoClient;
  private db: Db | null = null;
  private ready: Promise<void>;

  constructor(uri: string) {
    this.client = new MongoClient(uri);
    this.ready = this.connect();
  }

  private async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db();
    await this.kvCollection().createIndex({ namespace: 1, key: 1 }, { unique: true });
    await this.kvCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.logCollection().createIndex({ namespace: 1, createdAt: -1 });
  }

  private kvCollection(): Collection<KvDocument> {
    if (!this.db) throw new Error('MongoStore used before connection established');
    return this.db.collection<KvDocument>('kv_store');
  }

  private logCollection(): Collection<LogDocument> {
    if (!this.db) throw new Error('MongoStore used before connection established');
    return this.db.collection<LogDocument>('audit_log');
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    await this.ready;
    const doc = await this.kvCollection().findOne({ namespace, key });
    if (!doc) return null;
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) return null;
    return doc.value as T;
  }

  async set<T>(namespace: string, key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ready;
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    await this.kvCollection().updateOne(
      { namespace, key },
      { $set: { namespace, key, value, expiresAt } },
      { upsert: true },
    );
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.ready;
    await this.kvCollection().deleteOne({ namespace, key });
  }

  async listKeys(namespace: string): Promise<string[]> {
    await this.ready;
    const now = new Date();
    const docs = await this.kvCollection()
      .find({ namespace, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] })
      .project<{ key: string }>({ key: 1, _id: 0 })
      .toArray();
    return docs.map((d) => d.key);
  }

  async appendLog<T>(namespace: string, entry: T): Promise<void> {
    await this.ready;
    await this.logCollection().insertOne({ namespace, entry, createdAt: new Date() });
  }

  async readLog<T>(namespace: string, limit = 100): Promise<T[]> {
    await this.ready;
    const docs = await this.logCollection()
      .find({ namespace })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => d.entry as T);
  }

  async ping(): Promise<void> {
    await this.ready;
    if (!this.db) throw new Error('MongoStore not connected');
    await this.db.command({ ping: 1 });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
