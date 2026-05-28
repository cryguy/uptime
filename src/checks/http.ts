import type { CheckOutcome, HttpConfig } from "./types";

export async function checkHttp(cfg: HttpConfig, timeoutMs: number): Promise<CheckOutcome> {
  const headers: Record<string, string> = { ...(cfg.headers ?? {}) };
  if (cfg.auth?.type === "basic") {
    const enc = Buffer.from(`${cfg.auth.username}:${cfg.auth.password}`).toString("base64");
    headers["Authorization"] = `Basic ${enc}`;
  } else if (cfg.auth?.type === "bearer") {
    headers["Authorization"] = `Bearer ${cfg.auth.token}`;
  }

  const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
    method: cfg.method ?? "GET",
    headers,
    body: cfg.body,
    redirect: cfg.followRedirects === false ? "manual" : "follow",
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (cfg.ignoreTlsErrors) init.tls = { rejectUnauthorized: false };

  const start = performance.now();
  try {
    const res = await fetch(cfg.url, init);
    const latencyMs = Math.round(performance.now() - start);

    const expected = cfg.expectedStatus;
    const statusOk =
      expected === undefined
        ? res.status >= 200 && res.status < 300
        : Array.isArray(expected)
          ? expected.includes(res.status)
          : res.status === expected;

    if (!statusOk) {
      // Drain the body so the socket can be reused / released.
      await res.body?.cancel();
      return { ok: false, latencyMs, detail: `status ${res.status} (expected ${formatExpected(expected)})` };
    }

    if (cfg.expectedBodyContains) {
      const body = await res.text();
      if (!body.includes(cfg.expectedBodyContains)) {
        return { ok: false, latencyMs, detail: `body did not contain expected substring` };
      }
    } else {
      await res.body?.cancel();
    }

    return { ok: true, latencyMs, detail: `status ${res.status}` };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const e = err as { name?: string; message?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, latencyMs, detail: `timeout after ${timeoutMs}ms` };
    }
    return { ok: false, latencyMs, detail: e?.message ?? String(err) };
  }
}

function formatExpected(expected: number | number[] | undefined): string {
  if (expected === undefined) return "2xx";
  if (Array.isArray(expected)) return expected.join("/");
  return String(expected);
}
