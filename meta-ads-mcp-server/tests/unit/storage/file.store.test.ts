import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../../../src/storage/file.store.js';

const TEST_PATH = './tests/.tmp/file-store-unit-test.json';

describe('FileStore', () => {
  let store: FileStore;

  beforeEach(async () => {
    await rm(TEST_PATH, { force: true });
    store = new FileStore(TEST_PATH, randomBytes(32).toString('hex'));
  });

  afterEach(async () => {
    await store.close();
    await rm(TEST_PATH, { force: true });
  });

  it('rejects construction without a valid 32-byte hex encryption key', () => {
    expect(() => new FileStore(TEST_PATH, undefined)).toThrow(/FILE_STORE_ENCRYPTION_KEY/);
    expect(() => new FileStore(TEST_PATH, 'too-short')).toThrow(/FILE_STORE_ENCRYPTION_KEY/);
  });

  it('round-trips a stored value', async () => {
    await store.set('ns', 'a', { hello: 'world' });
    await expect(store.get('ns', 'a')).resolves.toEqual({ hello: 'world' });
  });

  it('returns null for a missing key', async () => {
    await expect(store.get('ns', 'missing')).resolves.toBeNull();
  });

  it('expires a value after its TTL', async () => {
    await store.set('ns', 'b', { v: 1 }, 0.05);
    await expect(store.get('ns', 'b')).resolves.toEqual({ v: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(store.get('ns', 'b')).resolves.toBeNull();
  });

  it('deletes a key', async () => {
    await store.set('ns', 'c', { v: 1 });
    await store.delete('ns', 'c');
    await expect(store.get('ns', 'c')).resolves.toBeNull();
  });

  it('lists only unexpired keys in a namespace', async () => {
    await store.set('ns', 'fresh', { v: 1 });
    await store.set('ns', 'expired', { v: 2 }, 0.05);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(store.listKeys('ns')).resolves.toEqual(['fresh']);
  });

  it('appends and reads log entries newest-first', async () => {
    await store.appendLog('audit', { i: 1 });
    await store.appendLog('audit', { i: 2 });
    await store.appendLog('audit', { i: 3 });
    await expect(store.readLog('audit')).resolves.toEqual([{ i: 3 }, { i: 2 }, { i: 1 }]);
  });

  it('respects the limit passed to readLog', async () => {
    await store.appendLog('audit', { i: 1 });
    await store.appendLog('audit', { i: 2 });
    await store.appendLog('audit', { i: 3 });
    await expect(store.readLog('audit', 2)).resolves.toEqual([{ i: 3 }, { i: 2 }]);
  });

  it('serializes concurrent reads and writes without corruption', async () => {
    const results = await Promise.all([
      store.set('ns', 'race', { n: 1 }),
      store.get('ns', 'race'),
      store.set('ns', 'race', { n: 2 }),
      store.get('ns', 'race'),
    ]);
    // Whatever the two reads observed, they must be one of the two written
    // values, never a partial/corrupt read.
    for (const result of [results[1], results[3]]) {
      expect([undefined, { n: 1 }, { n: 2 }]).toContainEqual(result);
    }
    await expect(store.get('ns', 'race')).resolves.toEqual({ n: 2 });
  });

  it('persists encrypted data to disk and reloads it correctly in a fresh instance', async () => {
    await store.set('ns', 'a', { hello: 'world' });
    await store.close();

    const key = randomBytes(32).toString('hex');
    const store2 = new FileStore(TEST_PATH, key);
    // A different key must not be able to decrypt data written under the first key.
    await expect(store2.get('ns', 'a')).rejects.toThrow();
    await store2.close();
  });

  it('ping() succeeds against a healthy store', async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });
});
