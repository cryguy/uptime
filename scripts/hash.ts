// Usage: bun run hash <password>
// Outputs a ready-to-paste .env line for ADMIN_PASSWORD_HASH.
// Bun's dotenv expands '$VAR' references *even inside single quotes*, so
// every '$' in the argon2 hash must be backslash-escaped.

const password = process.argv[2];
if (!password) {
  console.error("Usage: bun run hash <password>");
  process.exit(1);
}

const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
console.log(`ADMIN_PASSWORD_HASH=${hash.replaceAll("$", "\\$")}`);
