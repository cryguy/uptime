import { connect } from "node:net";
import type { CheckOutcome, TcpConfig } from "./types";

export function checkTcp(cfg: TcpConfig, timeoutMs: number): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;
    const finish = (outcome: CheckOutcome) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(outcome);
    };
    const socket = connect({ host: cfg.host, port: cfg.port });
    const timer = setTimeout(() => {
      finish({
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        detail: `timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      finish({
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        detail: `connected ${cfg.host}:${cfg.port}`,
      });
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        detail: err.message,
      });
    });
  });
}
