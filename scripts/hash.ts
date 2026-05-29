// Usage: bun run hash <password>
// Outputs a ready-to-paste .env line for ADMIN_PASSWORD_HASH.
// Thin wrapper over the shared helper, which the compiled binary also exposes
// as `uptime hash <password>`.
import { runHash } from "../src/cli";

await runHash(process.argv.slice(2));
