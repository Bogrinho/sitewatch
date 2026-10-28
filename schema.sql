-- Separate Cloudflare database. No existing local history is modified.
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT, slow_ms INTEGER NOT NULL DEFAULT 2000,
  slow_streak INTEGER NOT NULL DEFAULT 0, slow_active INTEGER NOT NULL DEFAULT 0,
  ssl_alerted INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id TEXT NOT NULL, checked_at TEXT NOT NULL,
  success INTEGER NOT NULL, response_time_ms REAL, status_code INTEGER, error TEXT,
  ssl_days_remaining INTEGER, ssl_error TEXT
);
CREATE INDEX IF NOT EXISTS checks_monitor_time ON checks(monitor_id, checked_at);
CREATE INDEX IF NOT EXISTS checks_time ON checks(checked_at);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, title TEXT NOT NULL,
  started_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS incidents_monitor_time ON incidents(monitor_id, started_at);
CREATE TABLE IF NOT EXISTS alert_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), recipient TEXT NOT NULL DEFAULT '',
  ssl_days INTEGER NOT NULL DEFAULT 14, weekly_enabled INTEGER NOT NULL DEFAULT 1,
  last_week TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL, sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  monitor_id TEXT, cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS cycle_lock (
  id INTEGER PRIMARY KEY CHECK(id = 1), lock_until TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO cycle_lock(id) VALUES(1);
CREATE TABLE IF NOT EXISTS ssl_cache (
  monitor_id TEXT PRIMARY KEY, not_after INTEGER, observed_at TEXT, next_attempt TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO alert_settings(id) VALUES(1);
