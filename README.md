# Uptime

A self-hosted uptime monitor with a public status page and an admin console — all served by a single [Bun](https://bun.sh) process.

- **Public by default.** Anyone with the URL sees monitor health, latency, uptime history, and active incidents. Secrets (target URLs, webhook tokens, SSH keys, error details) stay admin-only.
- **One process, one binary, one SQLite file.** No Redis, no message broker, no separate worker. The scheduler, alert delivery loop, and HTTP server all run in the same Bun runtime.
- **Three check types** out of the box: HTTP (with auth, headers, body matching, custom expected status), TCP port reachability, and SSH (key-based auth, optional command + exit-code assertion).
- **HTMX-driven UI**, no SPA. ~40 lines of vanilla JS for the sparkline tooltip + command palette. The rest is server-rendered TSX.

---

## Features

**Monitoring**
- HTTP/HTTPS · TCP · SSH (key-based)
- Per-monitor interval, timeout, failure threshold, success threshold
- Sparkline (latency, last hour) and 24h uptime strip per monitor
- Per-monitor groups, public/private visibility, mute (5m / 30m / 1h / 24h / indefinite)
- Bulk pause / resume / mute / delete

**Incidents**
- Auto-opened on `up → down`, auto-closed on `down → up`
- Acknowledge to silence the banner without resolving
- Optional auto-acknowledge after N minutes
- Open / Resolved / All tabs with per-incident timeline

**Alerts**
- Webhooks fire on state transitions (POST JSON payload)
- Exponential backoff with dead-letter (5s → 30s → 5m → 30m → dead)
- Mute suppresses delivery; incident still tracked

**Console**
- Live dashboard with KPI strip (Up · Down · p95 latency · MTTR)
- Search, filter (status / type / group), group by, density toggle (comfort / compact / dense)
- Dark + light themes (cookie-persisted)
- Command palette (⌘K on Mac · Ctrl+K elsewhere) for navigation, jumping to monitors by name, and quick actions
- Sound + tab-title flash on new unacked incidents
- Per-row 5s auto-refresh via HTMX

**API**
- REST JSON API at `/api/v1/*` for scripts, MCP servers, and IaC tools
- Bearer token auth with revocable, per-purpose tokens (mint in Settings)
- ~20 endpoints covering monitors, incidents, webhooks, stats — see the [API section](#api) below

**Security**
- Argon2id password hashing, session cookies (HttpOnly · SameSite=Lax)
- Per-IP login rate limiting (5/min)
- AES-256-GCM encryption at rest for all monitor configs
- Encryption key rotation re-encrypts all monitors in a single transaction
- Settings actions are admin-only; public viewers see only redacted summaries

**Operations**
- DB-backed credentials and encryption key (env values seed the DB on first boot)
- Configurable retention for check results, alert queue, incidents (with manual purge button)
- Active session list with individual revoke

---

## Quick start

```bash
git clone https://github.com/cryguy/uptime
cd uptime
bun install

# Generate secrets and an admin password hash
bun run keygen >> .env
bun run hash 'your-password' >> .env
echo 'ADMIN_USERNAME=admin' >> .env

# Run
bun run dev
```

Open <http://localhost:3000> for the public dashboard, or `/login` for the admin console.

To boot in production mode (skips the file watcher):

```bash
NODE_ENV=production bun run start
```

---

## Configuration

All configuration is via environment variables. `.env.example` is the canonical reference.

| Variable | Required | Description |
|---|---|---|
| `PORT` | – | Defaults to `3000`. |
| `ADMIN_USERNAME` | yes | Initial admin login. Mutable via UI after first boot. |
| `ADMIN_PASSWORD_HASH` | yes | Argon2id hash from `bun run hash`. **Note:** `$` characters must be backslash-escaped — the `hash` script does this automatically. |
| `SESSION_SECRET` | yes | 32 random bytes (hex). Generate with `bun run keygen`. |
| `ENCRYPTION_KEY` | yes | 32 random bytes (hex). Encrypts monitor configs at rest. **Losing this means losing every monitor's config.** Back it up out-of-band. |
| `DB_PATH` | – | Defaults to `./data/uptime.db`. |
| `INCIDENT_AUTO_ACK_MINUTES` | – | `0` (default) disables auto-ack. Otherwise, open unacked incidents older than this are silently acknowledged. |
| `NODE_ENV` | – | Set to `production` to enable the `Secure` cookie flag. |

After first boot, the admin username, password hash, and encryption key are mirrored into the `settings` table and become DB-canonical. You can change them via `/settings` without restarting; the env values become inert defaults that only apply if `settings` is wiped.

---

## How it works

**Scheduler.** A 1-second tick polls for monitors due to be checked (`last_checked_at + interval_seconds * 1000 <= now`). Each due monitor's check fires in parallel; an `inflight` set guarantees a single monitor never has two overlapping checks. State transitions follow a 4-rule machine: `null → up` (silent on first healthy check), `null/up → down` after `failure_threshold` consecutive failures, `down → up` after `success_threshold` consecutive successes. Only `→ down` and `→ up` transitions emit alerts; the initial `null → up` is silent so a fresh healthy monitor doesn't ping the team.

**Alert delivery loop.** Decoupled from the scheduler. State transitions enqueue a row into `alert_queue`; a 5-second tick drains it. Failed deliveries retry with exponential backoff (5s → 30s → 5m → 30m), then dead-letter with `last_error` preserved for forensics. A slow webhook can't stall monitoring — the scheduler keeps running while delivery retries.

**Storage.** SQLite in WAL mode so the dashboard reads concurrently with the scheduler's writes. Monitor configs are stored as a single AES-256-GCM encrypted blob — adding a new check type is just code, no migration. Schema migrations are idempotent (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` with duplicate-column try/catch).

**Public vs admin rendering.** Routes that need both behaviors (e.g. `/monitors/:id`) use `publicRoute()` and switch on `ctx.isAdmin` to render either the edit form or a read-only summary card. Sensitive fields (target URLs, error detail strings, webhook URLs) are never serialized in the public branch.

---

## Stack

- **Runtime:** [Bun](https://bun.sh) 1.3+ (uses built-in `bun:sqlite`, `fetch`, `Bun.password`, native sockets)
- **Server:** [`Bun.serve`](https://bun.sh/docs/api/http) — typed routes API, no Express
- **Database:** SQLite (WAL mode)
- **Templates:** [`@kitajs/html`](https://github.com/kitajs/html) — JSX that compiles to HTML strings, with `safe` attribute for escaping
- **Interactivity:** [HTMX 2](https://htmx.org) — search debounce, per-row refresh, form submits without a SPA
- **SSH client:** [`ssh2`](https://github.com/mscdex/ssh2)
- **Fonts:** Inter Tight + JetBrains Mono, self-hosted (run `bun run fetch-fonts` to regenerate)

No build step. No bundler. No transpiler beyond Bun's built-in TSX/JSX support.

---

## File layout

```
src/
├── index.ts              entry: env, db, scheduler, alerts, Bun.serve
├── config.ts             env loading + AES-GCM encrypt/decrypt
├── secrets.ts            DB-backed credentials + encryption key (env-seeded)
├── db.ts                 SQLite connection, schema, idempotent migrations
├── auth.ts               argon2 verify, sessions, rate limiting
├── scheduler.ts          tick loop, 4-rule state machine, incident open/close
├── alerts.ts             webhook delivery loop with backoff
├── queries.ts            aggregation queries (KPIs, uptime, sparklines, MTTR)
├── checks/               http / tcp / ssh check implementations
├── routes/               login · dashboard · monitor · webhooks · incidents · settings · preferences
└── views/                layout, components, tokens + component CSS
public/
├── htmx.min.js           pinned 2.0.6
├── spark.js              sparkline hover tooltip
├── uptime.js             bulk · filter · ⌘K palette · sound poll
└── fonts/                self-hosted Inter Tight + JetBrains Mono woff2
scripts/
├── hash.ts               bun run hash <password> — emits .env-ready line
├── keygen.ts             bun run keygen — emits SESSION_SECRET + ENCRYPTION_KEY
└── fetch-fonts.ts        bun run fetch-fonts — re-downloads Google Fonts woff2 files
```

---

## API

A REST JSON API lives at `/api/v1/*` for programmatic clients (scripts, IaC tools, MCP servers). All endpoints require a Bearer token. Mint tokens in **Settings → API tokens** — the raw token is shown exactly once on creation, after which only its SHA-256 hash is stored. Revoke tokens individually from the same UI.

### Quick start

```bash
# After minting a token in /settings → API tokens:
TOKEN='up_<your-token-here>'

curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/monitors
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/stats/fleet
```

### Endpoints

**Monitors**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/monitors` | List all monitors with current state |
| `POST` | `/api/v1/monitors` | Create a monitor (returns the new id) |
| `GET` | `/api/v1/monitors/:id` | Read a monitor (includes decrypted config + bound webhook ids) |
| `PATCH` | `/api/v1/monitors/:id` | Partial update — only supplied fields are changed |
| `DELETE` | `/api/v1/monitors/:id` | Delete monitor + history |
| `POST` | `/api/v1/monitors/:id/pause` | Stop checks (sets `enabled=false`) |
| `POST` | `/api/v1/monitors/:id/resume` | Re-enable checks |
| `POST` | `/api/v1/monitors/:id/mute` | Body `{"duration_ms": 3600000}` or `{"until": <epoch_ms>}` |
| `POST` | `/api/v1/monitors/:id/unmute` | Clear mute |
| `POST` | `/api/v1/monitors/:id/run-now` | Trigger an immediate check (fire-and-forget) |
| `GET` | `/api/v1/monitors/:id/stats` | Uptime windows, latency percentiles, MTTR, hourly buckets |
| `GET` | `/api/v1/monitors/:id/checks?limit=100` | Recent check_results |

**Incidents**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/incidents?tab=open\|resolved\|all` | List incidents (default `open`) |
| `GET` | `/api/v1/incidents/:id` | Read with computed `failed_checks`, `alerts_sent`, and the timeline |
| `POST` | `/api/v1/incidents/:id/ack` | Acknowledge — clears the banner without resolving |
| `PATCH` | `/api/v1/incidents/:id` | Body `{"notes": "..."}` — set/update postmortem markdown |

**Webhooks**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/webhooks` | List with per-webhook delivery stats |
| `POST` | `/api/v1/webhooks` | Create — body `{"name": "...", "url": "https://..."}` |
| `DELETE` | `/api/v1/webhooks/:id` | Delete |
| `POST` | `/api/v1/webhooks/:id/toggle` | Flip enabled state |

**Fleet stats + health**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/stats/fleet` | KPIs (total, up, down, p95, MTTR) + recent alert deliveries |
| `GET` | `/api/v1/healthz` | Returns `{"status": "ok"}` for liveness probes |

### OpenAPI spec

A full machine-readable spec is published at [`openapi.yml`](./openapi.yml) and served live by the running server at both `/openapi.yml` and `/api/v1/openapi.yml` (no auth — the schema itself isn't sensitive). Point Swagger UI, Postman, or an MCP-OpenAPI bridge at either URL.

### Conventions

- Collections return `{ resource_name: [...] }`; single resources return `{ resource_name: {...} }`
- Errors return `{ "error": "human-readable message" }` with appropriate 4xx/5xx status
- Action endpoints with no useful payload return `204 No Content`
- Timestamps are epoch milliseconds (matches the DB storage format)
- Field names are snake_case throughout, matching the SQLite schema

### Monitor body shape (POST/PATCH)

```json
{
  "name": "api.prod",
  "type": "http",
  "config": {
    "url": "https://api.prod.example.com/health",
    "method": "GET",
    "expectedStatus": 200,
    "headers": { "X-Custom": "value" }
  },
  "interval_seconds": 60,
  "timeout_ms": 10000,
  "failure_threshold": 2,
  "success_threshold": 1,
  "enabled": true,
  "is_public": true,
  "group_name": "production",
  "notes": "**Owner:** ops team",
  "webhook_ids": [1, 2]
}
```

For TCP: `"config": {"host": "db.internal", "port": 5432}`.
For SSH: `"config": {"host": "...", "username": "...", "privateKey": "...", "command": "...", "expectExitCode": 0}`.

PATCH accepts any subset of these fields. On `type` change, `config` must be re-supplied in the new shape.

---

## Development

```bash
bun run dev         # auto-reload on file changes
bun run start       # one-shot
bunx tsc --noEmit   # typecheck
```

There's no separate test suite at the moment — verification is end-to-end via HTTP smoke tests (see commit history).

---

## Status

This is a personal project I'm releasing as-is. It's functional and I run my own monitors on it, but:

- No tests yet
- No HA / multi-instance support (single process owns the SQLite file)
- No external metrics export (Prometheus, etc.)
- No public read-only embed widgets

If something looks interesting and you want to send a PR, go for it. If something's broken, open an issue.

---

## License

MIT
