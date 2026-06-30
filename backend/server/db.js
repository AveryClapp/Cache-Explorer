/**
 * SQLite Database Layer
 * Handles compilation cache and URL shortener storage
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'cache-explorer.db');

let db = null;
let dbUnavailableError = null;

function emptyStats(available = false) {
  return {
    available,
    cache: {
      entries: 0,
      sizeBytes: 0,
      totalHits: 0,
    },
    urls: {
      count: 0,
      totalAccesses: 0,
    },
  };
}

function ensureDb() {
  if (db) return true;
  if (dbUnavailableError) return false;

  try {
    initDb();
    return true;
  } catch {
    return false;
  }
}

function unavailableError() {
  const err = new Error(
    `Database unavailable${dbUnavailableError ? `: ${dbUnavailableError.message}` : ''}`
  );
  err.code = 'DB_UNAVAILABLE';
  return err;
}

/**
 * Initialize database and create tables
 */
export function initDb() {
  if (db) return db;
  if (dbUnavailableError) throw dbUnavailableError;

  try {
    // Create data directory if needed
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Compilation cache table
    db.exec(`
      CREATE TABLE IF NOT EXISTS compilation_cache (
        hash TEXT PRIMARY KEY,
        result TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER,
        hits INTEGER DEFAULT 0,
        size_bytes INTEGER
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cache_accessed
      ON compilation_cache(last_accessed)
    `);

    // URL shortener table
    db.exec(`
      CREATE TABLE IF NOT EXISTS short_urls (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER
      )
    `);

    console.log('Database initialized at', DB_PATH);
    return db;
  } catch (err) {
    db = null;
    dbUnavailableError = err;
    throw err;
  }
}

/**
 * Get cached compilation result
 */
export function getCache(hash) {
  if (!ensureDb()) return null;

  const stmt = db.prepare(`
    SELECT result FROM compilation_cache WHERE hash = ?
  `);
  const row = stmt.get(hash);

  if (row) {
    // Update access stats
    const updateStmt = db.prepare(`
      UPDATE compilation_cache
      SET last_accessed = ?, hits = hits + 1
      WHERE hash = ?
    `);
    updateStmt.run(Date.now(), hash);
    return row.result;
  }

  return null;
}

/**
 * Store compilation result in cache
 */
export function setCache(hash, result) {
  if (!ensureDb()) return 0;

  const sizeBytes = Buffer.byteLength(result, 'utf8');
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO compilation_cache
    (hash, result, created_at, last_accessed, hits, size_bytes)
    VALUES (?, ?, ?, ?, 0, ?)
  `);

  stmt.run(hash, result, now, now, sizeBytes);
  return sizeBytes;
}

/**
 * Prune old/excess cache entries
 */
export function pruneCache(maxSizeBytes = 1024 * 1024 * 1024, maxAgeDays = 7) {
  if (!ensureDb()) {
    return {
      deleted: 0,
      freedBytes: 0,
    };
  }

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - maxAgeMs;

  // Delete old entries
  const deleteOld = db.prepare(`
    DELETE FROM compilation_cache WHERE created_at < ?
  `);
  const oldResult = deleteOld.run(cutoffTime);

  // Check total size
  const sizeStmt = db.prepare(`
    SELECT SUM(size_bytes) as total FROM compilation_cache
  `);
  const { total } = sizeStmt.get() || { total: 0 };

  let deletedForSize = 0;
  let freedBytes = 0;

  // If over limit, delete LRU entries
  if (total > maxSizeBytes) {
    const excess = total - maxSizeBytes;
    const lruStmt = db.prepare(`
      SELECT hash, size_bytes FROM compilation_cache
      ORDER BY last_accessed ASC
    `);

    const toDelete = [];
    let accumulated = 0;

    for (const row of lruStmt.iterate()) {
      toDelete.push(row.hash);
      accumulated += row.size_bytes || 0;
      freedBytes += row.size_bytes || 0;
      if (accumulated >= excess) break;
    }

    if (toDelete.length > 0) {
      const deleteStmt = db.prepare(`
        DELETE FROM compilation_cache WHERE hash = ?
      `);
      const deleteMany = db.transaction((hashes) => {
        for (const h of hashes) deleteStmt.run(h);
      });
      deleteMany(toDelete);
      deletedForSize = toDelete.length;
    }
  }

  return {
    deleted: oldResult.changes + deletedForSize,
    freedBytes,
  };
}

/**
 * Generate short URL code
 */
function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Create a short URL
 */
export function createShortUrl(data) {
  if (!ensureDb()) throw unavailableError();

  const code = generateCode();
  const now = Date.now();
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

  const stmt = db.prepare(`
    INSERT INTO short_urls (code, data, created_at, last_accessed)
    VALUES (?, ?, ?, ?)
  `);

  try {
    stmt.run(code, dataStr, now, now);
    return code;
  } catch (e) {
    // Collision - try again (extremely rare)
    if (e.code === 'SQLITE_CONSTRAINT') {
      return createShortUrl(data);
    }
    throw e;
  }
}

/**
 * Get data for short URL
 */
export function getShortUrl(code) {
  if (!ensureDb()) throw unavailableError();

  const stmt = db.prepare(`
    SELECT data FROM short_urls WHERE code = ?
  `);
  const row = stmt.get(code);

  if (row) {
    // Update access stats
    const updateStmt = db.prepare(`
      UPDATE short_urls
      SET last_accessed = ?, access_count = access_count + 1
      WHERE code = ?
    `);
    updateStmt.run(Date.now(), code);

    try {
      return JSON.parse(row.data);
    } catch {
      return row.data;
    }
  }

  return null;
}

/**
 * Get database stats
 */
export function getDbStats() {
  if (!ensureDb()) return emptyStats(false);

  const cacheStats = db.prepare(`
    SELECT COUNT(*) as count, SUM(size_bytes) as size, SUM(hits) as hits
    FROM compilation_cache
  `).get();

  const urlStats = db.prepare(`
    SELECT COUNT(*) as count, SUM(access_count) as accesses
    FROM short_urls
  `).get();

  return {
    available: true,
    cache: {
      entries: cacheStats?.count || 0,
      sizeBytes: cacheStats?.size || 0,
      totalHits: cacheStats?.hits || 0,
    },
    urls: {
      count: urlStats?.count || 0,
      totalAccesses: urlStats?.accesses || 0,
    },
  };
}

/**
 * Check if database is healthy
 */
export function isHealthy() {
  try {
    if (!ensureDb()) return false;
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close database connection
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export default {
  initDb,
  getCache,
  setCache,
  pruneCache,
  createShortUrl,
  getShortUrl,
  getDbStats,
  isHealthy,
  closeDb,
};
