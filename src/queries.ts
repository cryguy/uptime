// Aggregation queries used across the dashboard, monitor detail, /incidents,
// /webhooks, and the rail panels.
//
// Designed to be cheap on the existing indexes:
//   - idx_check_results_monitor_time covers all per-monitor windowed scans.
//   - idx_incidents_open / idx_incidents_started cover incident lookups.
//   - alert_queue has idx_alert_queue_pending; full scans here are small.

import { db } from "./db";

// === Incident rows ===

export type IncidentRow = {
  id: number;
  monitor_id: number;
  monitor_name: string;
  monitor_type: string;
  started_at: number;
  ended_at: number | null;
  acked_at: number | null;
  initial_detail: string | null;
};

const activeIncidentsQuery = db.query<IncidentRow, []>(`
  SELECT i.id, i.monitor_id, m.name AS monitor_name, m.type AS monitor_type,
         i.started_at, i.ended_at, i.acked_at, i.initial_detail
  FROM incidents i
  JOIN monitors m ON m.id = i.monitor_id
  WHERE i.ended_at IS NULL
  ORDER BY i.started_at DESC
`);
export const getActiveIncidents = (): IncidentRow[] => activeIncidentsQuery.all();

const bannerIncidentQuery = db.query<IncidentRow, []>(`
  SELECT i.id, i.monitor_id, m.name AS monitor_name, m.type AS monitor_type,
         i.started_at, i.ended_at, i.acked_at, i.initial_detail
  FROM incidents i
  JOIN monitors m ON m.id = i.monitor_id
  WHERE i.ended_at IS NULL AND i.acked_at IS NULL
  ORDER BY i.started_at DESC
  LIMIT 1
`);
export const getBannerIncident = (): IncidentRow | null =>
  bannerIncidentQuery.get() ?? null;

const recentResolvedQuery = db.query<IncidentRow, [number, number]>(`
  SELECT i.id, i.monitor_id, m.name AS monitor_name, m.type AS monitor_type,
         i.started_at, i.ended_at, i.acked_at, i.initial_detail
  FROM incidents i
  JOIN monitors m ON m.id = i.monitor_id
  WHERE i.ended_at IS NOT NULL AND i.ended_at > ?
  ORDER BY i.ended_at DESC
  LIMIT ?
`);
export const getRecentlyResolved = (sinceMs: number, limit: number): IncidentRow[] =>
  recentResolvedQuery.all(sinceMs, limit);

const allIncidentsQuery = db.query<IncidentRow, [number]>(`
  SELECT i.id, i.monitor_id, m.name AS monitor_name, m.type AS monitor_type,
         i.started_at, i.ended_at, i.acked_at, i.initial_detail
  FROM incidents i
  JOIN monitors m ON m.id = i.monitor_id
  ORDER BY i.started_at DESC
  LIMIT ?
`);
export const getAllIncidents = (limit: number): IncidentRow[] => allIncidentsQuery.all(limit);

const ackIncidentQuery = db.query(
  "UPDATE incidents SET acked_at = ? WHERE id = ? AND acked_at IS NULL"
);
export const ackIncident = (id: number): void => {
  ackIncidentQuery.run(Date.now(), id);
};

// Failed checks within an incident — derived from check_results, not stored.
// Open incidents (ended_at = null) are treated as ending "now" for the bound.
const incidentFailuresQuery = db.query<{ c: number }, [number, number, number]>(`
  SELECT COUNT(*) AS c FROM check_results
  WHERE monitor_id = ? AND status = 'down'
    AND checked_at >= ? AND checked_at <= ?
`);
export const getIncidentFailures = (i: IncidentRow): number => {
  const endLimit = i.ended_at ?? Date.now();
  return incidentFailuresQuery.get(i.monitor_id, i.started_at, endLimit)?.c ?? 0;
};

const incidentAlertsQuery = db.query<{ c: number }, [number, number]>(`
  SELECT COUNT(*) AS c FROM alert_queue
  WHERE monitor_id = ? AND event = 'down' AND next_attempt_at >= ?
`);
export const getIncidentAlerts = (i: IncidentRow): number =>
  incidentAlertsQuery.get(i.monitor_id, i.started_at)?.c ?? 0;

// === Uptime aggregations ===

const uptimeWindowQuery = db.query<{ up: number; down: number }, [number, number]>(`
  SELECT
    SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up,
    SUM(CASE WHEN status='down' THEN 1 ELSE 0 END) AS down
  FROM check_results
  WHERE monitor_id = ? AND checked_at > ?
`);
export type UptimeWindow = { up: number; down: number; total: number; percent: number | null };
export function getMonitorUptimeWindow(monitorId: number, sinceMs: number): UptimeWindow {
  const row = uptimeWindowQuery.get(monitorId, sinceMs);
  const up = Number(row?.up ?? 0);
  const down = Number(row?.down ?? 0);
  const total = up + down;
  return { up, down, total, percent: total > 0 ? (up / total) * 100 : null };
}

// 24h hourly buckets for the dashboard uptime strip.
const bucketsQuery = db.query<
  { bucket: number; up_count: number; down_count: number },
  [number, number, number]
>(`
  SELECT
    CAST((checked_at - ?) / 3600000 AS INTEGER) AS bucket,
    SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up_count,
    SUM(CASE WHEN status='down' THEN 1 ELSE 0 END) AS down_count
  FROM check_results
  WHERE monitor_id = ? AND checked_at > ?
  GROUP BY bucket
  ORDER BY bucket
`);

export type Bucket = "up" | "down" | "empty";
export function getMonitor24hBuckets(monitorId: number): Bucket[] {
  const now = Date.now();
  const start = now - 24 * 60 * 60 * 1000;
  const rows = bucketsQuery.all(start, monitorId, start);
  const buckets: Bucket[] = new Array(24).fill("empty");
  for (const row of rows) {
    if (row.bucket < 0 || row.bucket >= 24) continue;
    buckets[row.bucket] = row.down_count > 0 ? "down" : "up";
  }
  return buckets;
}

// === Latency series ===

const latencyWindowQuery = db.query<{ latency_ms: number }, [number, number]>(`
  SELECT latency_ms FROM check_results
  WHERE monitor_id = ? AND checked_at > ?
    AND latency_ms IS NOT NULL AND status = 'up'
  ORDER BY checked_at
`);

// Returns N evenly-spaced latency samples from the window.
export function getMonitorLatencySpark(
  monitorId: number,
  sinceMs: number,
  samples = 14,
): number[] {
  const rows = latencyWindowQuery.all(monitorId, sinceMs);
  if (rows.length === 0) return [];
  if (rows.length <= samples) return rows.map((r) => r.latency_ms);
  const result: number[] = [];
  for (let i = 0; i < samples; i++) {
    const idx = Math.floor((i / (samples - 1)) * (rows.length - 1));
    result.push(rows[idx]!.latency_ms);
  }
  return result;
}

const sortedLatencyQuery = db.query<{ latency_ms: number }, [number, number]>(`
  SELECT latency_ms FROM check_results
  WHERE monitor_id = ? AND checked_at > ?
    AND latency_ms IS NOT NULL AND status = 'up'
  ORDER BY latency_ms
`);
export function getMonitorPercentile(
  monitorId: number,
  sinceMs: number,
  p: number,
): number | null {
  const rows = sortedLatencyQuery.all(monitorId, sinceMs);
  if (rows.length === 0) return null;
  const idx = Math.floor((rows.length - 1) * (p / 100));
  return rows[idx]!.latency_ms;
}

const fleetLatencyQuery = db.query<{ latency_ms: number }, [number]>(`
  SELECT latency_ms FROM check_results
  WHERE checked_at > ? AND latency_ms IS NOT NULL AND status = 'up'
  ORDER BY latency_ms
`);
export function getFleetPercentile(sinceMs: number, p: number): number | null {
  const rows = fleetLatencyQuery.all(sinceMs);
  if (rows.length === 0) return null;
  const idx = Math.floor((rows.length - 1) * (p / 100));
  return rows[idx]!.latency_ms;
}

// === MTTR ===

const mttrQuery = db.query<{ avg_duration: number | null }, [number, number]>(`
  SELECT AVG(ended_at - started_at) AS avg_duration
  FROM incidents
  WHERE monitor_id = ? AND ended_at IS NOT NULL AND ended_at > ?
`);
export function getMonitorMTTR(monitorId: number, sinceMs: number): number | null {
  return mttrQuery.get(monitorId, sinceMs)?.avg_duration ?? null;
}

const fleetMttrQuery = db.query<{ avg_duration: number | null }, [number]>(`
  SELECT AVG(ended_at - started_at) AS avg_duration
  FROM incidents
  WHERE ended_at IS NOT NULL AND ended_at > ?
`);
export function getFleetMTTR(sinceMs: number): number | null {
  return fleetMttrQuery.get(sinceMs)?.avg_duration ?? null;
}

// === Fleet KPIs (top of dashboard) ===

export type FleetKpis = {
  total: number;
  up: number;
  down: number;
  upPercent24h: number | null;
  p95LatencyMs: number | null;
  mttr30dMs: number | null;
};

export function getFleetKpis(): FleetKpis {
  const total = (db.query("SELECT COUNT(*) AS c FROM monitors").get() as { c: number }).c;
  const up = (db.query("SELECT COUNT(*) AS c FROM monitor_state WHERE current_status='up'").get() as { c: number }).c;
  const down = (db.query("SELECT COUNT(*) AS c FROM monitor_state WHERE current_status='down'").get() as { c: number }).c;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const window = db
    .query<{ up: number; down: number }, [number]>(`
      SELECT
        SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up,
        SUM(CASE WHEN status='down' THEN 1 ELSE 0 END) AS down
      FROM check_results
      WHERE checked_at > ?
    `)
    .get(oneDayAgo);
  const upCount = Number(window?.up ?? 0);
  const downCount = Number(window?.down ?? 0);
  const upPercent24h = upCount + downCount > 0 ? (upCount / (upCount + downCount)) * 100 : null;
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  return {
    total,
    up,
    down,
    upPercent24h,
    p95LatencyMs: getFleetPercentile(oneHourAgo, 95),
    mttr30dMs: getFleetMTTR(Date.now() - 30 * 24 * 60 * 60 * 1000),
  };
}

// Sparkline of fleet-wide hourly up % across last 14h (for KPI "Up" card).
const fleetUpHourlyQuery = db.query<{ bucket: number; up: number; down: number }, [number, number]>(`
  SELECT
    CAST((checked_at - ?) / 3600000 AS INTEGER) AS bucket,
    SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up,
    SUM(CASE WHEN status='down' THEN 1 ELSE 0 END) AS down
  FROM check_results
  WHERE checked_at > ?
  GROUP BY bucket
  ORDER BY bucket
`);
export function getFleetUpPercentSparkline(): number[] {
  const start = Date.now() - 14 * 60 * 60 * 1000;
  const rows = fleetUpHourlyQuery.all(start, start);
  const series: number[] = new Array(14).fill(100);
  for (const row of rows) {
    if (row.bucket < 0 || row.bucket >= 14) continue;
    const total = Number(row.up) + Number(row.down);
    series[row.bucket] = total > 0 ? (Number(row.up) / total) * 100 : 100;
  }
  return series;
}

// Sparkline of fleet-wide p95 latency across last 14h.
const fleetP95HourlyQuery = db.query<{ bucket: number; latency_ms: number }, [number, number]>(`
  SELECT
    CAST((checked_at - ?) / 3600000 AS INTEGER) AS bucket,
    latency_ms
  FROM check_results
  WHERE checked_at > ? AND latency_ms IS NOT NULL AND status = 'up'
  ORDER BY bucket, latency_ms
`);
export function getFleetP95LatencySparkline(): number[] {
  const start = Date.now() - 14 * 60 * 60 * 1000;
  const rows = fleetP95HourlyQuery.all(start, start);
  const byBucket = new Map<number, number[]>();
  for (const r of rows) {
    if (r.bucket < 0 || r.bucket >= 14) continue;
    const list = byBucket.get(r.bucket) ?? [];
    list.push(r.latency_ms);
    byBucket.set(r.bucket, list);
  }
  const out: number[] = [];
  for (let i = 0; i < 14; i++) {
    const list = byBucket.get(i);
    if (!list || list.length === 0) continue;
    const idx = Math.floor((list.length - 1) * 0.95);
    out.push(list[idx]!);
  }
  return out;
}

// === Recent alert deliveries (rail panel) ===

export type RecentAlert = {
  id: number;
  webhook_id: number;
  webhook_name: string;
  monitor_id: number;
  monitor_name: string;
  event: string;
  attempts: number;
  delivered_at: number | null;
  last_error: string | null;
  next_attempt_at: number;
};

const recentAlertsQuery = db.query<RecentAlert, [number]>(`
  SELECT a.id, a.webhook_id, w.name AS webhook_name, a.monitor_id, m.name AS monitor_name,
         a.event, a.attempts, a.delivered_at, a.last_error, a.next_attempt_at
  FROM alert_queue a
  JOIN webhooks w ON w.id = a.webhook_id
  JOIN monitors m ON m.id = a.monitor_id
  ORDER BY a.id DESC
  LIMIT ?
`);
export const getRecentAlerts = (limit: number): RecentAlert[] => recentAlertsQuery.all(limit);

// === Webhook delivery stats ===

export type WebhookStats = {
  delivered_24h: number;
  retrying: number;
  failed_recent: number;
  last_delivery_at: number | null;
};

const webhookStatsQuery = db.query<
  {
    delivered_24h: number;
    retrying: number;
    failed_recent: number;
    last_delivery_at: number | null;
  },
  [number, number]
>(`
  SELECT
    SUM(CASE WHEN delivered_at IS NOT NULL AND delivered_at > ?2 THEN 1 ELSE 0 END) AS delivered_24h,
    SUM(CASE WHEN delivered_at IS NULL AND attempts > 0 AND last_error NOT LIKE 'dead-letter:%' THEN 1 ELSE 0 END) AS retrying,
    SUM(CASE WHEN delivered_at IS NOT NULL AND last_error LIKE 'dead-letter:%' THEN 1 ELSE 0 END) AS failed_recent,
    MAX(CASE WHEN delivered_at IS NOT NULL THEN delivered_at ELSE NULL END) AS last_delivery_at
  FROM alert_queue
  WHERE webhook_id = ?1
`);
export function getWebhookStats(webhookId: number): WebhookStats {
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const row = webhookStatsQuery.get(webhookId, sinceMs);
  return {
    delivered_24h: Number(row?.delivered_24h ?? 0),
    retrying: Number(row?.retrying ?? 0),
    failed_recent: Number(row?.failed_recent ?? 0),
    last_delivery_at: row?.last_delivery_at ?? null,
  };
}
