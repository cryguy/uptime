import { Client } from "ssh2";
import type { CheckOutcome, SshConfig } from "./types";

export function checkSsh(cfg: SshConfig, timeoutMs: number): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    const start = performance.now();
    const client = new Client();
    let settled = false;
    const finish = (outcome: CheckOutcome) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch {}
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        detail: `timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    client.on("ready", () => {
      if (!cfg.command) {
        clearTimeout(timer);
        finish({
          ok: true,
          latencyMs: Math.round(performance.now() - start),
          detail: `authenticated ${cfg.username}@${cfg.host}`,
        });
        return;
      }
      client.exec(cfg.command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          finish({
            ok: false,
            latencyMs: Math.round(performance.now() - start),
            detail: `exec error: ${err.message}`,
          });
          return;
        }
        // We must consume both streams or ssh2 hangs waiting on backpressure.
        stream.on("data", () => {});
        stream.stderr.on("data", () => {});
        stream.on("close", (code: number) => {
          clearTimeout(timer);
          const expected = cfg.expectExitCode ?? 0;
          const latencyMs = Math.round(performance.now() - start);
          if (code === expected) {
            finish({ ok: true, latencyMs, detail: `command exit ${code}` });
          } else {
            finish({ ok: false, latencyMs, detail: `command exit ${code} (expected ${expected})` });
          }
        });
      });
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        detail: err.message,
      });
    });

    try {
      client.connect({
        host: cfg.host,
        port: cfg.port ?? 22,
        username: cfg.username,
        privateKey: cfg.privateKey,
        passphrase: cfg.passphrase,
        readyTimeout: timeoutMs,
      });
    } catch (err) {
      clearTimeout(timer);
      finish({
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
