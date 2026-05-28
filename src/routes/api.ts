// REST JSON API at /api/v1/*
//
// All endpoints require a Bearer token in the Authorization header. Tokens
// are minted in the web UI at /settings (the raw token is shown exactly
// once on creation; only the hash is stored). The same `queries` module
// powers both the HTML UI and this API, so semantics stay aligned.
//
// Response shape:
//   - Collections: `{ resource_name: [...] }`
//   - Single: `{ resource_name: {...} }`
//   - Errors: `{ error: "human-readable message" }` with 4xx/5xx status
//   - Actions returning no payload: 204 No Content

import { encryptJSON, decryptJSON } from "../config";
import { db } from "../db";
import { runCheckNow } from "../scheduler";
import type { HttpConfig, MonitorType, SshConfig, TcpConfig } from "../checks/types";
import {
  ackIncident, getActiveIncidents, getAllIncidents, getFleetKpis,
  getIncident, getIncidentAlerts, getIncidentChecks, getIncidentFailures,
  getMonitor24hBuckets, getMonitorLatencySpark, getMonitorMTTR,
  getMonitorPercentile, getMonitorUptimeWindow, getRecentAlerts,
  getRecentlyResolved, getWebhookStats, setIncidentNotes,
  type IncidentRow,
} from "../queries";
import { isValidFormat, WEBHOOK_FORMATS } from "../webhook_formats";
import { apiRoute } from "./wrap";

type AnyConfig = HttpConfig | TcpConfig | SshConfig;

// ===== Response helpers =====

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

const noContent = () => new Response(null, { status: 204 });

async function readBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ===== Monitor serialization =====

type MonitorRow = {
  id: number;
  name: string;
  type: MonitorType;
  enabled: number;
  interval_seconds: number;
  timeout_ms: number;
  failure_threshold: number;
  success_threshold: number;
  group_name: string | null;
  is_public: number;
  muted_until: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  config_encrypted?: Uint8Array;
  current_status: "up" | "down" | null;
  since: number | null;
  last_checked_at: number | null;
};

function serializeMonitor(row: MonitorRow, opts: { withConfig?: boolean; latency?: number | null } = {}) {
  const out: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled === 1,
    is_public: row.is_public === 1,
    group_name: row.group_name,
    muted_until: row.muted_until,
    interval_seconds: row.interval_seconds,
    timeout_ms: row.timeout_ms,
    failure_threshold: row.failure_threshold,
    success_threshold: row.success_threshold,
    notes: row.notes,
    current_status: row.current_status,
    since: row.since,
    last_checked_at: row.last_checked_at,
    latest_latency_ms: opts.latency ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (opts.withConfig && row.config_encrypted) {
    try {
      out.config = decryptJSON<AnyConfig>(row.config_encrypted);
    } catch {
      out.config = null;
      out.config_error = "decryption failed";
    }
  }
  return out;
}

function serializeIncident(row: IncidentRow) {
  return {
    id: row.id,
    monitor_id: row.monitor_id,
    monitor_name: row.monitor_name,
    monitor_type: row.monitor_type,
    started_at: row.started_at,
    ended_at: row.ended_at,
    acked_at: row.acked_at,
    initial_detail: row.initial_detail,
    notes: row.notes,
    is_open: row.ended_at === null,
    is_acked: row.acked_at !== null,
    duration_ms: (row.ended_at ?? Date.now()) - row.started_at,
  };
}

// ===== Monitor body parser (JSON, partial-friendly) =====

type MonitorBody = {
  name?: string;
  type?: MonitorType;
  config?: AnyConfig;
  interval_seconds?: number;
  timeout_ms?: number;
  failure_threshold?: number;
  success_threshold?: number;
  enabled?: boolean;
  group_name?: string | null;
  is_public?: boolean;
  notes?: string | null;
  webhook_ids?: number[];
};

type ValidatedMonitor = {
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
  notes: string | null;
};

function validateConfig(type: MonitorType, cfg: unknown): { ok: true; value: AnyConfig } | { ok: false; error: string } {
  if (cfg === null || typeof cfg !== "object") {
    return { ok: false, error: "config must be an object" };
  }
  const c = cfg as Record<string, unknown>;
  if (type === "http") {
    if (typeof c.url !== "string" || !/^https?:\/\//i.test(c.url)) {
      return { ok: false, error: "http.url must be http:// or https://" };
    }
    return { ok: true, value: c as HttpConfig };
  }
  if (type === "tcp") {
    if (typeof c.host !== "string" || !c.host) return { ok: false, error: "tcp.host is required" };
    if (typeof c.port !== "number" || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535) {
      return { ok: false, error: "tcp.port must be an integer 1-65535" };
    }
    return { ok: true, value: c as TcpConfig };
  }
  if (type === "ssh") {
    if (typeof c.host !== "string" || !c.host) return { ok: false, error: "ssh.host is required" };
    if (typeof c.username !== "string" || !c.username) return { ok: false, error: "ssh.username is required" };
    if (typeof c.privateKey !== "string" || !c.privateKey) return { ok: false, error: "ssh.privateKey is required" };
    return { ok: true, value: c as SshConfig };
  }
  return { ok: false, error: "unknown type" };
}

function validateMonitorBody(body: MonitorBody, existing?: ValidatedMonitor): { ok: true; value: ValidatedMonitor } | { ok: false; error: string } {
  const name = body.name ?? existing?.name;
  const type = body.type ?? existing?.type;
  const config = body.config ?? existing?.config;
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "name is required" };
  if (!type || !["http", "tcp", "ssh"].includes(type)) return { ok: false, error: "type must be http, tcp, or ssh" };
  if (!config) return { ok: false, error: "config is required" };

  // When type changes on PATCH, the existing config may not match — re-validate.
  const cfgResult = validateConfig(type, config);
  if (!cfgResult.ok) return cfgResult;

  const intervalNum = body.interval_seconds ?? existing?.interval_seconds ?? 60;
  const timeoutNum = body.timeout_ms ?? existing?.timeout_ms ?? 10000;
  const failureNum = body.failure_threshold ?? existing?.failure_threshold ?? 2;
  const successNum = body.success_threshold ?? existing?.success_threshold ?? 1;

  if (!Number.isInteger(intervalNum) || intervalNum < 5) return { ok: false, error: "interval_seconds must be ≥ 5" };
  if (!Number.isInteger(timeoutNum) || timeoutNum < 500) return { ok: false, error: "timeout_ms must be ≥ 500" };
  if (!Number.isInteger(failureNum) || failureNum < 1) return { ok: false, error: "failure_threshold must be ≥ 1" };
  if (!Number.isInteger(successNum) || successNum < 1) return { ok: false, error: "success_threshold must be ≥ 1" };

  return {
    ok: true,
    value: {
      name: name.trim(),
      type,
      config: cfgResult.value,
      interval_seconds: intervalNum,
      timeout_ms: timeoutNum,
      failure_threshold: failureNum,
      success_threshold: successNum,
      enabled: body.enabled ?? existing?.enabled ?? true,
      group_name: body.group_name === undefined ? (existing?.group_name ?? null) : (body.group_name?.trim() || null),
      is_public: body.is_public ?? existing?.is_public ?? true,
      notes: body.notes === undefined ? (existing?.notes ?? null) : (body.notes?.trim() || null),
    },
  };
}

// ===== Monitor handlers =====

const listMonitorsQuery = db.query<MonitorRow & { latest_latency: number | null }, []>(`
  SELECT m.id, m.name, m.type, m.enabled, m.interval_seconds, m.timeout_ms,
         m.failure_threshold, m.success_threshold, m.group_name, m.is_public,
         m.muted_until, m.notes, m.created_at, m.updated_at,
         s.current_status, s.since, s.last_checked_at,
         (SELECT latency_ms FROM check_results
          WHERE monitor_id = m.id ORDER BY checked_at DESC LIMIT 1) AS latest_latency
  FROM monitors m
  LEFT JOIN monitor_state s ON s.monitor_id = m.id
  ORDER BY m.name
`);

const getMonitorQuery = db.query<MonitorRow & { latest_latency: number | null }, [number]>(`
  SELECT m.id, m.name, m.type, m.enabled, m.interval_seconds, m.timeout_ms,
         m.failure_threshold, m.success_threshold, m.group_name, m.is_public,
         m.muted_until, m.notes, m.created_at, m.updated_at, m.config_encrypted,
         s.current_status, s.since, s.last_checked_at,
         (SELECT latency_ms FROM check_results
          WHERE monitor_id = m.id ORDER BY checked_at DESC LIMIT 1) AS latest_latency
  FROM monitors m
  LEFT JOIN monitor_state s ON s.monitor_id = m.id
  WHERE m.id = ?
`);

const insertMonitor = db.query<{ id: number }, [
  string, MonitorType, Buffer, number, number, number, number, number,
  string | null, number, string | null, number, number
]>(`
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
const deleteMonitor = db.query("DELETE FROM monitors WHERE id = ?");
const togglePauseMonitor = db.query("UPDATE monitors SET enabled = ?1, updated_at = ?2 WHERE id = ?3");
const muteMonitor = db.query("UPDATE monitors SET muted_until = ?2, updated_at = ?3 WHERE id = ?1");
const clearWebhookBindings = db.query("DELETE FROM monitor_webhooks WHERE monitor_id = ?");
const addWebhookBinding = db.query("INSERT INTO monitor_webhooks (monitor_id, webhook_id) VALUES (?, ?)");
const listMonitorWebhooks = db.query<{ webhook_id: number }, [number]>(
  "SELECT webhook_id FROM monitor_webhooks WHERE monitor_id = ?"
);

function listMonitorsHandler(_req: Bun.BunRequest<"/api/v1/monitors">): Response {
  const rows = listMonitorsQuery.all();
  return json({ monitors: rows.map((r) => serializeMonitor(r, { latency: r.latest_latency })) });
}

async function createMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors">): Promise<Response> {
  const body = await readBody<MonitorBody>(req);
  if (!body) return error("invalid JSON body", 400);
  const result = validateMonitorBody(body);
  if (!result.ok) return error(result.error, 400);
  const m = result.value;
  const now = Date.now();
  const blob = encryptJSON(m.config);
  const inserted = insertMonitor.get(
    m.name, m.type, blob, m.interval_seconds, m.timeout_ms,
    m.failure_threshold, m.success_threshold, m.enabled ? 1 : 0,
    m.group_name, m.is_public ? 1 : 0, m.notes, now, now,
  );
  if (!inserted) return error("insert failed", 500);
  const webhookIds = body.webhook_ids ?? [];
  for (const wid of webhookIds) {
    if (Number.isInteger(wid)) addWebhookBinding.run(inserted.id, wid);
  }
  const row = getMonitorQuery.get(inserted.id)!;
  return json({ monitor: serializeMonitor(row, { withConfig: true, latency: row.latest_latency }) }, 201);
}

function readMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors/:id">): Response {
  const id = Number(req.params.id);
  const row = getMonitorQuery.get(id);
  if (!row) return error("monitor not found", 404);
  const bindings = listMonitorWebhooks.all(id).map((w) => w.webhook_id);
  return json({
    monitor: serializeMonitor(row, { withConfig: true, latency: row.latest_latency }),
    webhook_ids: bindings,
  });
}

async function updateMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors/:id">): Promise<Response> {
  const id = Number(req.params.id);
  const row = getMonitorQuery.get(id);
  if (!row) return error("monitor not found", 404);
  const body = await readBody<MonitorBody>(req);
  if (!body) return error("invalid JSON body", 400);

  const existing: ValidatedMonitor = {
    name: row.name,
    type: row.type,
    config: decryptJSON<AnyConfig>(row.config_encrypted!),
    interval_seconds: row.interval_seconds,
    timeout_ms: row.timeout_ms,
    failure_threshold: row.failure_threshold,
    success_threshold: row.success_threshold,
    enabled: row.enabled === 1,
    group_name: row.group_name,
    is_public: row.is_public === 1,
    notes: row.notes,
  };
  const result = validateMonitorBody(body, existing);
  if (!result.ok) return error(result.error, 400);
  const m = result.value;
  const blob = encryptJSON(m.config);
  updateMonitor.run(
    m.name, m.type, blob, m.interval_seconds, m.timeout_ms,
    m.failure_threshold, m.success_threshold, m.enabled ? 1 : 0,
    m.group_name, m.is_public ? 1 : 0, m.notes, Date.now(), id,
  );
  if (body.webhook_ids !== undefined) {
    clearWebhookBindings.run(id);
    for (const wid of body.webhook_ids) {
      if (Number.isInteger(wid)) addWebhookBinding.run(id, wid);
    }
  }
  const updated = getMonitorQuery.get(id)!;
  return json({ monitor: serializeMonitor(updated, { withConfig: true, latency: updated.latest_latency }) });
}

function deleteMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors/:id">): Response {
  const id = Number(req.params.id);
  const row = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!row) return error("monitor not found", 404);
  deleteMonitor.run(id);
  return noContent();
}

function pauseMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors/:id/pause">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!exists) return error("monitor not found", 404);
  togglePauseMonitor.run(0, Date.now(), id);
  return noContent();
}

function resumeMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors/:id/resume">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!exists) return error("monitor not found", 404);
  togglePauseMonitor.run(1, Date.now(), id);
  return noContent();
}

async function muteMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors/:id/mute">): Promise<Response> {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!exists) return error("monitor not found", 404);
  const body = await readBody<{ duration_ms?: number; until?: number }>(req);
  if (!body) return error("invalid JSON body", 400);
  let until: number;
  if (typeof body.until === "number" && body.until > Date.now()) {
    until = body.until;
  } else if (typeof body.duration_ms === "number" && body.duration_ms > 0) {
    until = Date.now() + body.duration_ms;
  } else {
    return error("body must include duration_ms (positive ms) or until (future epoch ms)", 400);
  }
  muteMonitor.run(id, until, Date.now());
  return json({ muted_until: until });
}

function unmuteMonitorHandler(req: Bun.BunRequest<"/api/v1/monitors/:id/unmute">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!exists) return error("monitor not found", 404);
  muteMonitor.run(id, null, Date.now());
  return noContent();
}

function runNowHandler(req: Bun.BunRequest<"/api/v1/monitors/:id/run-now">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!exists) return error("monitor not found", 404);
  void runCheckNow(id);
  return json({ queued: true });
}

function monitorStatsHandler(req: Bun.BunRequest<"/api/v1/monitors/:id/stats">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!exists) return error("monitor not found", 404);
  const now = Date.now();
  return json({
    uptime_24h: getMonitorUptimeWindow(id, now - 24 * 60 * 60 * 1000),
    uptime_7d: getMonitorUptimeWindow(id, now - 7 * 24 * 60 * 60 * 1000),
    uptime_30d: getMonitorUptimeWindow(id, now - 30 * 24 * 60 * 60 * 1000),
    p50_latency_ms_1h: getMonitorPercentile(id, now - 60 * 60 * 1000, 50),
    p95_latency_ms_1h: getMonitorPercentile(id, now - 60 * 60 * 1000, 95),
    p99_latency_ms_1h: getMonitorPercentile(id, now - 60 * 60 * 1000, 99),
    mttr_30d_ms: getMonitorMTTR(id, now - 30 * 24 * 60 * 60 * 1000),
    uptime_buckets_24h: getMonitor24hBuckets(id),
    latency_spark_1h: getMonitorLatencySpark(id, now - 60 * 60 * 1000, 14),
  });
}

function monitorChecksHandler(req: Bun.BunRequest<"/api/v1/monitors/:id/checks">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM monitors WHERE id = ?").get(id);
  if (!exists) return error("monitor not found", 404);
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const rows = db
    .query<{ checked_at: number; status: string; latency_ms: number | null; detail: string | null }, [number, number]>(
      "SELECT checked_at, status, latency_ms, detail FROM check_results WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?"
    )
    .all(id, limit);
  return json({ checks: rows });
}

// ===== Incident handlers =====

function listIncidentsHandler(req: Bun.BunRequest<"/api/v1/incidents">): Response {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") ?? "open";
  let rows: IncidentRow[];
  if (tab === "open") rows = getActiveIncidents();
  else if (tab === "resolved") rows = getRecentlyResolved(Date.now() - 30 * 24 * 60 * 60 * 1000, 200);
  else if (tab === "all") rows = getAllIncidents(200);
  else return error("tab must be one of: open, resolved, all", 400);
  return json({ incidents: rows.map(serializeIncident) });
}

function readIncidentHandler(req: Bun.BunRequest<"/api/v1/incidents/:id">): Response {
  const id = Number(req.params.id);
  const row = getIncident(id);
  if (!row) return error("incident not found", 404);
  return json({
    incident: serializeIncident(row),
    failed_checks: getIncidentFailures(row),
    alerts_sent: getIncidentAlerts(row),
    checks: getIncidentChecks(row.monitor_id, row.started_at, row.ended_at),
  });
}

function ackIncidentHandler(req: Bun.BunRequest<"/api/v1/incidents/:id/ack">): Response {
  const id = Number(req.params.id);
  const row = getIncident(id);
  if (!row) return error("incident not found", 404);
  ackIncident(id);
  return json({ incident: serializeIncident(getIncident(id)!) });
}

async function updateIncidentNotesHandler(req: Bun.BunRequest<"/api/v1/incidents/:id">): Promise<Response> {
  const id = Number(req.params.id);
  const row = getIncident(id);
  if (!row) return error("incident not found", 404);
  const body = await readBody<{ notes?: string | null }>(req);
  if (!body) return error("invalid JSON body", 400);
  const raw = typeof body.notes === "string" ? body.notes : null;
  setIncidentNotes(id, raw && raw.trim() !== "" ? raw : null);
  return json({ incident: serializeIncident(getIncident(id)!) });
}

// ===== Webhook handlers =====

const listWebhooksQuery = db.query<
  { id: number; name: string; url: string; enabled: number; format: string; template: string | null; created_at: number },
  []
>("SELECT id, name, url, enabled, format, template, created_at FROM webhooks ORDER BY created_at DESC");
const insertWebhookQuery = db.query<{ id: number }, [string, string, number, string, string | null, number]>(
  "INSERT INTO webhooks (name, url, enabled, format, template, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
);
const deleteWebhookQuery = db.query("DELETE FROM webhooks WHERE id = ?");
const toggleWebhookQuery = db.query("UPDATE webhooks SET enabled = 1 - enabled WHERE id = ?");

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function serializeWebhook(row: { id: number; name: string; url: string; enabled: number; format: string; template: string | null; created_at: number }) {
  const stats = getWebhookStats(row.id);
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled === 1,
    format: row.format,
    template: row.template,
    created_at: row.created_at,
    stats,
  };
}

function listWebhooksHandler(_req: Bun.BunRequest<"/api/v1/webhooks">): Response {
  return json({ webhooks: listWebhooksQuery.all().map(serializeWebhook) });
}

async function createWebhookHandler(req: Bun.BunRequest<"/api/v1/webhooks">): Promise<Response> {
  const body = await readBody<{ name?: string; url?: string; enabled?: boolean; format?: string; template?: string | null }>(req);
  if (!body) return error("invalid JSON body", 400);
  const name = (body.name ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!name) return error("name is required", 400);
  if (!isHttpUrl(url)) return error("url must be http:// or https://", 400);
  const formatStr = body.format ?? "generic";
  if (!isValidFormat(formatStr)) {
    return error(`format must be one of: ${WEBHOOK_FORMATS.join(", ")}`, 400);
  }
  const template = body.template ?? null;
  if (formatStr === "custom" && (!template || !template.trim())) {
    return error("custom format requires a non-empty template", 400);
  }
  const inserted = insertWebhookQuery.get(name, url, body.enabled === false ? 0 : 1, formatStr, template, Date.now());
  if (!inserted) return error("insert failed", 500);
  const row = listWebhooksQuery.all().find((w) => w.id === inserted.id);
  return json({ webhook: row ? serializeWebhook(row) : null }, 201);
}

function deleteWebhookHandler(req: Bun.BunRequest<"/api/v1/webhooks/:id">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM webhooks WHERE id = ?").get(id);
  if (!exists) return error("webhook not found", 404);
  deleteWebhookQuery.run(id);
  return noContent();
}

function toggleWebhookHandler(req: Bun.BunRequest<"/api/v1/webhooks/:id/toggle">): Response {
  const id = Number(req.params.id);
  const exists = db.query("SELECT id FROM webhooks WHERE id = ?").get(id);
  if (!exists) return error("webhook not found", 404);
  toggleWebhookQuery.run(id);
  const row = listWebhooksQuery.all().find((w) => w.id === id)!;
  return json({ webhook: serializeWebhook(row) });
}

// ===== Stats =====

function fleetStatsHandler(_req: Bun.BunRequest<"/api/v1/stats/fleet">): Response {
  return json({
    fleet: getFleetKpis(),
    recent_alerts: getRecentAlerts(20),
  });
}

// ===== Health =====

function healthHandler(_req: Bun.BunRequest<"/api/v1/healthz">): Response {
  return json({ status: "ok" });
}

// ===== Route exports =====

export const apiRoutes = {
  // Monitors
  monitorsList:    { GET: apiRoute(listMonitorsHandler), POST: apiRoute(createMonitorHandler) },
  monitorDetail:  { GET: apiRoute(readMonitorHandler), PATCH: apiRoute(updateMonitorHandler), DELETE: apiRoute(deleteMonitorHandler) },
  monitorPause:   { POST: apiRoute(pauseMonitorHandler) },
  monitorResume:  { POST: apiRoute(resumeMonitorHandler) },
  monitorMute:    { POST: apiRoute(muteMonitorHandler) },
  monitorUnmute:  { POST: apiRoute(unmuteMonitorHandler) },
  monitorRunNow:  { POST: apiRoute(runNowHandler) },
  monitorStats:   { GET: apiRoute(monitorStatsHandler) },
  monitorChecks:  { GET: apiRoute(monitorChecksHandler) },
  // Incidents
  incidentsList:  { GET: apiRoute(listIncidentsHandler) },
  incidentDetail: { GET: apiRoute(readIncidentHandler), PATCH: apiRoute(updateIncidentNotesHandler) },
  incidentAck:    { POST: apiRoute(ackIncidentHandler) },
  // Webhooks
  webhooksList:   { GET: apiRoute(listWebhooksHandler), POST: apiRoute(createWebhookHandler) },
  webhookDetail:  { DELETE: apiRoute(deleteWebhookHandler) },
  webhookToggle:  { POST: apiRoute(toggleWebhookHandler) },
  // Stats + health
  statsFleet:     { GET: apiRoute(fleetStatsHandler) },
  healthz:        { GET: apiRoute(healthHandler) },
};
