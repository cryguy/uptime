import Html from "@kitajs/html";
import { db } from "../db";
import { Layout } from "../views/layout";
import {
  IncidentBanner, SearchIcon, Spark, StatusDot, StatusPill, TypeChip, UptimeStrip,
  formatAgo, formatAgoCompact, formatDuration,
} from "../views/components";
import type { PageContext } from "../views/context";
import type { MonitorType } from "../checks/types";
import {
  getBannerIncident, getFleetKpis, getFleetP95LatencySparkline, getFleetUpPercentSparkline,
  getMonitor24hBuckets, getMonitorLatencySpark, getRecentAlerts, getRecentlyResolved,
  type IncidentRow, type RecentAlert,
} from "../queries";
import { htmlResponse, publicRoute } from "./wrap";

type DashboardRow = {
  id: number;
  name: string;
  type: MonitorType;
  enabled: number;
  interval_seconds: number;
  group_name: string | null;
  is_public: number;
  muted_until: number | null;
  current_status: "up" | "down" | null;
  since: number | null;
  last_checked_at: number | null;
  latest_latency: number | null;
};

// Down monitors first, enabled-up next, disabled last; alphabetic within tier.
// is_public filter: anonymous viewers (?2 = 0) see only is_public=1 monitors;
// admins (?2 = 1) see everything.
// Additional filters: status (?3), type (?4), group_name (?5). Empty string = no filter.
const dashboardRowsQuery = db.query<DashboardRow, [string, number, string, string, string]>(`
  SELECT m.id, m.name, m.type, m.enabled, m.interval_seconds,
         m.group_name, m.is_public, m.muted_until,
         s.current_status, s.since, s.last_checked_at,
         (SELECT latency_ms FROM check_results
          WHERE monitor_id = m.id ORDER BY checked_at DESC LIMIT 1) AS latest_latency
  FROM monitors m
  LEFT JOIN monitor_state s ON s.monitor_id = m.id
  WHERE (?1 = '' OR m.name LIKE '%' || ?1 || '%')
    AND (?2 = 1 OR m.is_public = 1)
    AND (?3 = '' OR
         (?3 = 'up' AND s.current_status = 'up' AND m.enabled = 1) OR
         (?3 = 'down' AND s.current_status = 'down') OR
         (?3 = 'disabled' AND m.enabled = 0))
    AND (?4 = '' OR m.type = ?4)
    AND (?5 = '' OR m.group_name = ?5)
  ORDER BY
    CASE WHEN s.current_status = 'down' THEN 0
         WHEN m.enabled = 0 THEN 2
         ELSE 1 END,
    m.name
`);

const oneRowQuery = db.query<DashboardRow, [number]>(`
  SELECT m.id, m.name, m.type, m.enabled, m.interval_seconds,
         m.group_name, m.is_public, m.muted_until,
         s.current_status, s.since, s.last_checked_at,
         (SELECT latency_ms FROM check_results
          WHERE monitor_id = m.id ORDER BY checked_at DESC LIMIT 1) AS latest_latency
  FROM monitors m
  LEFT JOIN monitor_state s ON s.monitor_id = m.id
  WHERE m.id = ?
`);

// Used by the filter dropdown so we can list groups that actually exist.
const distinctGroupsQuery = db.query<{ group_name: string }, []>(`
  SELECT DISTINCT group_name FROM monitors WHERE group_name IS NOT NULL ORDER BY group_name
`);

// === Dashboard row rendering ===
// One <a> per monitor; the row hx-swaps itself every 5s for live refresh.

function DashboardRowEl({ m, isAdmin }: { m: DashboardRow; isAdmin?: boolean }): JSX.Element {
  const enabled = m.enabled === 1;
  const isDown = m.current_status === "down";
  const isMuted = m.muted_until !== null && m.muted_until > Date.now();
  const cls = `dash-row${isAdmin ? " with-bulk" : ""}${isDown ? " is-down" : ""}${isMuted ? " is-muted" : ""}`;
  const latency = m.latest_latency;
  const spark =
    enabled && m.current_status !== null
      ? getMonitorLatencySpark(m.id, Date.now() - 60 * 60 * 1000, 14)
      : [];
  const buckets = enabled ? getMonitor24hBuckets(m.id) : (new Array(24).fill("empty") as ("up" | "down" | "empty")[]);
  const sparkColor = isDown
    ? "var(--down)"
    : !enabled
      ? "var(--dim)"
      : "var(--up)";
  return (
    <a
      class={cls}
      href={`/monitors/${m.id}`}
      id={`row-${m.id}`}
      hx-get={`/monitors/${m.id}/row`}
      hx-trigger="every 5s"
      hx-swap="outerHTML"
    >
      {isAdmin ? (
        <div class="dash-row-check" onclick="event.stopPropagation();event.preventDefault();">
          <input type="checkbox" class="dash-row-checkbox" value={String(m.id)} onclick="event.stopPropagation()" />
        </div>
      ) : ""}
      <div class="dash-row-name">
        <StatusDot status={m.current_status} enabled={enabled} />
        <span class="dash-name-text" safe>{m.name}</span>
      </div>
      <div><TypeChip type={m.type} /></div>
      <div><StatusPill status={m.current_status} enabled={enabled} /></div>
      <div>
        {latency != null && enabled && m.current_status === "up" ? (
          <>
            <span class="dash-latency-num">{String(latency)}</span>
            <span class="dash-latency-unit">ms</span>
          </>
        ) : (
          <span class="dash-cell-empty">—</span>
        )}
      </div>
      <div>
        <Spark
          data={spark}
          w={76}
          h={20}
          color={sparkColor}
          interactive
          unit="ms"
        />
      </div>
      <div>
        <UptimeStrip buckets={buckets} />
      </div>
      <div class="dash-cell-meta">{enabled ? formatAgoCompact(m.last_checked_at) : "—"}</div>
      <div class="dash-cell-meta">{m.since ? formatAgoCompact(m.since) : "—"}</div>
      <div class="dash-cell-action">›</div>
    </a>
  );
}

// === Right rail panels ===

function ActiveIncidentPanel({
  incident,
  isAdmin,
}: {
  incident: IncidentRow;
  isAdmin: boolean;
}): JSX.Element {
  return (
    <div class="panel">
      <div class="panel-head">
        <h3 class="panel-h3">Active incident</h3>
        <span class="panel-meta" style="color:var(--down)">1 open</span>
      </div>
      <div class="incident-card">
        <div class="incident-card-head">
          <StatusDot status="down" />
          <span class="incident-card-name" safe>{incident.monitor_name}</span>
          <span class="incident-card-time">{formatAgo(incident.started_at)}</span>
        </div>
        <div class="incident-card-detail">
          {isAdmin && incident.initial_detail ? (
            <span safe>{incident.initial_detail}</span>
          ) : (
            "Connection failed on consecutive checks."
          )}
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <a href={`/monitors/${incident.monitor_id}`} class="btn btn-ghost btn-mini">View checks</a>
          {isAdmin ? (
            <form method="post" action={`/incidents/${incident.id}/ack`} style="margin:0">
              <input type="hidden" name="next" value="/dashboard" />
              <button type="submit" class="btn btn-ghost btn-mini">Acknowledge</button>
            </form>
          ) : ""}
        </div>
      </div>
    </div>
  );
}

function AlertDeliveryPanel({
  alerts,
  isAdmin,
}: {
  alerts: RecentAlert[];
  isAdmin: boolean;
}): JSX.Element {
  if (alerts.length === 0) {
    return (
      <div class="panel">
        <div class="panel-head"><h3 class="panel-h3">Alert delivery</h3><span class="panel-meta">last 24h</span></div>
        <div class="incident-card muted" style="text-align:center;padding:18px">No alerts in the last 24h.</div>
      </div>
    );
  }
  return (
    <div class="panel">
      <div class="panel-head"><h3 class="panel-h3">Alert delivery</h3><span class="panel-meta">last 24h</span></div>
      {alerts.map((a) => {
        const statusClass = a.delivered_at
          ? a.last_error?.startsWith("dead-letter:") ? "fail" : "ok"
          : a.attempts > 0 ? "retry" : "ok";
        const statusText = a.delivered_at
          ? a.last_error?.startsWith("dead-letter:") ? "dead-letter" : "delivered"
          : a.attempts > 0 ? `retry · ${String(a.attempts)}` : "queued";
        const when = a.delivered_at ?? a.next_attempt_at;
        return (
          <div class="alert-row">
            <div class="alert-channel">
              <span class="alert-icon" safe>{a.webhook_name.slice(0, 1).toUpperCase()}</span>
              <span class="alert-channel-name" safe>{isAdmin ? a.webhook_name : `${a.webhook_name.split(" ")[0]}…`}</span>
            </div>
            <span class={`alert-status ${statusClass}`} safe>{statusText}</span>
            <span class="alert-time">{formatAgoCompact(when)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RecentlyResolvedPanel({ resolved }: { resolved: IncidentRow[] }): JSX.Element {
  if (resolved.length === 0) {
    return (
      <div class="panel">
        <div class="panel-head"><h3 class="panel-h3">Recently resolved</h3><span class="panel-meta">last 7d</span></div>
        <div class="incident-card muted" style="text-align:center;padding:18px">No resolved incidents this week.</div>
      </div>
    );
  }
  return (
    <div class="panel">
      <div class="panel-head"><h3 class="panel-h3">Recently resolved</h3><span class="panel-meta">last 7d</span></div>
      {resolved.map((i, idx) => {
        const duration = i.ended_at ? i.ended_at - i.started_at : 0;
        return (
          <div class="incident-card" style={idx > 0 ? "padding-top:10px" : ""}>
            <div class="incident-card-head">
              <StatusDot status="up" />
              <span class="incident-card-name" style="font-size:12.5px" safe>{i.monitor_name}</span>
              <span class="incident-card-time">{formatAgoCompact(i.ended_at)} · {formatDuration(duration)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// === KPI cards ===

function KpiStrip({ ctx }: { ctx: PageContext }): JSX.Element {
  const kpis = getFleetKpis();
  const upSpark = getFleetUpPercentSparkline();
  const p95Spark = getFleetP95LatencySparkline();
  return (
    <div class="dash-kpis">
      <div class="dash-kpi">
        <div class="dash-kpi-label">Monitors</div>
        <div class="dash-kpi-row"><span class="dash-kpi-value">{String(kpis.total)}</span></div>
        <div class="dash-kpi-meta">
          {kpis.up} up · {kpis.down} down{kpis.total - kpis.up - kpis.down > 0 ? ` · ${kpis.total - kpis.up - kpis.down} pending` : ""}
        </div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">Up</div>
        <div class="dash-kpi-row">
          <span class="dash-kpi-value">{String(kpis.up)}</span>
          {kpis.upPercent24h !== null ? (
            <span class="dash-kpi-pct">{kpis.upPercent24h.toFixed(1)}%</span>
          ) : ""}
        </div>
        <div class="dash-kpi-spark">
          <Spark data={upSpark} w={240} h={28} color="var(--up)" fill strokeWidth={1.4} interactive unit="%" />
        </div>
        <div class="dash-kpi-meta">last 14h · fleet-wide up%</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">Down</div>
        <div class="dash-kpi-row">
          <span class={`dash-kpi-value${kpis.down > 0 ? " down" : ""}`}>{String(kpis.down)}</span>
        </div>
        <div class="dash-kpi-meta" style="margin-top:auto">
          {kpis.mttr30dMs !== null ? `MTTR · 30d: ${formatDuration(kpis.mttr30dMs)}` : "MTTR · 30d: —"}
        </div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">p95 latency</div>
        <div class="dash-kpi-row">
          <span class="dash-kpi-value">
            {kpis.p95LatencyMs !== null ? String(kpis.p95LatencyMs) : "—"}
            {kpis.p95LatencyMs !== null ? <span class="dash-kpi-unit">ms</span> : ""}
          </span>
        </div>
        <div class="dash-kpi-spark">
          <Spark data={p95Spark} w={240} h={28} color="var(--accent)" fill strokeWidth={1.4} interactive unit="ms" />
        </div>
        <div class="dash-kpi-meta">last 14h · fleet-wide</div>
      </div>
    </div>
  );
}

// === Dashboard handler ===

type GroupBy = "" | "group" | "type" | "status";
const VALID_GROUPS = new Set<GroupBy>(["", "group", "type", "status"]);

function groupKey(m: DashboardRow, by: GroupBy): string {
  if (by === "group") return m.group_name ?? "Ungrouped";
  if (by === "type") return m.type.toUpperCase();
  if (by === "status") {
    if (m.enabled === 0) return "Disabled";
    if (m.current_status === "down") return "Down";
    if (m.current_status === "up") return "Up";
    return "Unknown";
  }
  return "";
}

function dashboardHandler(req: Bun.BunRequest<"/dashboard">, ctx: PageContext): Response | Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const fragment = url.searchParams.get("fragment");
  const groupParam = url.searchParams.get("group") ?? "";
  const groupBy: GroupBy = VALID_GROUPS.has(groupParam as GroupBy) ? (groupParam as GroupBy) : "";
  const statusFilter = (url.searchParams.get("status") ?? "").trim();
  const typeFilter = (url.searchParams.get("type") ?? "").trim();
  const groupFilter = (url.searchParams.get("filter_group") ?? "").trim();
  const filtersActive = Boolean(statusFilter || typeFilter || groupFilter);

  const rows = dashboardRowsQuery.all(q, ctx.isAdmin ? 1 : 0, statusFilter, typeFilter, groupFilter);

  // Stable sort by group key first, preserving the SQL order within each group.
  if (groupBy) {
    const indexed = rows.map((r, i) => ({ r, i, key: groupKey(r, groupBy) }));
    indexed.sort((a, b) => a.key.localeCompare(b.key) || (a.i - b.i));
    rows.length = 0;
    for (const x of indexed) rows.push(x.r);
  }

  function renderRows(): JSX.Element {
    if (rows.length === 0) {
      return (
        <div class="incident-card muted" style="text-align:center;padding:32px" safe>
          {q ? `No monitors match "${q}".` : filtersActive ? "No monitors match these filters." : "No monitors yet."}
        </div>
      );
    }
    if (!groupBy) {
      return <>{rows.map((m) => <DashboardRowEl m={m} isAdmin={ctx.isAdmin} />)}</>;
    }
    // Grouped rendering: insert header rows when group key changes.
    const chunks: JSX.Element[] = [];
    let lastKey = "";
    let groupCount = 0;
    let groupRows: JSX.Element[] = [];
    const flush = (key: string) => {
      if (groupRows.length === 0) return;
      chunks.push(
        <div class="dash-group-header">
          <b safe>{key}</b>
          <span class="dash-group-count">{String(groupCount)}</span>
        </div>,
      );
      for (const el of groupRows) chunks.push(el);
    };
    for (const m of rows) {
      const k = groupKey(m, groupBy);
      if (k !== lastKey) {
        if (lastKey) flush(lastKey);
        lastKey = k;
        groupCount = 0;
        groupRows = [];
      }
      groupCount++;
      groupRows.push(<DashboardRowEl m={m} isAdmin={ctx.isAdmin} />);
    }
    if (lastKey) flush(lastKey);
    return <>{chunks}</>;
  }

  // HTMX search swap target — just the table body
  if (fragment === "table") {
    return htmlResponse(<>{renderRows()}</>);
  }

  const kpis = getFleetKpis();
  const banner = getBannerIncident();
  const recentAlerts = getRecentAlerts(5);
  const recentlyResolved = getRecentlyResolved(Date.now() - 7 * 24 * 60 * 60 * 1000, 5);

  return htmlResponse(
    <Layout
      ctx={ctx}
      title="Monitors"
      banner={banner ? <IncidentBanner incident={{
        incidentId: banner.id,
        monitorId: banner.monitor_id,
        monitorName: banner.monitor_name,
        sinceMs: banner.started_at,
        detail: ctx.isAdmin ? (banner.initial_detail ?? "") : "",
      }} isAdmin={ctx.isAdmin} /> : ""}
    >
      <div class="page-head">
        <div>
          <h1 class="page-h1">Monitors</h1>
          <div class="page-meta">
            <span class={kpis.down > 0 ? "dot-down" : "dot-up"} />
            <span>{kpis.up} of {kpis.total} operational · auto-refresh every 5s</span>
          </div>
        </div>
        <div class="page-actions">
          {ctx.isAdmin ? (
            <a href="/monitors/new"><button type="button" class="btn btn-primary">+ New monitor</button></a>
          ) : ""}
        </div>
      </div>

      <KpiStrip ctx={ctx} />

      <div class="dash-toolbar">
        <div class="dash-search">
          <div class="dash-search-icon"><SearchIcon /></div>
          <input
            type="text"
            name="q"
            value={q}
            placeholder="Filter monitors by name…"
            hx-get="/dashboard?fragment=table"
            hx-trigger="keyup changed delay:250ms, search"
            hx-target="#dash-table-scroll"
            hx-swap="innerHTML"
            hx-include=".dash-toolbar input, .dash-toolbar select"
          />
        </div>
        <FilterDropdown statusFilter={statusFilter} typeFilter={typeFilter} groupFilter={groupFilter} />
        <GroupBySelect current={groupBy} pathname={ctx.pathname} />
        <DensitySegments ctx={ctx} />
      </div>

      <div class="dash-bulk-toolbar" id="dash-bulk-toolbar">
        <span><span class="count" id="dash-bulk-count">0</span> selected</span>
        {ctx.isAdmin ? (
          <>
            <form method="post" action="/monitors/bulk/pause" id="dash-bulk-form-pause"><input type="hidden" name="ids" id="dash-bulk-ids-pause" /><button type="submit" class="btn btn-ghost btn-mini">Pause</button></form>
            <form method="post" action="/monitors/bulk/resume" id="dash-bulk-form-resume"><input type="hidden" name="ids" id="dash-bulk-ids-resume" /><button type="submit" class="btn btn-ghost btn-mini">Resume</button></form>
            <form method="post" action="/monitors/bulk/mute" id="dash-bulk-form-mute"><input type="hidden" name="ids" id="dash-bulk-ids-mute" /><input type="hidden" name="duration_ms" value="3600000" /><button type="submit" class="btn btn-ghost btn-mini">Mute · 1h</button></form>
            <form method="post" action="/monitors/bulk/delete" id="dash-bulk-form-delete" onsubmit="return confirm('Delete the selected monitors?')"><input type="hidden" name="ids" id="dash-bulk-ids-delete" /><button type="submit" class="btn btn-danger btn-mini">Delete</button></form>
          </>
        ) : ""}
        <button type="button" class="btn btn-link btn-mini" id="dash-bulk-clear">Clear</button>
      </div>

      <div class="dash-content">
        <div class="dash-table" data-density={ctx.density}>
          <div class={`dash-thead${ctx.isAdmin ? " with-bulk" : ""}`}>
            {ctx.isAdmin ? <div><input type="checkbox" id="dash-row-check-all" aria-label="Select all" /></div> : ""}
            <div>Monitor</div><div>Type</div><div>Status</div>
            <div>Latency</div><div>Latency · 1h</div><div>Uptime · 24h</div>
            <div>Last</div><div>Stable</div><div></div>
          </div>
          <div class="dash-table-scroll" id="dash-table-scroll">
            {renderRows()}
          </div>
          <div class="dash-table-footer">
            <span>{rows.length} visible · {kpis.total} total</span>
            <span class="dash-table-footer-loading">
              <span class="dash-table-footer-dot" /> auto-refresh
            </span>
          </div>
        </div>

        <aside class="dash-rail">
          {banner ? <ActiveIncidentPanel incident={banner} isAdmin={ctx.isAdmin} /> : ""}
          <AlertDeliveryPanel alerts={recentAlerts} isAdmin={ctx.isAdmin} />
          <RecentlyResolvedPanel resolved={recentlyResolved} />
        </aside>
      </div>
    </Layout>,
  );
}

function DensitySegments({ ctx }: { ctx: PageContext }): JSX.Element {
  return (
    <form method="post" action="/preferences/density" class="segments">
      <input type="hidden" name="next" value={ctx.pathname} />
      <button type="submit" name="density" value="comfort" class={ctx.density === "comfort" ? "active" : ""}>Comfort</button>
      <button type="submit" name="density" value="compact" class={ctx.density === "compact" ? "active" : ""}>Compact</button>
      <button type="submit" name="density" value="dense" class={ctx.density === "dense" ? "active" : ""}>Dense</button>
    </form>
  );
}

function GroupBySelect({ current, pathname }: { current: GroupBy; pathname: string }): JSX.Element {
  return (
    <select
      class="segments"
      style="padding:5px 10px;font-size:12px"
      onchange={`window.location='${pathname}?' + new URLSearchParams({...Object.fromEntries(new URLSearchParams(window.location.search)), group: this.value === 'none' ? '' : this.value}).toString()`}
    >
      <option value="none" selected={current === ""}>Group by ⌄</option>
      <option value="group" selected={current === "group"}>Group: tag</option>
      <option value="type" selected={current === "type"}>Group: type</option>
      <option value="status" selected={current === "status"}>Group: status</option>
    </select>
  );
}

function FilterDropdown({
  statusFilter,
  typeFilter,
  groupFilter,
}: {
  statusFilter: string;
  typeFilter: string;
  groupFilter: string;
}): JSX.Element {
  const groups = distinctGroupsQuery.all().map((g) => g.group_name);
  const active = Boolean(statusFilter || typeFilter || groupFilter);
  return (
    <div class="filter-dropdown" id="filter-dropdown">
      <button type="button" class={`filter-dropdown-trigger${active ? " active" : ""}`} id="filter-dropdown-trigger">
        Filter{active ? ` · ${[statusFilter, typeFilter, groupFilter].filter(Boolean).length}` : ""} ⌄
      </button>
      <form method="get" action="/dashboard" class="filter-dropdown-menu">
        <div class="filter-section">
          <div class="filter-section-h">Status</div>
          {["up", "down", "disabled"].map((s) => (
            <label class="inline"><input type="radio" name="status" value={s} checked={statusFilter === s} /> {s}</label>
          ))}
          <label class="inline"><input type="radio" name="status" value="" checked={!statusFilter} /> any</label>
        </div>
        <div class="filter-section">
          <div class="filter-section-h">Type</div>
          {["http", "tcp", "ssh"].map((t) => (
            <label class="inline"><input type="radio" name="type" value={t} checked={typeFilter === t} /> {t.toUpperCase()}</label>
          ))}
          <label class="inline"><input type="radio" name="type" value="" checked={!typeFilter} /> any</label>
        </div>
        {groups.length > 0 ? (
          <div class="filter-section">
            <div class="filter-section-h">Group</div>
            {groups.map((g) => (
              <label class="inline"><input type="radio" name="filter_group" value={g} checked={groupFilter === g} /> <span safe>{g}</span></label>
            ))}
            <label class="inline"><input type="radio" name="filter_group" value="" checked={!groupFilter} /> any</label>
          </div>
        ) : ""}
        <div class="filter-actions">
          <button type="submit" class="btn btn-primary">Apply</button>
          <a href="/dashboard" class="btn btn-ghost">Clear</a>
        </div>
      </form>
    </div>
  );
}

// === Status badge partial (kept for back-compat; row endpoint preferred) ===

function badgeHandler(
  req: Bun.BunRequest<"/monitors/:id/badge">,
): Response | Promise<Response> {
  const id = Number(req.params.id);
  const row = db
    .query<{ enabled: number; current_status: "up" | "down" | null }, [number]>(
      "SELECT m.enabled, s.current_status FROM monitors m LEFT JOIN monitor_state s ON s.monitor_id = m.id WHERE m.id = ?",
    )
    .get(id);
  if (!row) return new Response("not found", { status: 404 });
  return htmlResponse(
    <span
      id={`badge-${id}`}
      hx-get={`/monitors/${id}/badge`}
      hx-trigger="every 5s"
      hx-swap="outerHTML"
    >
      <StatusPill status={row.current_status} enabled={row.enabled === 1} />
    </span>,
  );
}

// === Per-row refresh endpoint ===

function rowHandler(
  req: Bun.BunRequest<"/monitors/:id/row">,
  ctx: PageContext,
): Response | Promise<Response> {
  const id = Number(req.params.id);
  const row = oneRowQuery.get(id);
  if (!row) return new Response("not found", { status: 404 });
  return htmlResponse(<DashboardRowEl m={row} isAdmin={ctx.isAdmin} />);
}

export const dashboardRoutes = {
  dashboard: { GET: publicRoute(dashboardHandler) },
  badge: { GET: publicRoute(badgeHandler) },
  row: { GET: publicRoute(rowHandler) },
};
