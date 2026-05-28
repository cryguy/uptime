import Html from "@kitajs/html";

export type MonitorStatus = "up" | "down" | "disabled" | "unknown" | null | undefined;

// ===== SVG icons =====

export function BrandMark({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg class="brand-mark" width={String(size)} height={String(size)} viewBox="0 0 22 22">
      <rect width="22" height="22" rx="6" fill="var(--accent)" />
      <path
        d="M6.5 11.5 L9.5 14.5 L15.5 7.5"
        stroke="white"
        stroke-width="1.8"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function MoonIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M11 8.2 A5 5 0 1 1 4.8 2 A4 4 0 0 0 11 8.2 Z" fill="currentColor" />
    </svg>
  );
}

export function SunIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.3" />
      <path
        d="M6.5 1 L6.5 2.5 M6.5 10.5 L6.5 12 M1 6.5 L2.5 6.5 M10.5 6.5 L12 6.5 M2.7 2.7 L3.7 3.7 M9.3 9.3 L10.3 10.3 M2.7 10.3 L3.7 9.3 M9.3 3.7 L10.3 2.7"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function SearchIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={String(size)} height={String(size)} viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.4" />
      <path d="M9.5 9.5 L12 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

// ===== Status primitives =====

export function StatusPill({
  status,
  enabled,
}: {
  status: MonitorStatus;
  enabled?: boolean;
}): JSX.Element {
  if (enabled === false) return <span class="pill pill-disabled">disabled</span>;
  if (status === "up") return <span class="pill pill-up">up</span>;
  if (status === "down") return <span class="pill pill-down">down</span>;
  return <span class="pill pill-unknown">unknown</span>;
}

export function StatusDot({
  status,
  enabled,
}: {
  status: MonitorStatus;
  enabled?: boolean;
}): JSX.Element {
  if (enabled === false) return <span class="status-dot disabled" />;
  if (status === "up") return <span class="status-dot up" />;
  if (status === "down") return <span class="status-dot down" />;
  return <span class="status-dot unknown" />;
}

export function TypeChip({ type }: { type: string }): JSX.Element {
  return <span class="type-chip" safe>{type.toUpperCase()}</span>;
}

// ===== Uptime strip (24 hourly buckets) =====

export type UptimeBucket = "up" | "down" | "disabled" | "empty";

export function UptimeStrip({ buckets }: { buckets: UptimeBucket[] }): JSX.Element {
  return (
    <div class="dash-uptime-strip">
      {buckets.map((b) => (
        <span class={`dash-uptime-bar ${b}`} />
      ))}
    </div>
  );
}

// ===== Sparkline =====
// Renders an SVG line/area path server-side. The hover crosshair + tooltip
// is added by /static/spark.js if data-interactive is set.

function makeSparkPath(data: number[], w: number, h: number, pad = 2): { line: string; area: string } {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (data.length - 1);
  const pts: Array<[number, number]> = data.map((v, i) => [
    pad + i * stepX,
    pad + (h - pad * 2) * (1 - (v - min) / range),
  ]);
  const line = "M" + pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" L");
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const area = line + ` L${last[0].toFixed(2)},${h - pad} L${first[0].toFixed(2)},${h - pad} Z`;
  return { line, area };
}

export function Spark({
  data,
  w = 76,
  h = 20,
  color = "currentColor",
  fill = false,
  strokeWidth = 1.5,
  interactive = false,
  unit = "ms",
}: {
  data: number[] | null | undefined;
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
  interactive?: boolean;
  unit?: string;
}): JSX.Element {
  // A 1-point series can't form a meaningful line, and rendering one as a
  // flat horizontal placeholder looks broken — keep the slot empty until at
  // least 2 samples exist.
  if (!data || data.length < 2) {
    return <span class="dash-cell-empty">—</span>;
  }
  const { line, area } = makeSparkPath(data, w, h);
  const attrs: Record<string, string> = {
    class: "spark",
    "data-spark": data.join(","),
    "data-spark-w": String(w),
    "data-spark-unit": unit,
  };
  if (interactive) attrs["data-interactive"] = "1";
  return (
    <span {...attrs}>
      <svg width={String(w)} height={String(h)} viewBox={`0 0 ${w} ${h}`}>
        {fill ? <path d={area} fill={color} opacity="0.16" /> : ""}
        <path
          d={line}
          fill="none"
          stroke={color}
          stroke-width={String(strokeWidth)}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  );
}

// ===== Incident banner =====

export type ActiveIncidentForBanner = {
  incidentId: number | null;
  monitorId: number;
  monitorName: string;
  sinceMs: number;
  detail: string;
};

export function IncidentBanner({
  incident,
  isAdmin,
}: {
  incident: ActiveIncidentForBanner;
  isAdmin: boolean;
}): JSX.Element {
  return (
    <div class="incident-banner">
      <span class="banner-dot" />
      <span class="banner-tag">Active incident</span>
      <span class="banner-text">
        <b safe>{incident.monitorName}</b> is unreachable
        {isAdmin && incident.detail ? (
          <>
            {" — "}
            <code safe>{incident.detail}</code>
          </>
        ) : (
          ""
        )}
        <span class="meta">started {formatAgo(incident.sinceMs)}</span>
      </span>
      <div class="banner-actions">
        {isAdmin && incident.incidentId !== null ? (
          <form method="post" action={`/incidents/${incident.incidentId}/ack`} class="banner-form">
            <input type="hidden" name="next" value={`/dashboard`} />
            <button type="submit" class="banner-btn primary">Acknowledge</button>
          </form>
        ) : (
          ""
        )}
        <a href={`/monitors/${incident.monitorId}`} class="banner-btn">View checks</a>
        {isAdmin ? (
          <form method="post" action={`/monitors/${incident.monitorId}/mute`} class="banner-form">
            <input type="hidden" name="duration" value="1h" />
            <input type="hidden" name="next" value="/dashboard" />
            <button type="submit" class="banner-btn">Mute · 1h</button>
          </form>
        ) : ""}
      </div>
    </div>
  );
}

// ===== Time formatting =====

export function formatAgo(ms: number | null | undefined): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// Same as formatAgo but without the "ago" suffix — for table cells where
// space is tight and the column header ("Last", "Stable") supplies context.
export function formatAgoCompact(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 1000) return "0s";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// ===== Initials helper for avatar =====

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
