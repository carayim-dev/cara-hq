# Cara HQ Dashboard v2

Static dashboard for Cara's OpenClaw fleet. No framework, no build step, no server needed.

## Architecture

```
index.html (static) → Cloudflare Pages
     ↓ reads from
Neon Postgres (free tier)
     ↑ updated every 2 min by
sync.js (local cron on Cara's Mac mini)
```

## Quick Start

### 1. Set up Neon Database

1. Create a free Neon project at https://neon.tech
2. Run the schema:
   ```bash
   psql "YOUR_NEON_CONNECTION_STRING" -f schema.sql
   ```
3. Note your connection string and HTTP hostname

### 2. Configure the Dashboard

Edit `index.html`, find `NEON_CONFIG` near the top of the `<script>` block:

```javascript
const NEON_CONFIG = {
  host: 'ep-cool-name-123456.us-east-2.aws.neon.tech',
  connectionString: 'postgresql://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require',
};
```

### 3. Set up Data Sync

```bash
# Install pg driver
cd cara-dashboard-v2
npm init -y
npm install pg

# Create .env file
echo "NEON_DATABASE_URL=postgresql://user:pass@host/db?sslmode=require" > .env

# Test sync
node sync.js

# Add to cron (every 2 minutes)
crontab -e
# Add: */2 * * * * cd /Users/cara/.openclaw/workspace/projects/cara-dashboard-v2 && /usr/local/bin/node sync.js >> /tmp/cara-sync.log 2>&1
```

### 4. Deploy to Cloudflare Pages

**Option A: Wrangler CLI**
```bash
npx wrangler pages deploy . --project-name=cara-hq
```

**Option B: Cloudflare Dashboard**
1. Go to Cloudflare Dashboard → Pages → Create a project
2. Connect your Git repo or upload directly
3. Build command: (none)
4. Output directory: `.`
5. Set custom domain: `cara.bluemoonventures.com`

### 5. Open Locally

Just open `index.html` in a browser. Without Neon configured, it shows demo data.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Full dashboard (single-file, no build) |
| `sync.js` | Data pusher — collects system/gateway/session/kanban data → Neon |
| `schema.sql` | Neon Postgres table definitions |
| `README.md` | This file |
| `.env` | Neon connection string (create manually, not committed) |

## Auth

Password: `cara` (SHA-256 hash checked client-side). Session persists via sessionStorage.

## Features

- **Overview**: Gateway health, CPU/mem/disk, fleet status, task stats
- **Kanban**: Drag-and-drop task board (ideas/queued/in-progress/done)
- **Sessions**: Active OpenClaw sessions
- **Activity**: Recent sync/agent activity log
- Auto-refresh every 30 seconds
- Dark theme, mobile responsive
- Live clock

## Demo Mode

If Neon isn't configured, the dashboard renders with demo data so you can preview the UI.
