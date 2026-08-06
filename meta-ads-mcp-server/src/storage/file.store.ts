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
 * for single-instance/local deployments.
 *
 * The document is loaded into memory once and every operation (reads included)
 * is serialized through a single in-process queue. Routing reads through the
 * same queue as writes is deliberate: without it, a `get()` firing while a
 * `set()` is mid-flight could observe a half-written file on disk (a torn
 * read/write) or a stale-but-inconsistent in-memory snapshot. Serializing
 * everything trades a little read latency for correctness.
 */
export class FileStore implements StorageAdapter {
  private readonly filePath: string;
  private readonly encryptionKey: Buffer;
  private doc: FileStoreDocument | null = null;
  private queue: Promise<unknown> = Promise.resolve();

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

  /** Loads the document from disk into memory on first use; subsequent calls reuse it. */
  private async load(): Promise<FileStoreDocument> {
    if (this.doc) return this.doc;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.doc = raw.trim() ? (JSON.parse(this.decrypt(raw)) as FileStoreDocument) : structuredClone(EMPTY_DOCUMENT);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.doc = structuredClone(EMPTY_DOCUMENT);
      } else {
        throw error;
      }
    }
    return this.doc;
  }

  private async persist(): Promise<void> {
    if (!this.doc) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, this.encrypt(JSON.stringify(this.doc)), 'utf8');
  }

  /**
   * Runs `fn` against the in-memory document, serialized behind the write queue.
   * Pass `persistAfter: true` for any operation that mutates the document.
   */
  private run<T>(fn: (doc: FileStoreDocument) => T | Promise<T>, persistAfter: boolean): Promise<T> {
    const task = this.queue.then(async () => {
      const doc = await this.load();
      const result = await fn(doc);
      if (persistAfter) await this.persist();
      return result;
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    return this.run((doc) => {
      const entry = doc.namespaces[namespace]?.[key];
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt < Date.now()) return null;
      return entry.value as T;
    }, false);
  }

  async set<T>(namespace: string, key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.run((doc) => {
      doc.namespaces[namespace] ??= {};
      doc.namespaces[namespace][key] = {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      };
    }, true);
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.run((doc) => {
      if (doc.namespaces[namespace]) {
        delete doc.namespaces[namespace][key];
      }
    }, true);
  }

  async listKeys(namespace: string): Promise<string[]> {
    return this.run((doc) => {
      const entries = doc.namespaces[namespace] ?? {};
      const now = Date.now();
      return Object.entries(entries)
        .filter(([, entry]) => entry.expiresAt === null || entry.expiresAt >= now)
        .map(([key]) => key);
    }, false);
  }

  async appendLog<T>(namespace: string, entry: T): Promise<void> {
    await this.run((doc) => {
      doc.logs[namespace] ??= [];
      doc.logs[namespace].push(entry);
    }, true);
  }

  async readLog<T>(namespace: string, limit = 100): Promise<T[]> {
    return this.run((doc) => {
      const log = doc.logs[namespace] ?? [];
      return log.slice(-limit).reverse() as T[];
    }, false);
  }

  async ping(): Promise<void> {
    await this.run(() => undefined, false);
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
