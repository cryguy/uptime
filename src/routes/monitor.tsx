import Html from "@kitajs/html";
import { decryptJSON, encryptJSON } from "../config";
import { db } from "../db";
import { Layout } from "../views/layout";
import {
  IncidentBanner, Spark, StatusDot, StatusPill, TypeChip,
  formatAgo, formatAgoCompact, formatDuration,
} from "../views/components";
import type { PageContext } from "../views/context";
import {
  getActiveIncidents, getBannerIncident, getMonitorLatencySpark, getMonitorMTTR,
  getMonitorPercentile, getMonitorUptimeWindow,
} from "../queries";
import type { HttpConfig, MonitorType, SshConfig, TcpConfig } from "../checks/types";
import { runCheckNow } from "../scheduler";
import { renderMarkdown } from "../markdown";
import { adminRoute, htmlResponse, publicRoute } from "./wrap";

type AnyConfig = HttpConfig | TcpConfig | SshConfig;

type MonitorRecord = {
  id: number;
  name: string;
  type: MonitorType;
  config: AnyConfig;
  interval_seconds: number;
  timeout_ms: number;
  failure_threshold: number;
  success_threshold: number;
  enabled: boolean;
  group_name: string | null;
  is_public: boolean;
  muted_until: number | null;
  notes: string | null;
};

const getMonitor = db.query<
  {
    id: number; name: string; type: MonitorType; config_encrypted: Uint8Array;
    interval_seconds: number; timeout_ms: number;
    failure_threshold: number; success_threshold: number; enabled: number;
    group_name: string | null; is_public: number; muted_until: number | null;
    notes: string | null;
    current_status: "up" | "down" | null; since: number | null; last_checked_at: number | null;
    consecutive_failures: number; consecutive_successes: number;
  },
  [number]
>(`
  SELECT m.id, m.name, m.type, m.config_encrypted, m.interval_seconds, m.timeout_ms,
         m.failure_threshold, m.success_threshold, m.enabled,
         m.group_name, m.is_public, m.muted_until, m.notes,
         s.current_status, s.since, s.last_checked_at,
         s.consecutive_failures, s.consecutive_successes
  FROM monitors m
  LEFT JOIN monitor_state s ON s.monitor_id = m.id
  WHERE m.id = ?
`);

const recentResultsQuery = db.query<
  { checked_at: number; status: string; latency_ms: number | null; detail: string | null },
  [number]
>(`
  SELECT checked_at, status, latency_ms, detail
  FROM check_results
  WHERE monitor_id = ?
  ORDER BY checked_at DESC
  LIMIT 25
`);

const insertMonitor = db.query(`
  INSERT INTO monitors (name, type, config_encrypted, interval_seconds, timeout_ms,
                        failure_threshold, success_threshold, enabled,
                        group_name, is_public, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id
`);
const updateMonitor = db.query(`
  UPDATE monitors
  SET name = ?, type = ?, config_encrypted = ?, interval_seconds = ?, timeout_ms = ?,
      failure_threshold = ?, success_threshold = ?, enabled = ?,
      group_name = ?, is_public = ?, notes = ?, updated_at = ?
  WHERE id = ?
`);
const deleteMonitorQuery = db.query("DELETE FROM monitors WHERE id = ?");
const togglePauseQuery = db.query(
  "UPDATE monitors SET enabled = 1 - enabled, updated_at = ?2 WHERE id = ?1"
);
const muteQuery = db.query(
  "UPDATE monitors SET muted_until = ?2, updated_at = ?3 WHERE id = ?1"
);

const listWebhooks = db.query<{ id: number; name: string }, []>(
  "SELECT id, name FROM webhooks WHERE enabled = 1 ORDER BY name"
);
const monitorWebhookIds = db.query<{ webhook_id: number }, [number]>(
  "SELECT webhook_id FROM monitor_webhooks WHERE monitor_id = ?"
);
const clearMonitorWebhooks = db.query("DELETE FROM monitor_webhooks WHERE monitor_id = ?");
const addMonitorWebhook = db.query(
  "INSERT INTO monitor_webhooks (monitor_id, webhook_id) VALUES (?, ?)"
);

// === Public-safe rendering of check detail strings ===

function publicDetail(raw: string | null, status: string): string {
  if (!raw) return status === "up" ? "ok" : "failed";
  if (raw.startsWith("status ")) {
    const code = raw.split(" ")[1] ?? "";
    return code.replace(/[^0-9]/g, "") || (status === "up" ? "ok" : "failed");
  }
  if (raw.startsWith("timeout")) return "timeout";
  if (raw.toLowerCase().includes("refused")) return "connection refused";
  if (raw.toLowerCase().includes("unreachable")) return "unreachable";
  if (raw.toLowerCase().includes("authenticated")) return "ok";
  if (raw.toLowerCase().includes("connected")) return "ok";
  if (raw.toLowerCase().includes("exit 0")) return "ok";
  return status === "up" ? "ok" : "failed";
}

// === Detail page ===

function detailGet(
  req: Bun.BunRequest<"/monitors/:id">,
  ctx: PageContext,
): Response | Promise<Response> {
  const id = Number(req.params.id);
  const row = getMonitor.get(id);
  if (!row) return new Response("not found", { status: 404 });

  let config: AnyConfig;
  try {
    config = decryptJSON<AnyConfig>(row.config_encrypted);
  } catch {
    return new Response("monitor config could not be decrypted (check ENCRYPTION_KEY)", {
      status: 500,
    });
  }

  const monitor: MonitorRecord = {
    id: row.id, name: row.name, type: row.type, config,
    interval_seconds: row.interval_seconds, timeout_ms: row.timeout_ms,
    failure_threshold: row.failure_threshold, success_threshold: row.success_threshold,
    enabled: row.enabled === 1,
    group_name: row.group_name,
    is_public: row.is_public === 1,
    muted_until: row.muted_until,
    notes: row.notes,
  };

  const boundIds = new Set(monitorWebhookIds.all(id).map((w) => w.webhook_id));
  const webhooks = ctx.isAdmin ? listWebhooks.all() : [];
  const results = recentResultsQuery.all(id);
  const now = Date.now();

  const uptime24h = getMonitorUptimeWindow(id, now - 24 * 60 * 60 * 1000);
  const uptime7d = getMonitorUptimeWindow(id, now - 7 * 24 * 60 * 60 * 1000);
  const p95_1h = getMonitorPercentile(id, now - 60 * 60 * 1000, 95);
  const mttr30d = getMonitorMTTR(id, now - 30 * 24 * 60 * 60 * 1000);
  const latencySpark = getMonitorLatencySpark(id, now - 60 * 60 * 1000, 60);

  const isDown = row.current_status === "down";
  const banner = getBannerIncident();

  const statusMeta = isDown && row.since !== null
    ? <>
        <span style="color:var(--down);font-weight:500">Down for {formatAgoCompact(row.since)}</span>
        <span style="color:var(--dim)">·</span>
        <span>last checked {formatAgo(row.last_checked_at)}</span>
      </>
    : row.current_status === "up" && row.since !== null
      ? <>
          <span>Stable for {formatAgoCompact(row.since)}</span>
          <span style="color:var(--dim)">·</span>
          <span safe>{`${row.type} check every ${row.interval_seconds}s · last ${formatAgo(row.last_checked_at)}`}</span>
        </>
      : <>
          <span class="muted">No checks recorded yet</span>
        </>;

  return htmlResponse(
    <Layout
      ctx={ctx}
      title={row.name}
      banner={banner ? <IncidentBanner incident={{
        incidentId: banner.id,
        monitorId: banner.monitor_id,
        monitorName: banner.monitor_name,
        sinceMs: banner.started_at,
        detail: ctx.isAdmin ? (banner.initial_detail ?? "") : "",
      }} isAdmin={ctx.isAdmin} /> : ""}
    >
      <div class="page-breadcrumbs">
        <a href="/dashboard">Monitors</a>
        <span class="sep">/</span>
        <span safe>{row.name}</span>
      </div>
      <div class="page-head">
        <div>
          <h1 class="page-h1">
            <span safe>{row.name}</span>
            <StatusPill status={row.current_status} enabled={row.enabled === 1} />
          </h1>
          <div class="page-meta">{statusMeta}</div>
        </div>
        {ctx.isAdmin ? (
          <div class="page-actions">
            <form method="post" action={`/monitors/${id}/pause`} style="margin:0">
              <button type="submit" class="btn btn-ghost">{row.enabled === 1 ? "Pause" : "Resume"}</button>
            </form>
            <form method="post" action={`/monitors/${id}/run-now`} style="margin:0">
              <button type="submit" class="btn btn-ghost">Run check now</button>
            </form>
            <MuteDropdown id={id} mutedUntil={row.muted_until} />
          </div>
        ) : ""}
      </div>

      <div class="detail-grid">
        {/* LEFT: form (admin) or summary (public) */}
        <div>
          {ctx.isAdmin ? (
            <>
              <div class="panel" style="padding:18px 20px">
                <MonitorForm action={`/monitors/${id}`} monitor={monitor} webhooks={webhooks} boundWebhookIds={boundIds} />
              </div>
              <div class="danger-zone">
                <h3>Danger zone</h3>
                <p>Deleting a monitor removes its history and unsubscribes its webhooks. This cannot be undone.</p>
                <form method="post" action={`/monitors/${id}/delete`} onsubmit="return confirm('Delete this monitor and all its history?')">
                  <button type="submit" class="btn btn-danger">Delete this monitor</button>
                </form>
              </div>
            </>
          ) : (
            <div class="panel detail-summary">
              <div class="detail-summary-row">
                <span class="detail-summary-label">Type</span>
                <span class="detail-summary-value" safe>{row.type.toUpperCase()}</span>
              </div>
              <div class="detail-summary-row">
                <span class="detail-summary-label">Interval</span>
                <span class="detail-summary-value">{row.interval_seconds}s</span>
              </div>
              <div class="detail-summary-row">
                <span class="detail-summary-label">Timeout</span>
                <span class="detail-summary-value">{row.timeout_ms}ms</span>
              </div>
              <div class="detail-summary-row">
                <span class="detail-summary-label">Failure threshold</span>
                <span class="detail-summary-value">{row.failure_threshold} consecutive</span>
              </div>
              <div class="detail-summary-row">
                <span class="detail-summary-label">Success threshold</span>
                <span class="detail-summary-value">{row.success_threshold} consecutive</span>
              </div>
              <div class="detail-summary-row">
                <span class="detail-summary-label">State</span>
                <span class="detail-summary-value">{row.enabled === 1 ? "enabled" : "paused"}</span>
              </div>
              <div class="detail-summary-row">
                <span class="detail-summary-label">Webhooks</span>
                <span class="detail-summary-value">{boundIds.size} configured</span>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: stats + latency + recent checks */}
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="detail-stats">
            <div class="detail-stat">
              <div class="detail-stat-label">Uptime · 24h</div>
              <div class="detail-stat-value">
                {uptime24h.percent !== null ? uptime24h.percent.toFixed(2) : "—"}
                <span class="detail-stat-value-unit">%</span>
              </div>
              <div class="detail-stat-meta">{uptime24h.up} / {uptime24h.total} ok</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Uptime · 7d</div>
              <div class="detail-stat-value">
                {uptime7d.percent !== null ? uptime7d.percent.toFixed(2) : "—"}
                <span class="detail-stat-value-unit">%</span>
              </div>
              <div class="detail-stat-meta">{uptime7d.up} / {uptime7d.total} ok{uptime7d.down > 0 ? ` · ${uptime7d.down} fail` : ""}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">p95 latency</div>
              <div class="detail-stat-value">
                {p95_1h !== null ? String(p95_1h) : "—"}
                {p95_1h !== null ? <span class="detail-stat-value-unit">ms</span> : ""}
              </div>
              <div class="detail-stat-meta">last 1h</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">MTTR · 30d</div>
              <div class="detail-stat-value">
                {mttr30d !== null ? formatDuration(mttr30d) : "—"}
              </div>
              <div class="detail-stat-meta">{mttr30d !== null ? "rolling avg" : "no incidents"}</div>
            </div>
          </div>

          {ctx.isAdmin && row.notes ? (
            <div class="panel">
              <div class="panel-head">
                <h3 class="panel-h3">Notes</h3>
                <span class="panel-meta">markdown · admin only</span>
              </div>
              <div style="padding:14px 18px">
                <div class="md-content">{renderMarkdown(row.notes) as "safe"}</div>
              </div>
            </div>
          ) : ""}

          <div class="panel">
            <div class="panel-head">
              <h3 class="panel-h3">Latency · last 1h</h3>
              <span class="panel-meta">hover for value</span>
            </div>
            <div style="padding:18px 16px">
              {latencySpark.length > 0
                ? <Spark data={latencySpark} w={420} h={70} color="var(--accent)" fill strokeWidth={1.5} interactive unit="ms" />
                : <div class="muted">No latency samples in this window.</div>}
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3 class="panel-h3">Recent checks</h3>
              <span class="panel-meta">last 25</span>
            </div>
            <div class="checks-table">
              <div class="checks-row head">
                <div>When</div><div>Status</div><div>Latency</div><div>Detail</div>
              </div>
              {results.length === 0 ? (
                <div class="incident-card muted" style="text-align:center;padding:18px">No checks recorded yet.</div>
              ) : results.map((r) => (
                <div class={`checks-row${r.status === "down" ? " failed" : ""}`}>
                  <div class="when">{formatAgoCompact(r.checked_at)}</div>
                  <div><StatusPill status={r.status as "up" | "down"} /></div>
                  <div class="latency">{r.latency_ms !== null ? `${r.latency_ms}ms` : "—"}</div>
                  <div class="detail-text" title={ctx.isAdmin ? (r.detail ?? "") : ""} safe>
                    {ctx.isAdmin ? (r.detail ?? "") : publicDetail(r.detail, r.status)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>,
  );
}

// === New monitor page ===

function newFormHandler(req: Bun.BunRequest<"/monitors/new">, ctx: PageContext): Response | Promise<Response> {
  const webhooks = listWebhooks.all();
  return htmlResponse(
    <Layout ctx={ctx} title="New monitor" mainClass="page-main page-main-narrow">
      <div class="page-breadcrumbs">
        <a href="/dashboard">Monitors</a>
        <span class="sep">/</span>
        New
      </div>
      <div class="page-head">
        <div>
          <h1 class="page-h1">New monitor</h1>
          <div class="page-meta"><span>Create a new check. You can edit any field after saving.</span></div>
        </div>
      </div>

      <div class="new-grid">
        <div class="panel" style="padding:18px 20px">
          <MonitorForm action="/monitors" webhooks={webhooks} boundWebhookIds={new Set()} />
        </div>
        <div class="new-preview">
          <div class="panel">
            <div class="panel-head">
              <h3 class="panel-h3">What this will do</h3>
              <span class="panel-meta">on save</span>
            </div>
            <div class="new-preview-body">
              <div class="new-preview-head">
                <StatusDot status="unknown" />
                <span class="new-preview-name muted">your-monitor-name</span>
                <TypeChip type="HTTP" />
              </div>
              <div class="muted" style="font-size:12.5px;margin-bottom:12px;line-height:1.5">
                The scheduler will run your check at the chosen interval and record every result. You'll see live status here within seconds.
              </div>
              <div class="new-preview-rules">
                <div>• Marks <b style="color:var(--down);font-weight:500">down</b> after the configured failure threshold of consecutive failed checks.</div>
                <div>• Marks <b style="color:var(--up);font-weight:500">up</b> again after the configured success threshold of consecutive ok checks.</div>
                <div>• Fires selected webhooks on state transitions.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>,
  );
}

// === Create / update / delete ===

async function createOrUpdate(req: Request, existingId: number | null, ctx: PageContext): Promise<Response> {
  const form = await req.formData();
  const parsed = parseMonitorForm(form);
  if ("error" in parsed) {
    const webhooks = listWebhooks.all();
    return htmlResponse(
      <Layout ctx={ctx} title={existingId ? "Edit monitor" : "New monitor"} mainClass={existingId ? "page-main" : "page-main page-main-narrow"}>
        <div class="page-breadcrumbs">
          <a href="/dashboard">Monitors</a>
          <span class="sep">/</span>
          {existingId ? "Edit" : "New"}
        </div>
        <div class="page-head">
          <div>
            <h1 class="page-h1">{existingId ? "Edit monitor" : "New monitor"}</h1>
          </div>
        </div>
        <div class="panel" style="padding:18px 20px">
          <MonitorForm
            action={existingId ? `/monitors/${existingId}` : "/monitors"}
            monitor={parsed.partial}
            webhooks={webhooks}
            boundWebhookIds={new Set(parsed.webhookIds)}
            error={parsed.error}
          />
        </div>
      </Layout>,
      { status: 400 },
    );
  }
  const { record, webhookIds } = parsed;
  const blob = encryptJSON(record.config);
  const now = Date.now();
  let id: number;
  if (existingId) {
    updateMonitor.run(
      record.name, record.type, blob, record.interval_seconds, record.timeout_ms,
      record.failure_threshold, record.success_threshold, record.enabled ? 1 : 0,
      record.group_name, record.is_public ? 1 : 0, record.notes, now, existingId,
    );
    id = existingId;
  } else {
    const inserted = insertMonitor.get(
      record.name, record.type, blob, record.interval_seconds, record.timeout_ms,
      record.failure_threshold, record.success_threshold, record.enabled ? 1 : 0,
      record.group_name, record.is_public ? 1 : 0, record.notes, now, now,
    ) as { id: number };
    id = inserted.id;
  }
  clearMonitorWebhooks.run(id);
  for (const wid of webhookIds) addMonitorWebhook.run(id, wid);

  return new Response(null, { status: 303, headers: { Location: `/monitors/${id}` } });
}

function createHandler(req: Bun.BunRequest<"/monitors">, ctx: PageContext): Promise<Response> {
  return createOrUpdate(req, null, ctx);
}
function detailPost(req: Bun.BunRequest<"/monitors/:id">, ctx: PageContext): Promise<Response> {
  return createOrUpdate(req, Number(req.params.id), ctx);
}
function deleteHandler(req: Bun.BunRequest<"/monitors/:id/delete">): Response {
  deleteMonitorQuery.run(Number(req.params.id));
  return new Response(null, { status: 303, headers: { Location: "/dashboard" } });
}
function pauseHandler(req: Bun.BunRequest<"/monitors/:id/pause">): Response {
  const id = Number(req.params.id);
  togglePauseQuery.run(id, Date.now());
  return new Response(null, { status: 303, headers: { Location: `/monitors/${id}` } });
}
// Fire-and-forget: kick the check, redirect immediately. User sees the
// fresh state via the 5s row auto-refresh rather than blocking the request.
function runNowHandler(req: Bun.BunRequest<"/monitors/:id/run-now">): Response {
  const id = Number(req.params.id);
  void runCheckNow(id);
  return new Response(null, { status: 303, headers: { Location: `/monitors/${id}` } });
}

const MUTE_DURATIONS_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  indef: Number.MAX_SAFE_INTEGER,
};

async function muteHandler(req: Bun.BunRequest<"/monitors/:id/mute">): Promise<Response> {
  const id = Number(req.params.id);
  const form = await req.formData();
  const dur = String(form.get("duration") ?? "");
  const explicitMs = Number(form.get("duration_ms") ?? 0);
  const durationMs = explicitMs > 0 ? explicitMs : (MUTE_DURATIONS_MS[dur] ?? MUTE_DURATIONS_MS["1h"]);
  const until = durationMs === Number.MAX_SAFE_INTEGER
    ? Number.MAX_SAFE_INTEGER
    : Date.now() + durationMs!;
  muteQuery.run(id, until, Date.now());
  const nextHeader = String(form.get("next") ?? "");
  const dest = nextHeader && nextHeader.startsWith("/") ? nextHeader : `/monitors/${id}`;
  return new Response(null, { status: 303, headers: { Location: dest } });
}

function unmuteHandler(req: Bun.BunRequest<"/monitors/:id/unmute">): Response {
  const id = Number(req.params.id);
  muteQuery.run(id, null, Date.now());
  return new Response(null, { status: 303, headers: { Location: `/monitors/${id}` } });
}

// === Bulk operations ===

function parseIds(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

async function bulkPauseHandler(req: Bun.BunRequest<"/monitors/bulk/pause">): Promise<Response> {
  const form = await req.formData();
  const ids = parseIds(String(form.get("ids") ?? ""));
  const now = Date.now();
  const q = db.query("UPDATE monitors SET enabled = 0, updated_at = ? WHERE id = ?");
  for (const id of ids) q.run(now, id);
  return new Response(null, { status: 303, headers: { Location: "/dashboard" } });
}

async function bulkResumeHandler(req: Bun.BunRequest<"/monitors/bulk/resume">): Promise<Response> {
  const form = await req.formData();
  const ids = parseIds(String(form.get("ids") ?? ""));
  const now = Date.now();
  const q = db.query("UPDATE monitors SET enabled = 1, updated_at = ? WHERE id = ?");
  for (const id of ids) q.run(now, id);
  return new Response(null, { status: 303, headers: { Location: "/dashboard" } });
}

async function bulkMuteHandler(req: Bun.BunRequest<"/monitors/bulk/mute">): Promise<Response> {
  const form = await req.formData();
  const ids = parseIds(String(form.get("ids") ?? ""));
  const durMs = Number(form.get("duration_ms") ?? 0) || MUTE_DURATIONS_MS["1h"]!;
  const until = Date.now() + durMs;
  const now = Date.now();
  for (const id of ids) muteQuery.run(id, until, now);
  return new Response(null, { status: 303, headers: { Location: "/dashboard" } });
}

async function bulkDeleteHandler(req: Bun.BunRequest<"/monitors/bulk/delete">): Promise<Response> {
  const form = await req.formData();
  const ids = parseIds(String(form.get("ids") ?? ""));
  for (const id of ids) deleteMonitorQuery.run(id);
  return new Response(null, { status: 303, headers: { Location: "/dashboard" } });
}

// === Mute UI ===
// CSS-only dropdown via :focus-within (no JS). The trigger is a label that
// drives a hidden checkbox; the menu is shown when the checkbox is checked.
// On mute submit, the form GETs through normally so the redirect closes it.
function MuteDropdown({ id, mutedUntil }: { id: number; mutedUntil: number | null }): JSX.Element {
  const isMuted = mutedUntil !== null && mutedUntil > Date.now();
  if (isMuted) {
    const remaining = mutedUntil! - Date.now();
    const label = mutedUntil === Number.MAX_SAFE_INTEGER
      ? "Muted · ∞"
      : `Muted · ${formatDuration(remaining)} left`;
    return (
      <form method="post" action={`/monitors/${id}/unmute`} style="margin:0">
        <button type="submit" class="btn btn-ghost" style="color:var(--warn);border-color:var(--warn)" safe>{`${label} · unmute`}</button>
      </form>
    );
  }
  return (
    <div class="mute-dropdown" id={`mute-dd-${id}`}>
      <button type="button" class="mute-dropdown-trigger" onclick={`this.parentElement.dataset.open = this.parentElement.dataset.open === '1' ? '' : '1'`}>
        Mute ⌄
      </button>
      <div class="mute-dropdown-menu">
        {(["5m", "30m", "1h", "24h", "indef"] as const).map((dur) => (
          <form method="post" action={`/monitors/${id}/mute`}>
            <input type="hidden" name="duration" value={dur} />
            <button type="submit">{`Mute · ${dur === "indef" ? "indefinitely" : dur}`}</button>
          </form>
        ))}
      </div>
    </div>
  );
}

// === Form rendering ===

function MonitorForm({
  action,
  monitor,
  webhooks,
  boundWebhookIds,
  error,
}: {
  action: string;
  monitor?: Partial<MonitorRecord>;
  webhooks?: Array<{ id: number; name: string }>;
  boundWebhookIds?: Set<number>;
  error?: string;
}): JSX.Element {
  const wh = webhooks ?? [];
  const bound = boundWebhookIds ?? new Set<number>();
  const type: MonitorType = monitor?.type ?? "http";

  return (
    <form method="post" action={action}>
      {error ? <div class="login-error" safe>{error}</div> : ""}

      <div class="form-section">
        <div class="form-section-title">Basics</div>
        <div class="form-section-desc">Name and check cadence. Changes take effect on the next scheduled check.</div>
        <label>Name</label>
        <input name="name" value={monitor?.name ?? ""} required placeholder="api.prod or db.replica-1" />

        <label>Check type</label>
        <select name="type" id="monitor-type-select">
          <option value="http" selected={type === "http"}>HTTP / HTTPS</option>
          <option value="tcp" selected={type === "tcp"}>TCP port</option>
          <option value="ssh" selected={type === "ssh"}>SSH (key-based)</option>
        </select>

        <div class="form-row" style="margin-top:14px">
          <div>
            <label>Interval (s)</label>
            <input type="number" name="interval_seconds" value={String(monitor?.interval_seconds ?? 60)} min="5" required />
          </div>
          <div>
            <label>Timeout (ms)</label>
            <input type="number" name="timeout_ms" value={String(monitor?.timeout_ms ?? 10000)} min="500" required />
          </div>
          <div>
            <label>Failure threshold</label>
            <input type="number" name="failure_threshold" value={String(monitor?.failure_threshold ?? 2)} min="1" required />
          </div>
          <div>
            <label>Success threshold</label>
            <input type="number" name="success_threshold" value={String(monitor?.success_threshold ?? 1)} min="1" required />
          </div>
        </div>

        <div class="form-row" style="margin-top:14px">
          <div style="grid-column:span 2">
            <label>Group (optional)</label>
            <input name="group_name" value={monitor?.group_name ?? ""} placeholder="production, staging, internal…" />
          </div>
          <div>
            <label>Visibility</label>
            <select name="is_public">
              <option value="1" selected={monitor?.is_public !== false}>Public (visible to all viewers)</option>
              <option value="0" selected={monitor?.is_public === false}>Private (admin only)</option>
            </select>
          </div>
        </div>

        <label class="inline" style="margin-top:14px">
          <input type="checkbox" name="enabled" checked={monitor?.enabled !== false} />
          Enabled
        </label>
      </div>

      <div id="type-fields-http" class="type-fields" style={type === "http" ? "" : "display:none"}>
        <HttpFields cfg={type === "http" ? (monitor?.config as HttpConfig | undefined) : undefined} />
      </div>
      <div id="type-fields-tcp" class="type-fields" style={type === "tcp" ? "" : "display:none"}>
        <TcpFields cfg={type === "tcp" ? (monitor?.config as TcpConfig | undefined) : undefined} />
      </div>
      <div id="type-fields-ssh" class="type-fields" style={type === "ssh" ? "" : "display:none"}>
        <SshFields cfg={type === "ssh" ? (monitor?.config as SshConfig | undefined) : undefined} />
      </div>

      <div class="form-section">
        <div class="form-section-title">Notes (Markdown)</div>
        <div class="form-section-desc">Long-lived context for this monitor — owner, dependencies, runbook links. Visible to admins only. Markdown renders on the detail panel.</div>
        <textarea name="notes" placeholder="e.g. **Owner:** @ops · depends on db-primary · runbook at /docs/api-prod" safe>{monitor?.notes ?? ""}</textarea>
      </div>

      <div class="form-section">
        <div class="form-section-title">Webhooks · fire on state transition</div>
        <div class="form-section-desc">Selected webhooks are alerted on every up→down and down→up flip after thresholds are met.</div>
        {wh.length === 0 ? (
          <div class="muted">No webhooks configured. <a href="/webhooks">Add one</a>.</div>
        ) : (
          <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:8px">
            {wh.map((w) => (
              <label class="inline">
                <input type="checkbox" name="webhook_ids" value={String(w.id)} checked={bound.has(w.id)} />
                <span safe>{w.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div style="display:flex;gap:8px;margin-top:24px">
        <button type="submit" class="btn btn-primary">Save</button>
        <a href="/dashboard"><button type="button" class="btn btn-ghost">Cancel</button></a>
      </div>

      <script>{`
        (function() {
          function show(group, value) {
            document.querySelectorAll('.' + group).forEach(function(el) { el.style.display = 'none'; });
            var t = document.getElementById(group + '-' + value);
            if (t) t.style.display = 'block';
          }
          var typeSel = document.getElementById('monitor-type-select');
          if (typeSel) typeSel.addEventListener('change', function() { show('type-fields', this.value); });
          var authSel = document.getElementById('http-auth-select');
          if (authSel) authSel.addEventListener('change', function() { show('http-auth-fields', this.value); });
        })();
      `}</script>
    </form>
  );
}

function HttpFields({ cfg }: { cfg?: HttpConfig }): JSX.Element {
  const authType = cfg?.auth?.type ?? "none";
  const expectedDisplay = cfg?.expectedStatus === undefined
    ? ""
    : Array.isArray(cfg.expectedStatus)
      ? cfg.expectedStatus.join(",")
      : String(cfg.expectedStatus);
  return (
    <div class="form-section">
      <div class="form-section-title">HTTP check</div>
      <div class="form-section-desc">Endpoint and assertions. Body content match is optional.</div>

      <label>URL</label>
      <input name="http_url" type="url" placeholder="https://example.com/health" value={cfg?.url ?? ""} />

      <div class="form-row">
        <div>
          <label>Method</label>
          <select name="http_method">
            {(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const).map((m) => (
              <option value={m} selected={(cfg?.method ?? "GET") === m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Expected status</label>
          <input name="http_expected_status" placeholder="200 (default 2xx)" value={expectedDisplay} />
        </div>
      </div>

      <label>Headers (JSON object, optional)</label>
      <textarea name="http_headers" placeholder='{"X-Custom":"value"}' safe>
        {cfg?.headers ? JSON.stringify(cfg.headers, null, 2) : ""}
      </textarea>

      <label>Request body (optional)</label>
      <textarea name="http_body" safe>{cfg?.body ?? ""}</textarea>

      <label>Auth</label>
      <select name="http_auth_type" id="http-auth-select">
        <option value="none" selected={authType === "none"}>None</option>
        <option value="basic" selected={authType === "basic"}>HTTP Basic</option>
        <option value="bearer" selected={authType === "bearer"}>Bearer token</option>
      </select>

      <div id="http-auth-fields-none" class="http-auth-fields" style={authType === "none" ? "" : "display:none"}></div>
      <div id="http-auth-fields-basic" class="http-auth-fields" style={authType === "basic" ? "" : "display:none"}>
        <label>Username</label>
        <input name="http_auth_username" value={cfg?.auth?.type === "basic" ? cfg.auth.username : ""} />
        <label>Password</label>
        <input name="http_auth_password" type="password" value={cfg?.auth?.type === "basic" ? cfg.auth.password : ""} />
      </div>
      <div id="http-auth-fields-bearer" class="http-auth-fields" style={authType === "bearer" ? "" : "display:none"}>
        <label>Token</label>
        <input name="http_auth_token" type="password" value={cfg?.auth?.type === "bearer" ? cfg.auth.token : ""} />
      </div>

      <label>Expected body contains (optional)</label>
      <input name="http_expected_body" value={cfg?.expectedBodyContains ?? ""} />

      <div style="display:flex;gap:18px;margin-top:10px">
        <label class="inline">
          <input type="checkbox" name="http_follow_redirects" checked={cfg?.followRedirects !== false} />
          Follow redirects
        </label>
        <label class="inline">
          <input type="checkbox" name="http_ignore_tls" checked={cfg?.ignoreTlsErrors === true} />
          Ignore TLS errors
        </label>
      </div>
    </div>
  );
}

function TcpFields({ cfg }: { cfg?: TcpConfig }): JSX.Element {
  return (
    <div class="form-section">
      <div class="form-section-title">TCP check</div>
      <div class="form-section-desc">Reachability check — opens a TCP connection and closes it.</div>
      <div class="form-row">
        <div style="grid-column:span 2">
          <label>Host</label>
          <input name="tcp_host" value={cfg?.host ?? ""} placeholder="db.internal" />
        </div>
        <div>
          <label>Port</label>
          <input name="tcp_port" type="number" min="1" max="65535"
                 value={cfg?.port !== undefined ? String(cfg.port) : ""}
                 placeholder="5432" />
        </div>
      </div>
    </div>
  );
}

function SshFields({ cfg }: { cfg?: SshConfig }): JSX.Element {
  return (
    <div class="form-section">
      <div class="form-section-title">SSH check</div>
      <div class="form-section-desc">Key-based authentication. Optionally runs a test command and asserts its exit code.</div>
      <div class="form-row">
        <div style="grid-column:span 2">
          <label>Host</label>
          <input name="ssh_host" value={cfg?.host ?? ""} />
        </div>
        <div>
          <label>Port</label>
          <input name="ssh_port" type="number" value={String(cfg?.port ?? 22)} />
        </div>
        <div>
          <label>Username</label>
          <input name="ssh_username" value={cfg?.username ?? ""} placeholder="deploy" />
        </div>
      </div>
      <label>Private key (PEM)</label>
      <textarea name="ssh_private_key" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..." safe>
        {cfg?.privateKey ?? ""}
      </textarea>
      <label>Passphrase (if key is encrypted)</label>
      <input name="ssh_passphrase" type="password" value={cfg?.passphrase ?? ""} />
      <label>Test command (optional)</label>
      <input name="ssh_command" value={cfg?.command ?? ""} placeholder="systemctl is-active nginx" />
      <label>Expected exit code</label>
      <input name="ssh_expect_exit" type="number" value={String(cfg?.expectExitCode ?? 0)} />
    </div>
  );
}

// === Form parsing ===

type ParseResult =
  | { record: Omit<MonitorRecord, "id">; webhookIds: number[] }
  | { error: string; partial: Partial<MonitorRecord>; webhookIds: number[] };

interface FormLike {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

function parseMonitorForm(form: FormLike): ParseResult {
  const name = String(form.get("name") ?? "").trim();
  const type = String(form.get("type") ?? "") as MonitorType;
  const interval_seconds = Number(form.get("interval_seconds")) || 60;
  const timeout_ms = Number(form.get("timeout_ms")) || 10_000;
  const failure_threshold = Math.max(1, Number(form.get("failure_threshold")) || 2);
  const success_threshold = Math.max(1, Number(form.get("success_threshold")) || 1);
  const enabled = form.get("enabled") === "on";
  const rawGroup = String(form.get("group_name") ?? "").trim();
  const group_name: string | null = rawGroup === "" ? null : rawGroup;
  const is_public = String(form.get("is_public") ?? "1") !== "0";
  const rawNotes = String(form.get("notes") ?? "");
  const notes: string | null = rawNotes.trim() === "" ? null : rawNotes;
  const webhookIds = form.getAll("webhook_ids").map((v) => Number(v)).filter((n) => Number.isInteger(n));

  const partial: Partial<MonitorRecord> = {
    name, type, interval_seconds, timeout_ms,
    failure_threshold, success_threshold, enabled,
    group_name, is_public, notes,
  };

  if (!name) return { error: "Name is required", partial, webhookIds };
  if (!["http", "tcp", "ssh"].includes(type)) return { error: "Invalid type", partial, webhookIds };

  let config: AnyConfig;
  if (type === "http") {
    const url = String(form.get("http_url") ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { error: "URL must start with http:// or https://", partial, webhookIds };
    }
    const cfg: HttpConfig = { url };
    cfg.method = (String(form.get("http_method") ?? "GET") as HttpConfig["method"]) || "GET";

    const headersText = String(form.get("http_headers") ?? "").trim();
    if (headersText) {
      try {
        const parsed = JSON.parse(headersText);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        cfg.headers = parsed as Record<string, string>;
      } catch {
        return { error: "Headers must be a JSON object", partial: { ...partial, config: cfg }, webhookIds };
      }
    }
    const body = String(form.get("http_body") ?? "");
    if (body) cfg.body = body;

    const authType = String(form.get("http_auth_type") ?? "none");
    if (authType === "basic") {
      cfg.auth = {
        type: "basic",
        username: String(form.get("http_auth_username") ?? ""),
        password: String(form.get("http_auth_password") ?? ""),
      };
    } else if (authType === "bearer") {
      cfg.auth = { type: "bearer", token: String(form.get("http_auth_token") ?? "") };
    }
    cfg.followRedirects = form.get("http_follow_redirects") === "on";

    const expected = String(form.get("http_expected_status") ?? "").trim();
    if (expected) {
      const parts = expected.split(/[,\s]+/).filter(Boolean).map(Number);
      if (parts.some((n) => !Number.isInteger(n))) {
        return { error: "Expected status must be one or more integers", partial: { ...partial, config: cfg }, webhookIds };
      }
      cfg.expectedStatus = parts.length === 1 ? parts[0]! : parts;
    }
    const bodyContains = String(form.get("http_expected_body") ?? "").trim();
    if (bodyContains) cfg.expectedBodyContains = bodyContains;
    if (form.get("http_ignore_tls") === "on") cfg.ignoreTlsErrors = true;
    config = cfg;
  } else if (type === "tcp") {
    const host = String(form.get("tcp_host") ?? "").trim();
    const port = Number(form.get("tcp_port"));
    if (!host) return { error: "TCP host is required", partial, webhookIds };
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: "TCP port must be an integer 1-65535", partial, webhookIds };
    }
    config = { host, port };
  } else {
    const host = String(form.get("ssh_host") ?? "").trim();
    const port = Number(form.get("ssh_port")) || 22;
    const username = String(form.get("ssh_username") ?? "").trim();
    const privateKey = String(form.get("ssh_private_key") ?? "").trim();
    if (!host || !username || !privateKey) {
      return { error: "SSH host, username, and private key are required", partial, webhookIds };
    }
    const cfg: SshConfig = { host, port, username, privateKey };
    const passphrase = String(form.get("ssh_passphrase") ?? "");
    if (passphrase) cfg.passphrase = passphrase;
    const command = String(form.get("ssh_command") ?? "").trim();
    if (command) cfg.command = command;
    const expectExit = String(form.get("ssh_expect_exit") ?? "").trim();
    if (expectExit !== "") cfg.expectExitCode = Number(expectExit);
    config = cfg;
  }

  return {
    record: {
      name, type, config, interval_seconds, timeout_ms,
      failure_threshold, success_threshold, enabled,
      group_name, is_public, muted_until: null, notes,
    },
    webhookIds,
  };
}

export const monitorRoutes = {
  newForm: { GET: adminRoute(newFormHandler) },
  create: { POST: adminRoute(createHandler) },
  detail: { GET: publicRoute(detailGet), POST: adminRoute(detailPost) },
  delete: { POST: adminRoute(deleteHandler) },
  pause: { POST: adminRoute(pauseHandler) },
  runNow: { POST: adminRoute(runNowHandler) },
  mute: { POST: adminRoute(muteHandler) },
  unmute: { POST: adminRoute(unmuteHandler) },
  bulkPause: { POST: adminRoute(bulkPauseHandler) },
  bulkResume: { POST: adminRoute(bulkResumeHandler) },
  bulkMute: { POST: adminRoute(bulkMuteHandler) },
  bulkDelete: { POST: adminRoute(bulkDeleteHandler) },
};
