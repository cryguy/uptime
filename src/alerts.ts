import { db } from "./db";

// Delays *before* each retry attempt. Index N is the wait before attempt N+1.
// Total attempts = BACKOFF_MS.length + 1 (initial + retries).
const BACKOFF_MS = [5_000, 30_000, 5 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const DELIVERY_TIMEOUT_MS = 10_000;

const dueAlerts = db.query<
  { id: number; webhook_id: number; payload: string; attempts: number; url: string },
  [number]
>(`
  SELECT a.id, a.webhook_id, a.payload, a.attempts, w.url
  FROM alert_queue a
  JOIN webhooks w ON w.id = a.webhook_id
  WHERE a.delivered_at IS NULL
    AND w.enabled = 1
    AND a.next_attempt_at <= ?
  LIMIT 50
`);

const markDelivered = db.query(
  "UPDATE alert_queue SET delivered_at = ? WHERE id = ?"
);
const markRetry = db.query(
  "UPDATE alert_queue SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?"
);
const markDead = db.query(
  "UPDATE alert_queue SET delivered_at = ?, last_error = ? WHERE id = ?"
);

async function deliverTick(): Promise<void> {
  const items = dueAlerts.all(Date.now());
  if (items.length === 0) return;
  await Promise.all(items.map(deliverOne));
}

async function deliverOne(
  item: { id: number; payload: string; attempts: number; url: string },
): Promise<void> {
  try {
    const res = await fetch(item.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: item.payload,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.ok) {
      await res.body?.cancel();
      markDelivered.run(Date.now(), item.id);
      return;
    }
    await res.body?.cancel();
    scheduleRetry(item, `status ${res.status}`);
  } catch (err) {
    scheduleRetry(item, err instanceof Error ? err.message : String(err));
  }
}

function scheduleRetry(item: { id: number; attempts: number }, reason: string): void {
  const next = item.attempts + 1;
  if (next >= MAX_ATTEMPTS) {
    markDead.run(Date.now(), `dead-letter: ${reason}`, item.id);
    return;
  }
  const delay = BACKOFF_MS[Math.min(next - 1, BACKOFF_MS.length - 1)]!;
  markRetry.run(next, Date.now() + delay, reason, item.id);
}

export function startAlertLoop(): void {
  setInterval(() => { void deliverTick(); }, 5000);
}
