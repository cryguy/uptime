import Html from "@kitajs/html";
import { Layout } from "../views/layout";
import {
  IncidentBanner, StatusDot, StatusPill,
  formatAgo, formatAgoCompact, formatDuration,
} from "../views/components";
import type { PageContext } from "../views/context";
import {
  ackIncident, getActiveIncidents, getAllIncidents, getBannerIncident,
  getIncidentAlerts, getIncidentFailures, getRecentlyResolved, type IncidentRow,
} from "../queries";
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
  const isOpen = incident.ended_at === null;
  const isAcked = incident.acked_at !== null;
  const failures = getIncidentFailures(incident);
  const alerts = getIncidentAlerts(incident);
  const duration = incident.ended_at
    ? incident.ended_at - incident.started_at
    : Date.now() - incident.started_at;

  return (
    <div class="inc-item">
      <div class="inc-item-head">
        <div class="inc-item-name">
          <StatusDot status={isOpen ? "down" : "up"} />
          <span safe>{incident.monitor_name}</span>
          {isOpen
            ? <StatusPill status="down" />
            : <span class="pill pill-up" style="font-size:11px">resolved</span>}
          {isAcked && isOpen ? <span class="pill pill-disabled" style="font-size:11px">acked</span> : ""}
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
  ack: { POST: adminRoute(ackHandler) },
  poll: { GET: publicRoute(pollHandler) },
};
