// API token authentication.
//
// Tokens are 32 random bytes encoded as hex with an `up_` prefix:
//   up_<64-hex-chars>
// We store only the SHA-256 hash of the full token; the raw token is shown to
// the user exactly once when minted, then it's never recoverable. SHA-256 is
// sufficient because the token already carries 256 bits of entropy — slow
// KDFs like argon2 are for low-entropy passwords, not API keys.

import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

const TOKEN_PREFIX = "up_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type TokenRecord = {
  id: number;
  label: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

const insertTokenQuery = db.query<{ id: number }, [string, string, string, number]>(
  "INSERT INTO api_tokens (label, prefix, hash, created_at) VALUES (?, ?, ?, ?) RETURNING id"
);
const verifyTokenQuery = db.query<{ id: number }, [string]>(
  "SELECT id FROM api_tokens WHERE hash = ? AND revoked_at IS NULL"
);
const touchTokenQuery = db.query(
  "UPDATE api_tokens SET last_used_at = ? WHERE id = ?"
);
const listTokensQuery = db.query<TokenRecord, []>(`
  SELECT id, label, prefix, created_at, last_used_at, revoked_at
  FROM api_tokens
  ORDER BY revoked_at IS NOT NULL, created_at DESC
`);
const revokeTokenQuery = db.query(
  "UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"
);
const deleteTokenQuery = db.query("DELETE FROM api_tokens WHERE id = ?");

export function mintToken(label: string): { id: number; token: string; prefix: string } {
  const raw = randomBytes(32).toString("hex");
  const token = `${TOKEN_PREFIX}${raw}`;
  const prefix = token.slice(0, 11); // up_ + 8 hex chars
  const tokenHash = hashToken(token);
  const inserted = insertTokenQuery.get(label.trim() || "unnamed", prefix, tokenHash, Date.now());
  return { id: inserted!.id, token, prefix };
}

// Returns the token id if the token is valid and not revoked; null otherwise.
// Updates last_used_at on success as a side effect.
export function verifyToken(authHeader: string | null): number | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = verifyTokenQuery.get(hashToken(token));
  if (!row) return null;
  touchTokenQuery.run(Date.now(), row.id);
  return row.id;
}

export function listTokens(): TokenRecord[] {
  return listTokensQuery.all();
}

export function revokeToken(id: number): void {
  revokeTokenQuery.run(Date.now(), id);
}

export function deleteToken(id: number): void {
  deleteTokenQuery.run(id);
}
