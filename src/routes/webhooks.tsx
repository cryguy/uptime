import Html from "@kitajs/html";
import { db } from "../db";
import { Layout } from "../views/layout";
import { formatAgoCompact } from "../views/components";
import { getWebhookStats } from "../queries";
import { FORMAT_LABELS, WEBHOOK_FORMATS, isValidFormat, type WebhookFormat } from "../webhook_formats";
import type { PageContext } from "../views/context";
import { adminRoute, htmlResponse } from "./wrap";

const listWebhooks = db.query<
  { id: number; name: string; url: string; enabled: number; format: string; template: string | null; created_at: number },
  []
>("SELECT id, name, url, enabled, format, template, created_at FROM webhooks ORDER BY created_at DESC");

const insertWebhook = db.query(
  "INSERT INTO webhooks (name, url, enabled, format, template, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const deleteWebhookQuery = db.query("DELETE FROM webhooks WHERE id = ?");
const toggleWebhookQuery = db.query(
  "UPDATE webhooks SET enabled = 1 - enabled WHERE id = ?"
);

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function WebhooksPage({
  ctx,
  error,
}: {
  ctx: PageContext;
  error?: string;
}): JSX.Element {
  const rows = listWebhooks.all();
  const stats = new Map(rows.map((w) => [w.id, getWebhookStats(w.id)]));
  const enabledCount = rows.filter((w) => w.enabled === 1).length;
  const totalDelivered24h = Array.from(stats.values()).reduce((s, x) => s + x.delivered_24h, 0);
  const totalRetrying = Array.from(stats.values()).reduce((s, x) => s + x.retrying, 0);

  return (
    <Layout ctx={ctx} title="Webhooks">
      <div class="page-head">
        <div>
          <h1 class="page-h1">Webhooks</h1>
          <div class="page-meta">
            <span>{enabledCount} active · {totalDelivered24h} delivered last 24h{totalRetrying > 0 ? ` · ${totalRetrying} retrying` : ""}</span>
          </div>
        </div>
      </div>

      <div class="panel" style="padding:18px 20px;margin-bottom:16px">
        <div class="form-section-title" style="margin-bottom:4px">Add a webhook</div>
        <div class="form-section-desc">URL must be http:// or https://. The payload format is chosen per webhook so each receiver gets the JSON shape it expects.</div>
        {error ? <div class="login-error" safe>{error}</div> : ""}
        <form method="post" action="/webhooks">
          <div class="form-row" style="grid-template-columns:1fr 2fr">
            <div>
              <label>Name</label>
              <input name="name" placeholder="Slack #alerts · Google Chat ops · …" required />
            </div>
            <div>
              <label>URL</label>
              <input name="url" type="url" placeholder="https://hooks.slack.com/... · https://chat.googleapis.com/... · ..." required />
            </div>
          </div>
          <div class="form-row" style="grid-template-columns:1fr 2fr;margin-top:10px">
            <div>
              <label>Format</label>
              <select name="format">
                {WEBHOOK_FORMATS.map((f) => (
                  <option value={f}>{FORMAT_LABELS[f].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Custom template (only used when format = Custom)</label>
              <textarea name="template" placeholder='{"text": "{{event}}: {{monitor.name}} — {{detail}} ({{latency_ms}}ms)"}' style="font-family:var(--mono);font-size:12px;min-height:64px"></textarea>
            </div>
          </div>
          <div class="form-hint" style="margin-top:6px">
            Placeholders: <code safe>{"{{event}} {{monitor.id}} {{monitor.name}} {{detail}} {{latency_ms}} {{at}} {{at_iso}}"}</code>. Values are JSON-string-escaped on substitution.
          </div>
          <div style="display:flex;gap:8px;margin-top:18px">
            <button type="submit" class="btn btn-primary">Save webhook</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <div class="wh-table-row head">
          <div>Name</div>
          <div>URL</div>
          <div>Enabled</div>
          <div>Delivered · 24h</div>
          <div>Last delivery</div>
          <div></div>
        </div>
        {rows.length === 0 ? (
          <div class="incident-card muted" style="text-align:center;padding:32px">No webhooks yet. Add one above.</div>
        ) : rows.map((w) => {
          const s = stats.get(w.id)!;
          const fmt = isValidFormat(w.format) ? w.format : "generic";
          return (
            <div class="wh-table-row">
              <div class="wh-name">
                <span safe>{w.name}</span>
                <span class="type-chip" style="margin-left:8px" safe>{FORMAT_LABELS[fmt].label}</span>
              </div>
              <div class="wh-url" title={w.url} safe>{w.url}</div>
              <div>
                <form method="post" action={`/webhooks/${w.id}/toggle`} class="wh-toggle-form">
                  <button type="submit" class={`wh-toggle${w.enabled === 1 ? "" : " off"}`} aria-label={w.enabled === 1 ? "Disable" : "Enable"} />
                </form>
              </div>
              <div class="wh-delivery-stat">
                {w.enabled === 1 ? (
                  <>
                    <span>{s.delivered_24h}</span>
                    {s.retrying > 0 ? <span class="fail" safe>{`· ${s.retrying} retry`}</span> : ""}
                    {s.failed_recent > 0 ? <span class="fail" safe>{`· ${s.failed_recent} dead`}</span> : ""}
                  </>
                ) : (
                  <span class="dash-cell-empty">—</span>
                )}
              </div>
              <div class="wh-delivery-stat">
                {s.last_delivery_at ? formatAgoCompact(s.last_delivery_at) : <span class="dash-cell-empty">—</span>}
              </div>
              <div>
                <form method="post" action={`/webhooks/${w.id}/delete`} style="margin:0;display:inline" onsubmit="return confirm('Delete this webhook?')">
                  <button type="submit" class="btn btn-ghost btn-mini btn-icon-danger" title="Delete" aria-label="Delete">×</button>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      <div class="footer-hint">
        <span></span>
        <span>Bound webhooks fire on monitor state transitions · failures retry with exponential backoff</span>
      </div>
    </Layout>
  );
}

function listHandler(req: Bun.BunRequest<"/webhooks">, ctx: PageContext): Promise<Response> {
  return htmlResponse(<WebhooksPage ctx={ctx} />);
}

async function createHandler(req: Bun.BunRequest<"/webhooks">, ctx: PageContext): Promise<Response> {
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const formatStr = String(form.get("format") ?? "generic").trim();
  const templateStr = String(form.get("template") ?? "").trim();
  if (!name) return htmlResponse(<WebhooksPage ctx={ctx} error="Name is required" />, { status: 400 });
  if (!isHttpUrl(url)) {
    return htmlResponse(<WebhooksPage ctx={ctx} error="URL must be http:// or https://" />, { status: 400 });
  }
  const format: WebhookFormat = isValidFormat(formatStr) ? formatStr : "generic";
  if (format === "custom" && !templateStr) {
    return htmlResponse(<WebhooksPage ctx={ctx} error="Custom format requires a template" />, { status: 400 });
  }
  insertWebhook.run(name, url, 1, format, templateStr || null, Date.now());
  return new Response(null, { status: 303, headers: { Location: "/webhooks" } });
}

function deleteHandler(req: Bun.BunRequest<"/webhooks/:id/delete">): Response {
  deleteWebhookQuery.run(Number(req.params.id));
  return new Response(null, { status: 303, headers: { Location: "/webhooks" } });
}

function toggleHandler(req: Bun.BunRequest<"/webhooks/:id/toggle">): Response {
  toggleWebhookQuery.run(Number(req.params.id));
  return new Response(null, { status: 303, headers: { Location: "/webhooks" } });
}

export const webhookRoutes = {
  list: { GET: adminRoute(listHandler), POST: adminRoute(createHandler) },
  delete: { POST: adminRoute(deleteHandler) },
  toggle: { POST: adminRoute(toggleHandler) },
};
