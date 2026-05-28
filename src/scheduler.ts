import { db } from "./db";
import { decryptJSON } from "./config";
import { runCheck } from "./checks";
import type { CheckOutcome, HttpConfig, MonitorConfig, MonitorType, SshConfig, TcpConfig } from "./checks/types";
import { formatPayload, isValidFormat, type AlertEvent, type WebhookFormat } from "./webhook_formats";

type MonitorRow = {
  id: number;
  name: string;
  type: MonitorType;
  config_encrypted: Uint8Array;
  timeout_ms: number;
  failure_threshold: number;
  success_threshold: number;
  muted_until: number | null;
};

type StateRow = {
  current_status: "up" | "down" | null;
  since: number | null;
  consecutive_failures: number;
  consecutive_successes: number;
};

const dueQuery = db.query<MonitorRow, [number]>(`
  SELECT m.id, m.name, m.type, m.config_encrypted, m.timeout_ms,
         m.failure_threshold, m.success_threshold, m.muted_until
  FROM monitors m
  LEFT JOIN monitor_state s ON s.monitor_id = m.id
  WHERE m.enabled = 1
    AND (s.last_checked_at IS NULL
         OR s.last_checked_at + m.interval_seconds * 1000 <= ?)
`);

const stateQuery = db.query<StateRow, [number]>(
  "SELECT current_status, since, consecutive_failures, consecutive_successes FROM monitor_state WHERE monitor_id = ?"
);

const insertResult = db.query(
  "INSERT INTO check_results (monitor_id, checked_at, status, latency_ms, detail) VALUES (?, ?, ?, ?, ?)"
);

const upsertState = db.query(`
  INSERT INTO monitor_state (monitor_id, current_status, since, consecutive_failures, consecutive_successes, last_checked_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(monitor_id) DO UPDATE SET
    current_status = excluded.current_status,
    since = excluded.since,
    consecutive_failures = excluded.consecutive_failures,
    consecutive_successes = excluded.consecutive_successes,
    last_checked_at = excluded.last_checked_at
`);

const webhooksForMonitor = db.query<
  { id: number; format: string; template: string | null },
  [number]
>(`
  SELECT w.id, w.format, w.template
  FROM monitor_webhooks mw
  JOIN webhooks w ON w.id = mw.webhook_id
  WHERE mw.monitor_id = ? AND w.enabled = 1
`);
const insertAlert = db.query(
  "INSERT INTO alert_queue (webhook_id, monitor_id, event, payload, next_attempt_at) VALUES (?, ?, ?, ?, ?)"
);
const openIncident = db.query(
  "INSERT INTO incidents (monitor_id, started_at, initial_detail) VALUES (?, ?, ?)"
);
const closeIncident = db.query(
  "UPDATE incidents SET ended_at = ? WHERE monitor_id = ? AND ended_at IS NULL"
);

const inflight = new Set<number>();

async function tick(): Promise<void> {
  const now = Date.now();
  const due = dueQuery.all(now);
  for (const m of due) {
    if (inflight.has(m.id)) continue;
    inflight.add(m.id);
    void runOne(m).finally(() => inflight.delete(m.id));
  }
}

async function runOne(m: MonitorRow): Promise<void> {
  let mc: MonitorConfig;
  try {
    const raw = decryptJSON<HttpConfig | TcpConfig | SshConfig>(m.config_encrypted);
    mc = { type: m.type, config: raw } as MonitorConfig;
  } catch (err) {
    console.error(`monitor ${m.id} (${m.name}): config decrypt failed:`, err);
    return;
  }

  let outcome: CheckOutcome;
  try {
    outcome = await runCheck(mc, m.timeout_ms);
  } catch (err) {
    outcome = {
      ok: false,
      latencyMs: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const now = Date.now();
  insertResult.run(m.id, now, outcome.ok ? "up" : "down", outcome.latencyMs, outcome.detail);

  const prev: StateRow = stateQuery.get(m.id) ?? {
    current_status: null,
    since: null,
    consecutive_failures: 0,
    consecutive_successes: 0,
  };

  const nextFails = outcome.ok ? 0 : prev.consecutive_failures + 1;
  const nextSucc = outcome.ok ? prev.consecutive_successes + 1 : 0;
  let nextStatus = prev.current_status;
  let nextSince = prev.since;
  let transition: "up" | "down" | null = null;

  const isInitial = prev.current_status === null;
  if (isInitial && outcome.ok) {
    // Silently transition null → up on first healthy check. No alert —
    // "the new monitor is healthy" is not actionable.
    nextStatus = "up";
    nextSince = now;
  } else if ((isInitial || prev.current_status === "up") && nextFails >= m.failure_threshold) {
    // null → down and up → down both alert, after threshold consecutive failures.
    nextStatus = "down";
    nextSince = now;
    transition = "down";
  } else if (prev.current_status === "down" && nextSucc >= m.success_threshold) {
    nextStatus = "up";
    nextSince = now;
    transition = "up";
  }

  upsertState.run(m.id, nextStatus, nextSince, nextFails, nextSucc, now);

  if (transition === "down") {
    openIncident.run(m.id, now, outcome.detail);
  } else if (transition === "up") {
    closeIncident.run(now, m.id);
  }

  // Suppress alerts during a mute window. State transition still happens —
  // the incident is recorded — but webhooks aren't notified until unmute.
  const isMuted = m.muted_until !== null && m.muted_until > now;
  if (transition && !isMuted) {
    enqueueAlerts(m.id, m.name, transition, outcome, now);
  }
}

function enqueueAlerts(
  monitorId: number,
  monitorName: string,
  event: "up" | "down",
  outcome: CheckOutcome,
  at: number,
): void {
  const bindings = webhooksForMonitor.all(monitorId);
  if (bindings.length === 0) return;
  const ev: AlertEvent = {
    event,
    monitor_id: monitorId,
    monitor_name: monitorName,
    latency_ms: outcome.latencyMs,
    detail: outcome.detail,
    at,
  };
  for (const w of bindings) {
    const format: WebhookFormat = isValidFormat(w.format) ? w.format : "generic";
    const payload = formatPayload(format, w.template, ev);
    insertAlert.run(w.id, monitorId, event, payload, at);
  }
}

export function startScheduler(): void {
  setInterval(() => { void tick(); }, 1000);
}

// Fire a single check immediately, bypassing the interval-due gate.
// Used by the "Run check now" admin action. Idempotent against concurrent
// scheduler ticks via the inflight Set — if the monitor is already being
// checked, we skip rather than double-run.
const oneMonitorQuery = db.query<MonitorRow, [number]>(`
  SELECT m.id, m.name, m.type, m.config_encrypted, m.timeout_ms,
         m.failure_threshold, m.success_threshold, m.muted_until
  FROM monitors m
  WHERE m.id = ? AND m.enabled = 1
`);

export async function runCheckNow(monitorId: number): Promise<void> {
  const row = oneMonitorQuery.get(monitorId);
  if (!row) return;
  if (inflight.has(row.id)) return;
  inflight.add(row.id);
  try {
    await runOne(row);
  } finally {
    inflight.delete(row.id);
  }
}
