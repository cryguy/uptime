import Html from "@kitajs/html";
import { Layout } from "../views/layout";
import {
  IncidentBanner, StatusDot, StatusPill,
  formatAgo, formatAgoCompact, formatDuration,
} from "../views/components";
import type { PageContext } from "../views/context";
import {
  ackIncident, getActiveIncidents, getAllIncidents, getBannerIncident,
  getIncident, getIncidentAlerts, getIncidentChecks, getIncidentFailures,
  getRecentlyResolved, setIncidentNotes, type IncidentRow,
} from "../queries";
import { renderMarkdown } from "../markdown";
import { adminRoute, htmlResponse, publicRoute, safeNext } from "./wrap";

type Tab = "open" | "resolved" | "all";
const TABS = new Set<Tab>(["open", "resolved", "all"]);

function IncidentItem({
  incident,
  isAdmin,
  tab,
}: {
  incident: IncidentRow;
  isAdmin: boolean;
  tab: Tab;
}): JSX.Element {
  return _renderIncidentItem({ incident, isAdmin, tab, withLink: true });
}

function _renderIncidentItem({
  incident,
  isAdmin,
  tab,
  withLink,
}: {
  incident: IncidentRow;
  isAdmin: boolean;
  tab: Tab;
  withLink: boolean;
}): JSX.Element {
  const isOpen = incident.ended_at === null;
  const isAcked = incident.acked_at !== null;
  const failures = getIncidentFailures(incident);
  const alerts = getIncidentAlerts(incident);
  const duration = incident.ended_at
    ? incident.ended_at - incident.started_at
    : Date.now() - incident.started_at;

  const nameNode = (
    <>
      <StatusDot status={isOpen ? "down" : "up"} />
      <span safe>{incident.monitor_name}</span>
      {isOpen
        ? <StatusPill status="down" />
        : <span class="pill pill-up" style="font-size:11px">resolved</span>}
      {isAcked && isOpen ? <span class="pill pill-disabled" style="font-size:11px">acked</span> : ""}
    </>
  );
  return (
    <div class="inc-item">
      <div class="inc-item-head">
        <div class="inc-item-name">
          {withLink ? <a href={`/incidents/${incident.id}`} style="display:inline-flex;align-items:center;gap:9px;color:inherit">{nameNode}</a> : nameNode}
        </div>
        <div class="inc-item-since">
          {isOpen
            ? <>since {formatAgo(incident.started_at)} · {formatAgoCompact(incident.started_at)}</>
            : <>{formatAgo(incident.ended_at)} · {formatDuration(duration)}</>}
        </div>
      </div>
      <div class="inc-item-detail">
        {isAdmin && incident.initial_detail ? (
          <>
            Initial failure: <code safe>{incident.initial_detail}</code>
          </>
        ) : (
          isOpen ? "Consecutive failed checks exceeded the configured threshold." : "Resolved on successful check."
        )}
      </div>
      <div class="inc-item-meta">
        <span>Duration: <b safe>{formatDuration(duration)}</b></span>
        <span>Failed checks: <b>{String(failures)}</b></span>
        <span>Alerts sent: <b>{String(alerts)}</b></span>
        {isAcked ? <span>Acked at <b safe>{new Date(incident.acked_at!).toISOString().slice(11, 19)}</b></span> : ""}
        {!isOpen ? <span>Auto-resolved</span> : ""}
      </div>
      <div class="inc-item-actions">
        <a href={`/monitors/${incident.monitor_id}`} class="btn btn-ghost btn-mini">Open monitor</a>
        {isAdmin && isOpen && !isAcked ? (
          <form method="post" action={`/incidents/${incident.id}/ack`} style="margin:0">
            <input type="hidden" name="next" value={`/incidents?tab=${tab}`} />
            <button type="submit" class="btn btn-danger btn-mini">Acknowledge</button>
          </form>
        ) : ""}
      </div>
    </div>
  );
}

function listHandler(req: Bun.BunRequest<"/incidents">, ctx: PageContext): Response | Promise<Response> {
  const url = new URL(req.url);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = TABS.has(tabParam as Tab) ? (tabParam as Tab) : "open";

  const openIncidents = getActiveIncidents();
  const resolvedIncidents = getRecentlyResolved(Date.now() - 30 * 24 * 60 * 60 * 1000, 100);

  const incidents: IncidentRow[] =
    tab === "open" ? openIncidents
      : tab === "resolved" ? resolvedIncidents
        : getAllIncidents(200);

  const banner = getBannerIncident();

  return htmlResponse(
    <Layout
      ctx={ctx}
      title="Incidents"
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
          <h1 class="page-h1">Incidents</h1>
          <div class="page-meta">
            <span>{openIncidents.length} open · {resolvedIncidents.length} resolved last 30 days</span>
          </div>
        </div>
      </div>

      <div class="inc-tabs">
        <a class={`inc-tab${tab === "open" ? " active" : ""}`} href="/incidents?tab=open">
          Open
          {openIncidents.length > 0 ? <span class="inc-tab-badge">{String(openIncidents.length)}</span> : ""}
        </a>
        <a class={`inc-tab${tab === "resolved" ? " active" : ""}`} href="/incidents?tab=resolved">
          Resolved
          <span class="inc-tab-count">· {String(resolvedIncidents.length)}</span>
        </a>
        <a class={`inc-tab${tab === "all" ? " active" : ""}`} href="/incidents?tab=all">All</a>
      </div>

      <div class="inc-list">
        {incidents.length === 0 ? (
          <div class="inc-empty">
            {tab === "open"
              ? <>No open incidents. <a href="/incidents?tab=resolved" class="btn-link">View resolved →</a></>
              : tab === "resolved" ? "No resolved incidents in the last 30 days."
                : "No incidents recorded yet."}
          </div>
        ) : incidents.map((i) => <IncidentItem incident={i} isAdmin={ctx.isAdmin} tab={tab} />)}
      </div>
    </Layout>,
  );
}

async function ackHandler(req: Bun.BunRequest<"/incidents/:id/ack">, _ctx: PageContext): Promise<Response> {
  const id = Number(req.params.id);
  ackIncident(id);
  const form = await req.formData();
  const next = safeNext(String(form.get("next") ?? ""), "/incidents?tab=open");
  return new Response(null, { status: 303, headers: { Location: next } });
}

// === Incident detail page ===

function detailHandler(
  req: Bun.BunRequest<"/incidents/:id">,
  ctx: PageContext,
): Response | Promise<Response> {
  const id = Number(req.params.id);
  const incident = getIncident(id);
  if (!incident) return new Response("not found", { status: 404 });

  const failures = getIncidentFailures(incident);
  const alerts = getIncidentAlerts(incident);
  const duration = incident.ended_at
    ? incident.ended_at - incident.started_at
    : Date.now() - incident.started_at;
  const isOpen = incident.ended_at === null;
  const checks = getIncidentChecks(incident.monitor_id, incident.started_at, incident.ended_at);
  // Render newest check first
  checks.reverse();

  return htmlResponse(
    <Layout ctx={ctx} title={`Incident · ${incident.monitor_name}`}>
      <div class="page-breadcrumbs">
        <a href="/incidents">Incidents</a>
        <span class="sep">/</span>
        <span safe>{incident.monitor_name}</span>
      </div>

      <div class="page-head">
        <div>
          <h1 class="page-h1">
            <StatusDot status={isOpen ? "down" : "up"} />
            <span safe>{incident.monitor_name}</span>
            {isOpen
              ? <StatusPill status="down" />
              : <span class="pill pill-up" style="font-size:11px">resolved</span>}
          </h1>
          <div class="page-meta">
            {isOpen
              ? <>
                  <span style="color:var(--down);font-weight:500">Down for {formatDuration(duration)}</span>
                  <span style="color:var(--dim)">·</span>
                  <span>started {formatAgo(incident.started_at)}</span>
                </>
              : <>
                  <span>Resolved {formatAgo(incident.ended_at)}</span>
                  <span style="color:var(--dim)">·</span>
                  <span>duration {formatDuration(duration)}</span>
                </>}
          </div>
        </div>
        <div class="page-actions">
          <a href={`/monitors/${incident.monitor_id}`} class="btn btn-ghost">Open monitor</a>
          {ctx.isAdmin && isOpen && incident.acked_at === null ? (
            <form method="post" action={`/incidents/${incident.id}/ack`} style="margin:0">
              <input type="hidden" name="next" value={`/incidents/${incident.id}`} />
              <button type="submit" class="btn btn-danger">Acknowledge</button>
            </form>
          ) : ""}
        </div>
      </div>

      <div class="detail-grid">
        {/* LEFT: stats + timeline */}
        <div>
          <div class="detail-stats">
            <div class="detail-stat">
              <div class="detail-stat-label">Failed checks</div>
              <div class={`detail-stat-value${failures > 0 ? " down" : ""}`}>{String(failures)}</div>
              <div class="detail-stat-meta">during this incident</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Alerts sent</div>
              <div class="detail-stat-value">{String(alerts)}</div>
              <div class="detail-stat-meta">queue entries</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Duration</div>
              <div class="detail-stat-value" safe>{formatDuration(duration)}</div>
              <div class="detail-stat-meta">{isOpen ? "still open" : "to resolution"}</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-label">Acked</div>
              <div class="detail-stat-value">
                {incident.acked_at !== null
                  ? <span safe>{new Date(incident.acked_at).toISOString().slice(11, 19)}</span>
                  : <span class="muted">no</span>}
              </div>
              <div class="detail-stat-meta">{incident.acked_at !== null ? "operator confirmed" : "awaiting ack"}</div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3 class="panel-h3">Check timeline</h3>
              <span class="panel-meta">{checks.length} {checks.length === 1 ? "check" : "checks"} during incident</span>
            </div>
            <div class="checks-table">
              <div class="checks-row head">
                <div>When</div><div>Status</div><div>Latency</div><div>Detail</div>
              </div>
              {checks.length === 0 ? (
                <div class="incident-card muted" style="text-align:center;padding:18px">No checks recorded during this incident window.</div>
              ) : checks.map((c) => (
                <div class={`checks-row${c.status === "down" ? " failed" : ""}`}>
                  <div class="when">{formatAgoCompact(c.checked_at)}</div>
                  <div><StatusPill status={c.status as "up" | "down"} /></div>
                  <div class="latency">{c.latency_ms !== null ? `${c.latency_ms}ms` : "—"}</div>
                  <div class="detail-text" title={ctx.isAdmin ? (c.detail ?? "") : ""} safe>
                    {ctx.isAdmin ? (c.detail ?? "") : (c.status === "up" ? "ok" : "failed")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: notes + initial detail */}
        <div style="display:flex;flex-direction:column;gap:14px">
          {ctx.isAdmin && incident.initial_detail ? (
            <div class="panel">
              <div class="panel-head">
                <h3 class="panel-h3">Initial failure</h3>
                <span class="panel-meta">first check that triggered</span>
              </div>
              <div style="padding:14px 18px">
                <code style="font-family:var(--mono);font-size:12px;color:var(--down);word-break:break-all" safe>{incident.initial_detail}</code>
              </div>
            </div>
          ) : ""}

          <div class="panel">
            <div class="panel-head">
              <h3 class="panel-h3">Postmortem notes</h3>
              <span class="panel-meta">{ctx.isAdmin ? "markdown · admin only" : "admin only"}</span>
            </div>
            {incident.notes ? (
              <div style="padding:14px 18px">
                <div class="md-content">{renderMarkdown(incident.notes) as "safe"}</div>
              </div>
            ) : (
              <div style="padding:14px 18px">
                <div class="md-empty">No notes yet.</div>
              </div>
            )}
            {ctx.isAdmin ? (
              <form method="post" action={`/incidents/${incident.id}/notes`} class="notes-edit">
                <label>Edit notes (Markdown)</label>
                <textarea name="notes" placeholder="Root cause · who fixed it · how to prevent next time · links to PRs and Slack threads" safe>{incident.notes ?? ""}</textarea>
                <div style="display:flex;gap:8px;margin-top:8px">
                  <button type="submit" class="btn btn-primary btn-mini">Save notes</button>
                </div>
              </form>
            ) : ""}
          </div>
        </div>
      </div>
    </Layout>,
  );
}

async function notesHandler(
  req: Bun.BunRequest<"/incidents/:id/notes">,
  _ctx: PageContext,
): Promise<Response> {
  const id = Number(req.params.id);
  const form = await req.formData();
  const raw = String(form.get("notes") ?? "");
  setIncidentNotes(id, raw.trim() === "" ? null : raw);
  return new Response(null, { status: 303, headers: { Location: `/incidents/${id}` } });
}

// JSON poll endpoint used by uptime.js to detect new unacked incidents
// and play a sound + flash the tab title.
import { db } from "../db";
const unackedCountQuery = db.query<{ c: number }, []>(
  "SELECT COUNT(*) AS c FROM incidents WHERE ended_at IS NULL AND acked_at IS NULL"
);
function pollHandler(_req: Bun.BunRequest<"/incidents/poll">): Response {
  const c = unackedCountQuery.get()?.c ?? 0;
  return new Response(JSON.stringify({ unacked: c }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const incidentsRoutes = {
  list: { GET: publicRoute(listHandler) },
  detail: { GET: publicRoute(detailHandler) },
  notes: { POST: adminRoute(notesHandler) },
  ack: { POST: adminRoute(ackHandler) },
  poll: { GET: publicRoute(pollHandler) },
};
