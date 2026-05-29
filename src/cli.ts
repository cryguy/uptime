// Setup helpers exposed as binary subcommands (`uptime keygen`, `uptime hash
// <password>`) and reused by the `bun run keygen` / `bun run hash` dev scripts.
//
// IMPORTANT: this module must NOT import ./config, ./db, or anything that reads
// or validates environment variables. The whole point of these commands is to
// run on a fresh machine that has no secrets configured yet — importing config
// would process.exit(1) on the missing env vars before we could generate them.
import { randomBytes } from "node:crypto";

/** Prints fresh SESSION_SECRET + ENCRYPTION_KEY lines, ready to paste into .env. */
export function runKeygen(): void {
  console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
  console.log(`ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
}

/**
 * Prints a ready-to-paste ADMIN_PASSWORD_HASH line for the given password.
 * Bun's dotenv expands '$VAR' even inside single quotes, so every '$' in the
 * argon2id hash is backslash-escaped.
 */
export async function runHash(args: string[]): Promise<void> {
  const password = args[0];
  if (!password) {
    console.error("Usage: uptime hash <password>");
    process.exit(1);
  }
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  console.log(`ADMIN_PASSWORD_HASH=${hash.replaceAll("$", "\\$")}`);
}
