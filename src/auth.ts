import { randomBytes } from "node:crypto";
import { config } from "./config";
import { db } from "./db";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "uptime_session";

const insertSession = db.query(
  "INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)"
);
const deleteSession = db.query("DELETE FROM sessions WHERE id = ?");
const findSession = db.query<{ id: string; expires_at: number }, [string]>(
  "SELECT id, expires_at FROM sessions WHERE id = ?"
);

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  // Always run the verify even on wrong username so the auth path has
  // a constant timing profile — otherwise an attacker can enumerate
  // valid usernames by measuring response latency.
  // config.adminPasswordHash and config.adminUsername are getters that read
  // the current (possibly DB-rotated) values rather than the boot-time env.
  const hashOk = await Bun.password.verify(password, config.adminPasswordHash).catch(() => false);
  return username === config.adminUsername && hashOk;
}

export function createSession(): { id: string; setCookie: string } {
  const id = randomBytes(32).toString("base64url");
  const now = Date.now();
  insertSession.run(id, now, now + SESSION_TTL_MS);
  const secureFlag = config.isProd ? "; Secure" : "";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return {
    id,
    setCookie: `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`,
  };
}

export function destroySession(id: string): string {
  deleteSession.run(id);
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSession(cookieHeader: string | null): { id: string } | null {
  if (!cookieHeader) return null;
  const id = parseCookie(cookieHeader, SESSION_COOKIE);
  if (!id) return null;
  const row = findSession.get(id);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession.run(id);
    return null;
  }
  return { id: row.id };
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function purgeExpiredSessions(): void {
  db.run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);
}

// Simple in-memory rate limit for the login endpoint.
// 5 attempts / minute / IP. State resets on process restart, which is
// acceptable since the admin should not be locked out forever.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRate(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 5;
}
