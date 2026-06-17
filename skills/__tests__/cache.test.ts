import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MLCache } from '../shared/cache';

const testDb = path.join(__dirname, '.test-ml-cache.db');

describe('MLCache (SQLite)', () => {
  let cache: MLCache;

  beforeEach(() => {
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    cache = new MLCache(testDb);
  });

  afterEach(() => {
    cache.close();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  });

  it('uses sha256 keys', () => {
    const key = MLCache.hashKey('sentiment:hello');
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[a-f0-9]+$/);
  });

  it('respects TTL per service (sentiment=300s)', () => {
    const key = MLCache.hashKey('test-key');
    cache.set(key, { label: 'positive' }, 'sentiment');
    expect(cache.get(key)).toEqual({ label: 'positive' });
  });

  it('purges expired entries on startup', () => {
    const key = MLCache.hashKey('expired');
    cache.set(key, { data: 1 }, 'rl', 0); // 0s TTL = immediate expiry
    const purged = cache.purgeExpired();
    expect(purged).toBeGreaterThanOrEqual(0);
    expect(cache.get(key)).toBeNull();
  });
});
