import { createCipheriv, createDecipheriv } from "node:crypto";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}

function hex32(name: string): Buffer {
  const buf = Buffer.from(required(name), "hex");
  if (buf.length !== 32) {
    console.error(`${name} must be 32 bytes (64 hex chars). Run: bun run keygen`);
    process.exit(1);
  }
  return buf;
}

// Bootstrap values from env. These are seeded into the settings table on
// first boot via secrets.ts; from then on, settings is the source of truth
// and these env-loaded values become inert defaults.
let _adminUsername: string = required("ADMIN_USERNAME");
let _adminPasswordHash: string = required("ADMIN_PASSWORD_HASH");
let _encryptionKey: Buffer = hex32("ENCRYPTION_KEY");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  get adminUsername() { return _adminUsername; },
  get adminPasswordHash() { return _adminPasswordHash; },
  sessionSecret: hex32("SESSION_SECRET"),
  get encryptionKey() { return _encryptionKey; },
  dbPath: process.env.DB_PATH ?? "./data/uptime.db",
  isProd: process.env.NODE_ENV === "production",
  // If > 0, open incidents older than this many minutes are auto-acknowledged.
  // 0 (default) disables auto-ack — every incident requires an explicit click.
  autoAckMinutes: Math.max(0, Number(process.env.INCIDENT_AUTO_ACK_MINUTES ?? 0)),
};

// Mutators used by secrets.ts after loading from DB.
export function _setAdminUsername(u: string): void { _adminUsername = u; }
export function _setAdminPasswordHash(h: string): void { _adminPasswordHash = h; }
export function _setEncryptionKey(k: Buffer): void { _encryptionKey = k; }

// AES-256-GCM. Layout on disk: [12-byte IV][16-byte tag][ciphertext].
// Authenticated encryption — tampering invalidates decryption (we'd rather
// fail loudly than silently serve a corrupted config to the check loop).
export function encryptJSONWithKey(value: unknown, key: Buffer): Buffer {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(iv), tag, ct]);
}

export function decryptJSONWithKey<T>(blob: Buffer | Uint8Array, key: Buffer): T {
  const b = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const ct = b.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}

// Wrappers that use the current in-process encryption key (which may have
// been rotated via the settings UI — secrets.ts updates the internal value).
export function encryptJSON(value: unknown): Buffer {
  return encryptJSONWithKey(value, config.encryptionKey);
}
export function decryptJSON<T>(blob: Buffer | Uint8Array): T {
  return decryptJSONWithKey<T>(blob, config.encryptionKey);
}
