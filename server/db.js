import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'inventory.db');

let db = null;

export async function initDb() {
  // Allow re-open after close (e.g. after import overwrites the file)
  db = null;

  const sqlite3Verbose = sqlite3.verbose();

  db = await open({
    filename: dbPath,
    driver: sqlite3Verbose.Database
  });

  await db.run('PRAGMA foreign_keys = ON');

  // Multi-process safety: the server and any delegated subagent (separate Node
  // process) open the same inventory.db. The default rollback journal
  // (journal_mode=delete) + busy_timeout=0 makes concurrent access fail
  // immediately with "SQLITE_BUSY: database is locked". WAL allows concurrent
  // readers and a single writer across processes, and busy_timeout makes
  // writers retry instead of erroring. synchronous=NORMAL is safe with WAL.
  await db.run('PRAGMA journal_mode = WAL');
  await db.run('PRAGMA busy_timeout = 5000');
  await db.run('PRAGMA synchronous = NORMAL');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bins (
      id TEXT PRIMARY KEY,
      qr_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      bin_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      search_tags TEXT,
      visible_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bin_id) REFERENCES bins (id) ON DELETE CASCADE
    );

    -- FTS5 Virtual Table
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      item_id UNINDEXED,
      name,
      description,
      search_tags,
      visible_text
    );

    -- Triggers to sync items and items_fts
    CREATE TRIGGER IF NOT EXISTS items_after_insert
    AFTER INSERT ON items
    BEGIN
      INSERT INTO items_fts (item_id, name, description, search_tags, visible_text)
      VALUES (new.id, new.name, new.description, new.search_tags, new.visible_text);
    END;

    CREATE TRIGGER IF NOT EXISTS items_after_update
    AFTER UPDATE ON items
    BEGIN
      UPDATE items_fts
      SET name = new.name,
          description = new.description,
          search_tags = new.search_tags,
          visible_text = new.visible_text
      WHERE item_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS items_after_delete
    AFTER DELETE ON items
    BEGIN
      DELETE FROM items_fts WHERE item_id = old.id;
    END;

    -- Audit trail: full snapshot on every mutation
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      description TEXT NOT NULL,
      bins_snapshot TEXT NOT NULL,
      items_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      granularity TEXT DEFAULT 'individual'
    );

    -- 72-hour image quarantine before permanent deletion
    CREATE TABLE IF NOT EXISTS image_quarantine (
      id TEXT PRIMARY KEY,
      image_path TEXT NOT NULL,
      quarantined_at TEXT NOT NULL
    );
  `);

  return db;
}

export async function closeDb() {
  if (db) {
    await db.close();
    db = null;
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}
