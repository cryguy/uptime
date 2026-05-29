// Entry point + command dispatcher.
//
// `uptime keygen` and `uptime hash <password>` run setup helpers and exit
// without touching config, the database, or the server — so they work on a
// fresh machine with no secrets configured yet. Anything else (including no
// args) boots the HTTP server.
//
// The server is imported *dynamically* on purpose: its module graph
// (./config, ./db, ./secrets, ...) validates env vars and opens the database
// at import time, and those side effects must not run for the setup commands.
import { runKeygen, runHash } from "./cli";

const args = process.argv.slice(2);

switch (args[0]) {
  case "keygen":
    runKeygen();
    break;
  case "hash":
    await runHash(args.slice(1));
    break;
  default:
    await import("./server");
}
