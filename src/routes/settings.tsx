import Html from "@kitajs/html";
import { createHash } from "node:crypto";
import { config } from "../config";
import { db } from "../db";
import { readSession } from "../auth";
import {
  applyRetention, changeCredentials, getRetentionDays, rotateEncryptionKey, setRetentionDays,
} from "../secrets";
import { Layout } from "../views/layout";
import { formatAgo, formatDuration } from "../views/components";
import type { PageContext } from "../views/context";
import { adminRoute, htmlResponse } from "./wrap";

const processStart = Date.now();

function fingerprint(buf: Buffer): string {
  const h = createHash("sha256").update(buf).digest("hex");
  return `sha256:${h.slice(0, 4)}·${h.slice(4, 8)}·${h.slice(8, 12)}·…·${h.slice(-4)}`;
}

function count(sql: string): number {
  return (db.query(sql).get() as { c: number } | null)?.c ?? 0;
}

function flashFor(ok: string | null, err: string | null): JSX.Element {
  if (ok) return <div class="ok" safe>{ok}</div>;
  if (err) return <div class="error" safe>{err}</div>;
  return <></>;
}

function settingsHandler(req: Bun.BunRequest<"/settings">, ctx: PageContext): Promise<Response> {
  const url = new URL(req.url);
  const ok = url.searchParams.get("ok");
  const err = url.searchParams.get("err");
  const monitorsCount = count("SELECT COUNT(*) AS c FROM monitors");
  const resultsCount = count("SELECT COUNT(*) AS c FROM check_results");
  const incidentsCount = count("SELECT COUNT(*) AS c FROM incidents");
  const queueCount = count("SELECT COUNT(*) AS c FROM alert_queue");
  const sessions = db
    .query<{ id: string; created_at: number; expires_at: number }, [number]>(
      "SELECT id, created_at, expires_at FROM sessions WHERE expires_at > ? ORDER BY created_at DESC"
    )
    .all(Date.now());
  const currentSession = readSession(req.headers.get("cookie"));
  const uptimeMs = Date.now() - processStart;
  const bunVersion = (globalThis as { Bun?: { version: string } }).Bun?.version ?? "unknown";

  return htmlResponse(
    <Layout ctx={ctx} title="Settings" mainClass="page-main page-main-narrow">
      <div class="page-head">
        <div>
          <h1 class="page-h1">Settings</h1>
          <div class="page-meta">
            <span>Configuration is loaded from env on first boot and persisted in the DB after that.</span>
          </div>
        </div>
      </div>

      {flashFor(ok, err)}

      <div class="settings-grid">
        {/* Authentication */}
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="settings-section-h3">Authentication</h3>
            <span class="settings-section-status"><span style="color:var(--up)">●</span> active</span>
          </div>
          <div class="settings-section-desc">
            Single-user login. Password hashed with argon2id. Login attempts are rate-limited per IP.
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Username</div>
            <div class="settings-field-value" safe>{config.adminUsername}</div>
            <span />
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Password hash</div>
            <div class="settings-field-value">argon2id · stored in DB</div>
            <span />
          </div>
          <div class="settings-field" style="grid-template-columns:200px 1fr">
            <div class="settings-field-label">Change credentials</div>
            <form method="post" action="/settings/credentials" style="display:flex;flex-direction:column;gap:8px;margin:0">
              <input type="password" name="current_password" placeholder="Current password" required />
              <input name="new_username" placeholder="New username" value={config.adminUsername} required />
              <input type="password" name="new_password" placeholder="New password (≥ 8 chars)" required />
              <button type="submit" class="btn btn-primary btn-mini" style="align-self:flex-start">Update credentials</button>
            </form>
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Login rate limit</div>
            <div class="settings-field-value">5 attempts / 60s per IP · in-memory</div>
            <span />
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Session lifetime</div>
            <div class="settings-field-value">30 days · sliding window</div>
            <span />
          </div>
        </div>

        {/* Active sessions */}
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="settings-section-h3">Active sessions</h3>
            <span class="settings-section-status">{String(sessions.length)} active</span>
          </div>
          <div class="settings-section-desc">All sessions currently authenticated to this admin account. Revoking ends the session immediately.</div>
          {sessions.length === 0 ? (
            <div class="muted">No active sessions.</div>
          ) : sessions.map((s) => {
            const isCurrent = currentSession?.id === s.id;
            return (
              <div class="settings-field">
                <div class="settings-field-label" safe>{s.id.slice(0, 12)}…</div>
                <div class="settings-field-value">
                  started {formatAgo(s.created_at)} · expires {formatAgo(s.expires_at)}
                  {isCurrent ? <span style="color:var(--up);margin-left:8px">· this session</span> : ""}
                </div>
                {isCurrent ? (
                  <span style="font-size:11.5px;color:var(--muted);font-family:var(--mono)">current</span>
                ) : (
                  <form method="post" action={`/settings/sessions/${s.id}/revoke`} style="margin:0">
                    <button type="submit" class="btn btn-ghost btn-mini">Revoke</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        {/* Retention */}
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="settings-section-h3">Retention</h3>
            <span class="settings-section-status">scope · days · 0 = forever</span>
          </div>
          <div class="settings-section-desc">
            Periodic purge runs every 30 minutes. Reduces DB size; speeds up dashboard queries.
          </div>
          <form method="post" action="/settings/retention" style="margin:0">
            <div class="settings-field">
              <div class="settings-field-label">Check results</div>
              <div class="settings-field-value">
                {String(resultsCount)} rows ·
                <input type="number" name="check_results" min="0" value={String(getRetentionDays("check_results"))} style="display:inline-block;width:7em;margin-left:8px" /> days
              </div>
              <span />
            </div>
            <div class="settings-field">
              <div class="settings-field-label">Alert queue (delivered)</div>
              <div class="settings-field-value">
                {String(queueCount)} rows ·
                <input type="number" name="alert_queue" min="0" value={String(getRetentionDays("alert_queue"))} style="display:inline-block;width:7em;margin-left:8px" /> days
              </div>
              <span />
            </div>
            <div class="settings-field">
              <div class="settings-field-label">Incidents (resolved)</div>
              <div class="settings-field-value">
                {String(incidentsCount)} rows ·
                <input type="number" name="incidents" min="0" value={String(getRetentionDays("incidents"))} style="display:inline-block;width:7em;margin-left:8px" /> days
              </div>
              <span />
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button type="submit" class="btn btn-primary btn-mini">Save retention</button>
              <button type="submit" formaction="/settings/retention/purge-now" class="btn btn-ghost btn-mini">Purge now</button>
            </div>
          </form>
        </div>

        {/* Encryption */}
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="settings-section-h3">Encryption</h3>
            <span class="settings-section-status">monitor configs at rest</span>
          </div>
          <div class="settings-section-desc">
            Monitor configurations (URLs, passwords, SSH keys, headers) are AES-256-GCM encrypted in the DB. Rotation transactionally re-encrypts every monitor.
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Key fingerprint</div>
            <div class="settings-field-readonly" safe>{fingerprint(config.encryptionKey)}</div>
            <form method="post" action="/settings/encryption/rotate" style="margin:0" onsubmit="return confirm('Generate a new encryption key and re-encrypt every monitor configuration?')">
              <button type="submit" class="btn btn-ghost btn-mini" style="color:var(--warn)">Rotate</button>
            </form>
          </div>
          <div class="settings-field">
            <div class="settings-field-label">Algorithm</div>
            <div class="settings-field-value">AES-256-GCM · 12-byte IV · 16-byte tag</div>
            <span />
          </div>
        </div>

        {/* Environment */}
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="settings-section-h3">Environment</h3>
            <span class="settings-section-status">read-only · from .env</span>
          </div>
          <div class="settings-section-desc">
            Process-level configuration. Set via environment variables and restart the server to apply.
          </div>
          <div class="settings-field"><div class="settings-field-label">Bun version</div><div class="settings-field-value" safe>{bunVersion}</div><span /></div>
          <div class="settings-field"><div class="settings-field-label">Port</div><div class="settings-field-value">{String(config.port)}</div><span /></div>
          <div class="settings-field"><div class="settings-field-label">DB path</div><div class="settings-field-value" safe>{config.dbPath}</div><span /></div>
          <div class="settings-field"><div class="settings-field-label">Mode</div><div class="settings-field-value">{config.isProd ? "production" : "development"}</div><span /></div>
          <div class="settings-field"><div class="settings-field-label">Auto-ack incidents</div><div class="settings-field-value">{config.autoAckMinutes > 0 ? `after ${config.autoAckMinutes}m` : "off"}</div><span /></div>
          <div class="settings-field"><div class="settings-field-label">Monitors</div><div class="settings-field-value">{String(monitorsCount)} configured</div><span /></div>
          <div class="settings-field"><div class="settings-field-label">Server uptime</div><div class="settings-field-value">{formatDuration(uptimeMs)}</div><span /></div>
        </div>
      </div>
    </Layout>,
  );
}

// === Action handlers ===

function flashRedirect(ok?: string, err?: string): Response {
  const params = new URLSearchParams();
  if (ok) params.set("ok", ok);
  if (err) params.set("err", err);
  return new Response(null, { status: 303, headers: { Location: `/settings?${params.toString()}` } });
}

async function credentialsHandler(req: Bun.BunRequest<"/settings/credentials">): Promise<Response> {
  const form = await req.formData();
  const current = String(form.get("current_password") ?? "");
  const newUsername = String(form.get("new_username") ?? "").trim();
  const newPassword = String(form.get("new_password") ?? "");
  const result = await changeCredentials(current, newUsername, newPassword);
  if (!result.ok) return flashRedirect(undefined, result.error);
  return flashRedirect("Credentials updated. Future logins use the new username/password.");
}

function rotateKeyHandler(_req: Bun.BunRequest<"/settings/encryption/rotate">): Response {
  const result = rotateEncryptionKey();
  if (!result.ok) return flashRedirect(undefined, `Key rotation failed: ${result.error}`);
  return flashRedirect(`Encryption key rotated. ${result.rotated} monitor config(s) re-encrypted.`);
}

async function retentionHandler(req: Bun.BunRequest<"/settings/retention">): Promise<Response> {
  const form = await req.formData();
  for (const k of ["check_results", "alert_queue", "incidents"] as const) {
    const raw = form.get(k);
    if (raw === null || raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return flashRedirect(undefined, `Invalid retention for ${k}`);
    setRetentionDays(k, n);
  }
  return flashRedirect("Retention settings saved. Next purge runs within 30 minutes.");
}

function purgeNowHandler(_req: Bun.BunRequest<"/settings/retention/purge-now">): Response {
  const r = applyRetention();
  const msg = `Purged: ${r.check_results} check_results, ${r.alert_queue} alert_queue, ${r.incidents} incidents.`;
  return flashRedirect(msg);
}

function revokeSessionHandler(req: Bun.BunRequest<"/settings/sessions/:id/revoke">): Response {
  const id = String(req.params.id);
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
  return flashRedirect("Session revoked.");
}

export const settingsRoutes = {
  page: { GET: adminRoute(settingsHandler) },
  credentials: { POST: adminRoute(credentialsHandler) },
  rotate: { POST: adminRoute(rotateKeyHandler) },
  retention: { POST: adminRoute(retentionHandler) },
  purgeNow: { POST: adminRoute(purgeNowHandler) },
  revokeSession: { POST: adminRoute(revokeSessionHandler) },
};
