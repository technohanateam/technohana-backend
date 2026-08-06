import pg from 'pg';
import type { StorageAdapter } from '../types/storage.types.js';

const { Pool } = pg;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS kv_store (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    PRIMARY KEY (namespace, key)
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    namespace TEXT NOT NULL,
    entry JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS audit_log_namespace_created_at_idx ON audit_log (namespace, created_at DESC);
`;

export class PostgresStore implements StorageAdapter {
  private readonly pool: pg.Pool;
  private schemaReady: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(SCHEMA_SQL).then(() => undefined);
    return this.schemaReady;
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    await this.ensureSchema();
    const result = await this.pool.query<{ value: T; expires_at: Date | null }>(
      'SELECT value, expires_at FROM kv_store WHERE namespace = $1 AND key = $2',
      [namespace, key],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
    return row.value;
  }

  async set<T>(namespace: string, key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ensureSchema();
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    await this.pool.query(
      `INSERT INTO kv_store (namespace, key, value, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (namespace, key) DO UPDATE SET value = $3, expires_at = $4`,
      [namespace, key, JSON.stringify(value), expiresAt],
    );
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('DELETE FROM kv_store WHERE namespace = $1 AND key = $2', [namespace, key]);
  }

  async listKeys(namespace: string): Promise<string[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ key: string }>(
      'SELECT key FROM kv_store WHERE namespace = $1 AND (expires_at IS NULL OR expires_at > now())',
      [namespace],
    );
    return result.rows.map((row) => row.key);
  }

  async appendLog<T>(namespace: string, entry: T): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('INSERT INTO audit_log (namespace, entry) VALUES ($1, $2)', [
      namespace,
      JSON.stringify(entry),
    ]);
  }

  async readLog<T>(namespace: string, limit = 100): Promise<T[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ entry: T }>(
      'SELECT entry FROM audit_log WHERE namespace = $1 ORDER BY created_at DESC LIMIT $2',
      [namespace, limit],
    );
    return result.rows.map((row) => row.entry);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
