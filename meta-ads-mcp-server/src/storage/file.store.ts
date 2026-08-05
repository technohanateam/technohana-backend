import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StorageAdapter } from '../types/storage.types.js';

interface FileStoreEntry<T = unknown> {
  value: T;
  expiresAt: number | null;
}

interface FileStoreDocument {
  namespaces: Record<string, Record<string, FileStoreEntry>>;
  logs: Record<string, unknown[]>;
}

const EMPTY_DOCUMENT: FileStoreDocument = { namespaces: {}, logs: {} };

/**
 * AES-256-GCM encrypted JSON file storage. This is the default backend, intended
 * for single-instance/local deployments. Writes are serialized through an
 * in-process queue so concurrent async callers never interleave a read-modify-write.
 */
export class FileStore implements StorageAdapter {
  private readonly filePath: string;
  private readonly encryptionKey: Buffer;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string, encryptionKeyHex: string | undefined) {
    if (!encryptionKeyHex || encryptionKeyHex.length !== 64) {
      throw new Error(
        'FILE_STORE_ENCRYPTION_KEY must be set to a 32-byte hex string (64 hex chars) when STORAGE_BACKEND=file. Generate with: openssl rand -hex 32',
      );
    }
    this.filePath = filePath;
    this.encryptionKey = Buffer.from(encryptionKeyHex, 'hex');
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  private decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  private async readDocument(): Promise<FileStoreDocument> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      if (!raw.trim()) return structuredClone(EMPTY_DOCUMENT);
      return JSON.parse(this.decrypt(raw)) as FileStoreDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return structuredClone(EMPTY_DOCUMENT);
      }
      throw error;
    }
  }

  private async writeDocument(doc: FileStoreDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const encrypted = this.encrypt(JSON.stringify(doc));
    await writeFile(this.filePath, encrypted, 'utf8');
  }

  /** Serializes a read-modify-write cycle against the file. */
  private mutate<T>(fn: (doc: FileStoreDocument) => Promise<T> | T): Promise<T> {
    const task = this.writeQueue.then(async () => {
      const doc = await this.readDocument();
      const result = await fn(doc);
      await this.writeDocument(doc);
      return result;
    });
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    const doc = await this.readDocument();
    const entry = doc.namespaces[namespace]?.[key];
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) return null;
    return entry.value as T;
  }

  async set<T>(namespace: string, key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.mutate((doc) => {
      doc.namespaces[namespace] ??= {};
      doc.namespaces[namespace][key] = {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      };
    });
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.mutate((doc) => {
      if (doc.namespaces[namespace]) {
        delete doc.namespaces[namespace][key];
      }
    });
  }

  async listKeys(namespace: string): Promise<string[]> {
    const doc = await this.readDocument();
    const entries = doc.namespaces[namespace] ?? {};
    const now = Date.now();
    return Object.entries(entries)
      .filter(([, entry]) => entry.expiresAt === null || entry.expiresAt >= now)
      .map(([key]) => key);
  }

  async appendLog<T>(namespace: string, entry: T): Promise<void> {
    await this.mutate((doc) => {
      doc.logs[namespace] ??= [];
      doc.logs[namespace].push(entry);
    });
  }

  async readLog<T>(namespace: string, limit = 100): Promise<T[]> {
    const doc = await this.readDocument();
    const log = doc.logs[namespace] ?? [];
    return log.slice(-limit).reverse() as T[];
  }

  async ping(): Promise<void> {
    await this.readDocument();
  }

  async close(): Promise<void> {
    await this.writeQueue;
  }
}
