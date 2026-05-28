import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath, { create: true });

// WAL gives us concurrent readers while the scheduler is writing;
// foreign_keys must be ON per-connection in SQLite.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config_encrypted BLOB NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 60,
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    failure_threshold INTEGER NOT NULL DEFAULT 2,
    success_threshold INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    muted_until INTEGER,
    group_name TEXT,
    is_public INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS monitor_state (
    monitor_id INTEGER PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
    current_status TEXT,
    since INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    last_checked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS check_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    checked_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_check_results_monitor_time
    ON check_results(monitor_id, checked_at DESC);

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS monitor_webhooks (
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    PRIMARY KEY (monitor_id, webhook_id)
  );

  CREATE TABLE IF NOT EXISTS alert_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    delivered_at INTEGER,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_alert_queue_pending
    ON alert_queue(next_attempt_at) WHERE delivered_at IS NULL;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    acked_at INTEGER,
    initial_detail TEXT,
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_incidents_open
    ON incidents(monitor_id) WHERE ended_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_incidents_started
    ON incidents(started_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Idempotent migrations: ALTER TABLE adds columns to existing DBs; on fresh
// DBs the CREATE TABLE above already includes them and these throw "duplicate
// column", which we swallow.
function tryAlter(sql: string): void {
  try {
    db.exec(sql);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (!msg.includes("duplicate column")) throw e;
  }
}
tryAlter("ALTER TABLE monitors ADD COLUMN muted_until INTEGER");
tryAlter("ALTER TABLE monitors ADD COLUMN group_name TEXT");
tryAlter("ALTER TABLE monitors ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1");
tryAlter("ALTER TABLE monitors ADD COLUMN notes TEXT");
tryAlter("ALTER TABLE incidents ADD COLUMN notes TEXT");

// Backfill: any monitor currently in 'down' state without a corresponding open
// incident gets one. This recovers history when the incidents table is added
// to a DB that already had down monitors, and is a no-op on a fresh boot.
db.run(`
  INSERT INTO incidents (monitor_id, started_at, initial_detail)
  SELECT s.monitor_id, COALESCE(s.since, ?), 'backfilled at server start'
  FROM monitor_state s
  LEFT JOIN incidents i ON i.monitor_id = s.monitor_id AND i.ended_at IS NULL
  WHERE s.current_status = 'down' AND i.id IS NULL
`, [Date.now()]);
