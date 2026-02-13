#!/usr/bin/env node
// Cara HQ Dashboard v2 — Data Sync Script
// Runs locally on Cara's Mac mini, pushes data to Neon Postgres every 2 min via cron.
// Usage: node sync.js
// Cron:  */2 * * * * cd /Users/cara/.openclaw/workspace/projects/cara-dashboard-v2 && node sync.js >> /tmp/cara-sync.log 2>&1

const { execSync } = require('child_process');
const os = require('os');
const https = require('https');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────────────────
// Set NEON_DATABASE_URL in environment or .env file
const DATABASE_URL = process.env.NEON_DATABASE_URL || '';
if (!DATABASE_URL) {
  // Try loading from .env
  try {
    const envFile = fs.readFileSync(__dirname + '/.env', 'utf8');
    const match = envFile.match(/NEON_DATABASE_URL=(.+)/);
    if (match) process.env.NEON_DATABASE_URL = match[1].trim();
  } catch {}
}
const NEON_URL = process.env.NEON_DATABASE_URL || DATABASE_URL;
if (!NEON_URL) {
  console.error('ERROR: Set NEON_DATABASE_URL in environment or .env file');
  process.exit(1);
}

const FOX_SSH = 'fox@fox-mini.local'; // Adjust as needed
const TASKS_PATH = os.homedir() + '/.openclaw/workspace/projects/cara-kanban/data/tasks.json';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function run(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return null;
  }
}

function parseNeonUrl(url) {
  // postgresql://user:pass@host/dbname?sslmode=require
  const u = new URL(url);
  return {
    host: u.hostname,
    user: u.username,
    password: u.password,
    database: u.pathname.slice(1),
    port: u.port || '5432',
  };
}

// Neon serverless HTTP query via their SQL-over-HTTP endpoint
async function neonQuery(sql, params = []) {
  const conn = parseNeonUrl(NEON_URL);
  const body = JSON.stringify({ query: sql, params });
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: conn.host,
      port: 443,
      path: '/sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': NEON_URL,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Neon HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Alternative: use pg directly if @neondatabase/serverless isn't available
let pgClient = null;
async function query(sql, params = []) {
  // Try using pg module directly
  if (!pgClient) {
    try {
      const { Client } = require('pg');
      pgClient = new Client({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });
      await pgClient.connect();
    } catch {
      pgClient = 'http'; // fallback to HTTP
    }
  }
  
  if (pgClient === 'http') {
    return neonQuery(sql, params);
  }
  
  return pgClient.query(sql, params);
}

// ─── Data Collectors ──────────────────────────────────────────────────────────
function getLocalSystemStats() {
  const cpus = os.cpus();
  const cpuUsage = cpus.reduce((sum, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return sum + ((total - idle) / total * 100);
  }, 0) / cpus.length;

  const memTotal = os.totalmem() / (1024 ** 3);
  const memFree = os.freemem() / (1024 ** 3);

  let diskTotal = 0, diskUsed = 0, diskFree = 0;
  const df = run("df -g / | tail -1 | awk '{print $2, $3, $4}'");
  if (df) {
    const [t, u, f] = df.split(/\s+/).map(Number);
    diskTotal = t; diskUsed = u; diskFree = f;
  }

  const loadAvg = os.loadavg();
  
  return {
    node_name: 'cara',
    cpu_usage: Math.round(cpuUsage * 10) / 10,
    mem_total_gb: Math.round(memTotal * 100) / 100,
    mem_used_gb: Math.round((memTotal - memFree) * 100) / 100,
    mem_free_gb: Math.round(memFree * 100) / 100,
    disk_total_gb: diskTotal,
    disk_used_gb: diskUsed,
    disk_free_gb: diskFree,
    load_avg: JSON.stringify(loadAvg.map(v => Math.round(v * 100) / 100)),
    uptime_seconds: os.uptime(),
  };
}

function getFoxStats() {
  const cmd = `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${FOX_SSH} "echo CPU:\$(top -l 1 -n 0 | grep 'CPU usage' | awk '{print \\\$3}') MEM:\$(vm_stat | awk '/Pages free/{print \\\$3}') DISK:\$(df -g / | tail -1 | awk '{print \\\$2,\\\$3,\\\$4}') UP:\$(sysctl -n kern.boottime | awk '{print \\\$4}' | tr -d ',')"`;
  const result = run(cmd, 15000);
  if (!result) return null;
  
  // Simplified: just mark online/offline and get basic stats
  return {
    node_name: 'fox',
    cpu_usage: 0,
    mem_total_gb: 0,
    mem_used_gb: 0,
    mem_free_gb: 0,
    disk_total_gb: 0,
    disk_used_gb: 0,
    disk_free_gb: 0,
    load_avg: '[]',
    uptime_seconds: 0,
    online: true,
  };
}

function getGatewayStatus() {
  const raw = run('openclaw gateway status 2>&1');
  if (!raw) return null;

  const status = raw.includes('running') ? 'running' : raw.includes('stopped') ? 'stopped' : 'unknown';
  const vMatch = raw.match(/version[:\s]+([^\s,]+)/i);
  const pidMatch = raw.match(/pid[:\s]+(\d+)/i);
  const uptimeMatch = raw.match(/uptime[:\s]+([^\n]+)/i);

  return {
    node_name: 'cara',
    status,
    version: vMatch?.[1] || null,
    pid: pidMatch ? parseInt(pidMatch[1]) : null,
    uptime: uptimeMatch?.[1]?.trim() || null,
    raw_json: raw,
  };
}

function getSessions() {
  const raw = run('openclaw status 2>&1');
  if (!raw) return [];
  
  // Parse session lines — format varies, capture what we can
  const sessions = [];
  const lines = raw.split('\n');
  let currentSession = null;
  
  for (const line of lines) {
    if (line.includes('session') || line.includes('Session')) {
      if (currentSession) sessions.push(currentSession);
      currentSession = { raw: line };
    } else if (currentSession && line.trim()) {
      currentSession.raw += '\n' + line;
    }
  }
  if (currentSession) sessions.push(currentSession);
  
  return [{ raw_json: raw, sessions_text: raw }];
}

function getKanbanTasks() {
  try {
    const data = fs.readFileSync(TASKS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// ─── Main Sync ────────────────────────────────────────────────────────────────
async function sync() {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] Sync starting...`);

  try {
    // 1. System snapshots
    const cara = getLocalSystemStats();
    await query(
      `INSERT INTO system_snapshots (node_name, cpu_usage, mem_total_gb, mem_used_gb, mem_free_gb, disk_total_gb, disk_used_gb, disk_free_gb, load_avg, uptime_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [cara.node_name, cara.cpu_usage, cara.mem_total_gb, cara.mem_used_gb, cara.mem_free_gb, cara.disk_total_gb, cara.disk_used_gb, cara.disk_free_gb, cara.load_avg, cara.uptime_seconds]
    );
    console.log('  ✓ Cara system stats');

    // Fox stats (best effort)
    const fox = getFoxStats();
    if (fox?.online) {
      await query(
        `INSERT INTO system_snapshots (node_name, cpu_usage, mem_total_gb, mem_used_gb, mem_free_gb, disk_total_gb, disk_used_gb, disk_free_gb, load_avg, uptime_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [fox.node_name, fox.cpu_usage, fox.mem_total_gb, fox.mem_used_gb, fox.mem_free_gb, fox.disk_total_gb, fox.disk_used_gb, fox.disk_free_gb, fox.load_avg, fox.uptime_seconds]
      );
    }
    // Update fleet_nodes
    await query(
      `INSERT INTO fleet_nodes (node_name, role, status, updated_at) VALUES ('cara', 'primary', 'online', NOW())
       ON CONFLICT (node_name) DO UPDATE SET status='online', updated_at=NOW()`
    );
    await query(
      `INSERT INTO fleet_nodes (node_name, role, status, updated_at) VALUES ('fox', 'secondary', $1, NOW())
       ON CONFLICT (node_name) DO UPDATE SET status=$1, updated_at=NOW()`,
      [fox?.online ? 'online' : 'offline']
    );
    console.log('  ✓ Fleet nodes');

    // 2. Gateway status
    const gw = getGatewayStatus();
    if (gw) {
      await query(
        `INSERT INTO gateway_status (node_name, status, version, pid, uptime, raw_json)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [gw.node_name, gw.status, gw.version, gw.pid, gw.uptime, gw.raw_json]
      );
      console.log('  ✓ Gateway status');
    }

    // 3. Sessions
    const sessData = getSessions();
    // Clear old sessions, insert fresh
    await query('DELETE FROM sessions WHERE created_at < NOW() - INTERVAL \'5 minutes\'');
    if (sessData.length > 0 && sessData[0].raw_json) {
      await query(
        `INSERT INTO sessions (session_id, raw_json) VALUES ('snapshot', $1)`,
        [sessData[0].raw_json]
      );
      console.log('  ✓ Sessions');
    }

    // 4. Kanban tasks
    const tasks = getKanbanTasks();
    if (tasks.length > 0) {
      // Upsert all tasks
      for (const t of tasks) {
        await query(
          `INSERT INTO kanban_tasks (id, title, description, col, project, time_minutes, cost_estimate, task_created_at, task_updated_at, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (id) DO UPDATE SET title=$2, description=$3, col=$4, project=$5, time_minutes=$6, cost_estimate=$7, task_updated_at=$9, synced_at=NOW()`,
          [t.id, t.title, t.description || '', t.column || t.col, t.project || '', t.timeMinutes || 0, t.costEstimate || 0, t.createdAt || '', t.updatedAt || '']
        );
      }
      // Remove tasks no longer in the file
      const ids = tasks.map(t => t.id);
      await query(`DELETE FROM kanban_tasks WHERE id != ALL($1)`, [ids]);
      console.log(`  ✓ Kanban tasks (${tasks.length})`);
    }

    // 5. Activity log entry
    await query(
      `INSERT INTO activity_log (event_type, summary, source) VALUES ('sync', 'Data sync completed', 'sync.js')`
    );

    // Cleanup old data
    await query(`DELETE FROM system_snapshots WHERE created_at < NOW() - INTERVAL '24 hours'`);
    await query(`DELETE FROM gateway_status WHERE created_at < NOW() - INTERVAL '24 hours'`);
    await query(`DELETE FROM activity_log WHERE created_at < NOW() - INTERVAL '7 days'`);

    const elapsed = Date.now() - start;
    console.log(`[${new Date().toISOString()}] Sync complete in ${elapsed}ms`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sync error:`, err.message);
    process.exit(1);
  }

  // Close pg connection if open
  if (pgClient && pgClient !== 'http') {
    await pgClient.end();
  }
}

sync();
