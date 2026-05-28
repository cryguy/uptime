// Usage: bun run keygen
// Prints fresh secrets for SESSION_SECRET and ENCRYPTION_KEY.

import { randomBytes } from "node:crypto";

console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
