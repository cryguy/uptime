import { config } from "./config";
import { db } from "./db";
import "./secrets";
import { applyRetention } from "./secrets";
import { purgeExpiredSessions } from "./auth";
import { startScheduler } from "./scheduler";
import { startAlertLoop } from "./alerts";
import { loginRoutes } from "./routes/login";
import { dashboardRoutes } from "./routes/dashboard";
import { monitorRoutes } from "./routes/monitor";
import { webhookRoutes } from "./routes/webhooks";
import { incidentsRoutes } from "./routes/incidents";
import { settingsRoutes } from "./routes/settings";
import { preferenceRoutes } from "./routes/preferences";

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 60 * 60 * 1000);

// Auto-acknowledge stale unacked incidents on a 1-minute cadence.
if (config.autoAckMinutes > 0) {
  const autoAckQuery = db.query(`
    UPDATE incidents SET acked_at = ?1
    WHERE ended_at IS NULL AND acked_at IS NULL AND started_at < ?2
  `);
  setInterval(() => {
    const cutoff = Date.now() - config.autoAckMinutes * 60_000;
    autoAckQuery.run(Date.now(), cutoff);
  }, 60_000);
  console.log(`auto-ack enabled: incidents older than ${config.autoAckMinutes}m`);
}

// Periodic retention purge — runs every 30 minutes; no-op when all retention
// periods are 0 (keep forever).
setInterval(() => {
  try { applyRetention(); } catch (e) { console.error("retention purge:", e); }
}, 30 * 60 * 1000);

startScheduler();
startAlertLoop();

const server = Bun.serve({
  port: config.port,
  routes: {
    "/": () => Response.redirect("/dashboard", 302),

    "/login": loginRoutes.page,
    "/logout": loginRoutes.logout,

    "/dashboard": dashboardRoutes.dashboard,
    "/monitors/new": monitorRoutes.newForm,
    "/monitors": monitorRoutes.create,
    "/monitors/:id": monitorRoutes.detail,
    "/monitors/:id/delete": monitorRoutes.delete,
    "/monitors/:id/pause": monitorRoutes.pause,
    "/monitors/:id/run-now": monitorRoutes.runNow,
    "/monitors/:id/mute": monitorRoutes.mute,
    "/monitors/:id/unmute": monitorRoutes.unmute,
    "/monitors/bulk/pause": monitorRoutes.bulkPause,
    "/monitors/bulk/resume": monitorRoutes.bulkResume,
    "/monitors/bulk/mute": monitorRoutes.bulkMute,
    "/monitors/bulk/delete": monitorRoutes.bulkDelete,
    "/monitors/:id/badge": dashboardRoutes.badge,
    "/monitors/:id/row": dashboardRoutes.row,

    "/webhooks": webhookRoutes.list,
    "/webhooks/:id/delete": webhookRoutes.delete,
    "/webhooks/:id/toggle": webhookRoutes.toggle,

    "/incidents": incidentsRoutes.list,
    "/incidents/poll": incidentsRoutes.poll,
    "/incidents/:id/ack": incidentsRoutes.ack,

    "/settings": settingsRoutes.page,
    "/settings/credentials": settingsRoutes.credentials,
    "/settings/encryption/rotate": settingsRoutes.rotate,
    "/settings/retention": settingsRoutes.retention,
    "/settings/retention/purge-now": settingsRoutes.purgeNow,
    "/settings/sessions/:id/revoke": settingsRoutes.revokeSession,

    "/preferences/theme": preferenceRoutes.theme,
    "/preferences/density": preferenceRoutes.density,
  },
  // Fallback handles static assets and 404s. Kept out of the typed
  // routes table to dodge a Response type collision with undici-types
  // (which ssh2 → @types/node pulls in transitively).
  fetch(req) {
    const url = new URL(req.url);
    const staticResp = serveStatic(url.pathname);
    if (staticResp) return staticResp;
    return new Response("Not Found", { status: 404 });
  },
  error(err) {
    console.error("server error:", err);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`Uptime running on http://localhost:${server.port}`);

// Whitelist-based static dispatcher. Restricted to known filenames under
// /static/ and /static/fonts/ to prevent any path traversal.
function serveStatic(pathname: string): Response | null {
  if (!pathname.startsWith("/static/")) return null;
  const rest = pathname.slice("/static/".length);
  if (rest.includes("..") || rest.startsWith("/") || rest.endsWith("/")) return null;
  const isTopLevelJs = rest === "htmx.min.js" || rest === "spark.js" || rest === "uptime.js";
  const isFontAsset = /^fonts\/[A-Za-z0-9_-]+\.(woff2|css)$/.test(rest);
  if (!isTopLevelJs && !isFontAsset) return null;
  return new Response(Bun.file(`./public/${rest}`), {
    headers: {
      "Content-Type": contentTypeFor(rest),
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function contentTypeFor(p: string): string {
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}
