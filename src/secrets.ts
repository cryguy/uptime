// DB-backed mutable secrets — credentials and encryption key.
//
// On first boot, env-loaded values are seeded into the settings table. After
// that, the settings rows are canonical and env is ignored. This means a user
// who changes their password via the UI doesn't have to also update the env
// file; the new hash persists in the DB.
//
// Encryption key rotation re-encrypts every monitor's config blob in a
// transaction, then swaps the active key.

import { randomBytes } from "node:crypto";
import {
  config,
  decryptJSONWithKey,
  encryptJSONWithKey,
  _setAdminPasswordHash,
  _setAdminUsername,
  _setEncryptionKey,
} from "./config";
import { db } from "./db";

const settingsGet = db.query<{ value: string }, [string]>(
  "SELECT value FROM settings WHERE key = ?"
);
const settingsSet = db.query(
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
);

function loadOrSeed(key: string, fallback: string): string {
  const row = settingsGet.get(key);
  if (row) return row.value;
  settingsSet.run(key, fallback, Date.now());
  return fallback;
}

// Seed + load on import. Order matters: do this after db.ts has created
// the settings table.
{
  _setAdminUsername(loadOrSeed("admin_username", config.adminUsername));
  _setAdminPasswordHash(loadOrSeed("admin_password_hash", config.adminPasswordHash));
  const keyHex = loadOrSeed("encryption_key_hex", config.encryptionKey.toString("hex"));
  _setEncryptionKey(Buffer.from(keyHex, "hex"));
}

export async function changeCredentials(
  currentPassword: string,
  newUsername: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Verify current password using the stored hash.
  const ok = await Bun.password.verify(currentPassword, config.adminPasswordHash).catch(() => false);
  if (!ok) return { ok: false, error: "Current password is incorrect." };
  if (!newUsername || newUsername.length < 1) return { ok: false, error: "New username cannot be empty." };
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "New password must be at least 8 characters." };
  const newHash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
  const now = Date.now();
  settingsSet.run("admin_username", newUsername, now);
  settingsSet.run("admin_password_hash", newHash, now);
  _setAdminUsername(newUsername);
  _setAdminPasswordHash(newHash);
  return { ok: true };
}

export type KeyRotationResult =
  | { ok: true; rotated: number }
  | { ok: false; error: string };

// Transactionally re-encrypts every monitor's config_encrypted blob with a
// newly-generated key, then commits the new key to settings. If any single
// decryption fails (e.g., a row stored under a different key), the whole
// transaction rolls back and the active key remains unchanged.
export function rotateEncryptionKey(): KeyRotationResult {
  const oldKey = config.encryptionKey;
  const newKey = randomBytes(32);
  const rows = db
    .query<{ id: number; config_encrypted: Uint8Array }, []>(
      "SELECT id, config_encrypted FROM monitors"
    )
    .all();

  const updateBlob = db.query(
    "UPDATE monitors SET config_encrypted = ? WHERE id = ?"
  );
  const setKey = settingsSet;

  let rotated = 0;
  try {
    const tx = db.transaction(() => {
      for (const row of rows) {
        const plain = decryptJSONWithKey<unknown>(row.config_encrypted, oldKey);
        const newBlob = encryptJSONWithKey(plain, newKey);
        updateBlob.run(newBlob, row.id);
        rotated++;
      }
      setKey.run("encryption_key_hex", newKey.toString("hex"), Date.now());
    });
    tx();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  _setEncryptionKey(newKey);
  return { ok: true, rotated };
}

// Retention settings — stored as integer days, 0 = keep forever.
const DEFAULT_RETENTION = {
  retention_days_check_results: "0",
  retention_days_alert_queue: "0",
  retention_days_incidents: "0",
};
for (const [k, v] of Object.entries(DEFAULT_RETENTION)) loadOrSeed(k, v);

export function getRetentionDays(scope: "check_results" | "alert_queue" | "incidents"): number {
  const row = settingsGet.get(`retention_days_${scope}`);
  return Math.max(0, Number(row?.value ?? 0));
}

export function setRetentionDays(scope: "check_results" | "alert_queue" | "incidents", days: number): void {
  settingsSet.run(`retention_days_${scope}`, String(Math.max(0, Math.floor(days))), Date.now());
}

// Apply retention purge. Returns the count of rows deleted across scopes.
export function applyRetention(): { check_results: number; alert_queue: number; incidents: number } {
  const out = { check_results: 0, alert_queue: 0, incidents: 0 };
  const cr = getRetentionDays("check_results");
  if (cr > 0) {
    const cutoff = Date.now() - cr * 24 * 60 * 60 * 1000;
    const r = db.run("DELETE FROM check_results WHERE checked_at < ?", [cutoff]);
    out.check_results = Number(r.changes ?? 0);
  }
  const aq = getRetentionDays("alert_queue");
  if (aq > 0) {
    const cutoff = Date.now() - aq * 24 * 60 * 60 * 1000;
    const r = db.run(
      "DELETE FROM alert_queue WHERE delivered_at IS NOT NULL AND delivered_at < ?",
      [cutoff]
    );
    out.alert_queue = Number(r.changes ?? 0);
  }
  const inc = getRetentionDays("incidents");
  if (inc > 0) {
    const cutoff = Date.now() - inc * 24 * 60 * 60 * 1000;
    const r = db.run("DELETE FROM incidents WHERE ended_at IS NOT NULL AND ended_at < ?", [cutoff]);
    out.incidents = Number(r.changes ?? 0);
  }
  return out;
}
