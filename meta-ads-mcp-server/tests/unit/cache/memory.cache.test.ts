import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryCache } from '../../../src/cache/memory.cache.js';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  it('round-trips a stored value', async () => {
    await cache.set('ns', 'a', { hello: 'world' }, 60);
    await expect(cache.get('ns', 'a')).resolves.toEqual({ hello: 'world' });
  });

  it('returns null for a missing key', async () => {
    await expect(cache.get('ns', 'missing')).resolves.toBeNull();
  });

  it('expires a value after its TTL', async () => {
    await cache.set('ns', 'b', { v: 1 }, 0.05);
    await expect(cache.get('ns', 'b')).resolves.toEqual({ v: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(cache.get('ns', 'b')).resolves.toBeNull();
  });

  it('invalidate(namespace, key) removes only that key', async () => {
    await cache.set('ns', 'a', 1, 60);
    await cache.set('ns', 'b', 2, 60);
    await cache.invalidate('ns', 'a');
    await expect(cache.get('ns', 'a')).resolves.toBeNull();
    await expect(cache.get('ns', 'b')).resolves.toBe(2);
  });

  it('invalidate(namespace) clears every key in that namespace only', async () => {
    await cache.set('ns', 'a', 1, 60);
    await cache.set('ns', 'b', 2, 60);
    await cache.set('other-ns', 'a', 3, 60);
    await cache.invalidate('ns');
    await expect(cache.get('ns', 'a')).resolves.toBeNull();
    await expect(cache.get('ns', 'b')).resolves.toBeNull();
    await expect(cache.get('other-ns', 'a')).resolves.toBe(3);
  });

  it('does not confuse namespaces with overlapping prefixes (e.g. "ns" vs "ns2")', async () => {
    await cache.set('ns', 'a', 'ns-value', 60);
    await cache.set('ns2', 'a', 'ns2-value', 60);
    await cache.invalidate('ns');
    await expect(cache.get('ns', 'a')).resolves.toBeNull();
    await expect(cache.get('ns2', 'a')).resolves.toBe('ns2-value');
  });

  it('close() clears all entries', async () => {
    await cache.set('ns', 'a', 1, 60);
    await cache.close();
    await expect(cache.get('ns', 'a')).resolves.toBeNull();
  });
});
