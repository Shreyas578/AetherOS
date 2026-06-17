import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class MLCache {
  private db: Database.Database;
  private readonly defaultTTLs: Record<string, number> = {
    sentiment: 300,
    forecast: 600,
    rl: 60,
  };

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || process.env.SQLITE_CACHE_PATH || './cache/ml_cache.db';
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.initialize();
    this.purgeExpired();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        hit_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_expires ON cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_service ON cache(service);
    `);
  }

  /** sha256 hash of input string */
  static hashKey(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  get<T>(key: string): T | null {
    const row = this.db.prepare(
      'SELECT value, expires_at FROM cache WHERE key = ?'
    ).get(key) as { value: string; expires_at: number } | undefined;

    if (!row) return null;
    if (Date.now() > row.expires_at) {
      this.db.prepare('DELETE FROM cache WHERE key = ?').run(key);
      return null;
    }

    this.db.prepare('UPDATE cache SET hit_count = hit_count + 1 WHERE key = ?').run(key);
    return JSON.parse(row.value) as T;
  }

  set<T>(key: string, value: T, service: string, ttlSeconds?: number): void {
    const ttl = (ttlSeconds ?? this.defaultTTLs[service] ?? 300) * 1000;
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO cache (key, service, value, created_at, expires_at, hit_count)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(key, service, JSON.stringify(value), now, now + ttl);
  }

  purgeExpired(): number {
    const result = this.db.prepare('DELETE FROM cache WHERE expires_at < ?').run(Date.now());
    return result.changes;
  }

  stats(): { total: number; byService: Record<string, number> } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM cache').get() as { c: number }).c;
    const rows = this.db.prepare(
      'SELECT service, COUNT(*) as c FROM cache GROUP BY service'
    ).all() as { service: string; c: number }[];
    const byService: Record<string, number> = {};
    rows.forEach(r => (byService[r.service] = r.c));
    return { total, byService };
  }

  close(): void {
    this.db.close();
  }
}
