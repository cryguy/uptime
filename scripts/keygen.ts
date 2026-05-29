// Usage: bun run keygen
// Prints fresh secrets for SESSION_SECRET and ENCRYPTION_KEY.
// Thin wrapper over the shared helper, which the compiled binary also exposes
// as `uptime keygen`.
import { runKeygen } from "../src/cli";

runKeygen();
