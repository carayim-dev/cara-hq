-- Cara HQ Dashboard v2 — Neon Postgres Schema
-- Run this against your Neon database to set up tables.

CREATE TABLE IF NOT EXISTS system_snapshots (
  id SERIAL PRIMARY KEY,
  node_name TEXT NOT NULL,          -- 'cara' or 'fox'
  cpu_usage REAL,                   -- percentage 0-100
  mem_total_gb REAL,
  mem_used_gb REAL,
  mem_free_gb REAL,
  disk_total_gb REAL,
  disk_used_gb REAL,
  disk_free_gb REAL,
  load_avg TEXT,                    -- JSON array [1m, 5m, 15m]
  uptime_seconds BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gateway_status (
  id SERIAL PRIMARY KEY,
  node_name TEXT NOT NULL,
  status TEXT,                      -- 'running', 'stopped', etc.
  version TEXT,
  pid INTEGER,
  uptime TEXT,
  sessions_active INTEGER,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT,
  session_type TEXT,
  channel TEXT,
  model TEXT,
  status TEXT,
  started_at TEXT,
  duration TEXT,
  messages INTEGER,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  col TEXT NOT NULL DEFAULT 'ideas',  -- ideas, queued, in-progress, done
  project TEXT,
  time_minutes INTEGER DEFAULT 0,
  cost_estimate REAL DEFAULT 0,
  task_created_at TEXT,
  task_updated_at TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT,
  summary TEXT,
  details JSONB,
  source TEXT,                      -- 'sync', 'manual', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fleet_nodes (
  id SERIAL PRIMARY KEY,
  node_name TEXT UNIQUE NOT NULL,
  ip TEXT,
  role TEXT,
  status TEXT,                      -- 'online', 'offline'
  gateway_status TEXT,
  last_seen TIMESTAMPTZ,
  extra JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_snapshots_node_time ON system_snapshots(node_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_node_time ON gateway_status(node_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_col ON kanban_tasks(col);

-- Calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  event_hour INTEGER DEFAULT 0,        -- 0-23
  event_time TEXT,                      -- 'HH:MM' display string
  event_type TEXT,                      -- 'cron', 'scheduled', 'task', 'reminder'
  source TEXT DEFAULT 'Cara',           -- 'Cara' or 'Fox'
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent errors
CREATE TABLE IF NOT EXISTS agent_errors (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'error',        -- 'critical', 'error', 'warning', 'info'
  source TEXT,                          -- 'sync.js', 'gateway', 'browser', etc.
  count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service health checks
CREATE TABLE IF NOT EXISTS service_health (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  healthy BOOLEAN DEFAULT true,
  http_code TEXT,
  last_check TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(event_date, event_hour);
CREATE INDEX IF NOT EXISTS idx_errors_time ON agent_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_name ON service_health(name);

-- Cleanup: keep only last 24h of snapshots (run periodically)
-- DELETE FROM system_snapshots WHERE created_at < NOW() - INTERVAL '24 hours';
-- DELETE FROM gateway_status WHERE created_at < NOW() - INTERVAL '24 hours';
-- DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '1 hour';
