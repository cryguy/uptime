import { checkHttp } from "./http";
import { checkSsh } from "./ssh";
import { checkTcp } from "./tcp";
import type { CheckOutcome, MonitorConfig } from "./types";

export function runCheck(m: MonitorConfig, timeoutMs: number): Promise<CheckOutcome> {
  switch (m.type) {
    case "http": return checkHttp(m.config, timeoutMs);
    case "tcp":  return checkTcp(m.config, timeoutMs);
    case "ssh":  return checkSsh(m.config, timeoutMs);
  }
}

export type { MonitorConfig, MonitorType, HttpConfig, TcpConfig, SshConfig, CheckOutcome } from "./types";
