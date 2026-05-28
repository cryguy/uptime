// Per-webhook payload formatters.
//
// Each receiver (Slack, Discord, Google Chat, PagerDuty…) expects its own
// JSON shape. We pick the shape based on the webhook's `format` column at
// enqueue time, so the row stored in alert_queue is exactly the bytes we'll
// POST — making delivery dumb and the audit trail honest.

export type WebhookFormat =
  | "generic"
  | "slack"
  | "discord"
  | "google_chat"
  | "custom";

export const WEBHOOK_FORMATS: readonly WebhookFormat[] = [
  "generic",
  "slack",
  "discord",
  "google_chat",
  "custom",
] as const;

export type AlertEvent = {
  event: "up" | "down";
  monitor_id: number;
  monitor_name: string;
  latency_ms: number;
  detail: string;
  at: number;
};

// Hex color values (no leading "#") for Discord embeds. Mirrors design tokens.
const COLOR_DOWN = 0xff5a6a;
const COLOR_UP = 0x3dcf8e;

// Distill the raw outcome into human-readable phrasing.
//
// The trap we're avoiding: `latency_ms` for a *timeout* failure isn't the
// response time, it's how long we waited before aborting — typically
// "timeout_ms + a few ms of jitter". Pasting "10017ms" next to "timeout
// after 10000ms" makes readers wonder if the latency is meaningful. It's
// not. For timeouts we drop the latency line entirely; the detail string
// already carries the only number that matters (the configured limit).
function describe(e: AlertEvent): {
  verb: string;
  reason: string;
  timing: string | null;
} {
  const isDown = e.event === "down";
  if (!isDown) {
    return {
      verb: "recovered",
      reason: e.detail,
      timing: `response in ${e.latency_ms}ms`,
    };
  }
  const timeoutMatch = /timeout after (\d+)ms/i.exec(e.detail);
  if (timeoutMatch) {
    return {
      verb: "is down",
      reason: `timed out after ${timeoutMatch[1]}ms (the configured limit)`,
      timing: null,
    };
  }
  return {
    verb: "is down",
    reason: e.detail,
    timing: `failed in ${e.latency_ms}ms`,
  };
}

function generic(e: AlertEvent): string {
  return JSON.stringify({
    event: e.event,
    monitor: { id: e.monitor_id, name: e.monitor_name },
    latency_ms: e.latency_ms,
    detail: e.detail,
    at: e.at,
  });
}

function slack(e: AlertEvent): string {
  const isDown = e.event === "down";
  const icon = isDown ? ":red_circle:" : ":large_green_circle:";
  const { verb, reason, timing } = describe(e);
  const tsLink = `<!date^${Math.floor(e.at / 1000)}^{date_short_pretty} {time}|${new Date(e.at).toISOString()}>`;
  const ctxText = timing ? `${timing} · ${tsLink}` : tsLink;
  return JSON.stringify({
    text: `${icon} ${e.monitor_name} ${verb}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${icon} *${e.monitor_name}* ${verb}\n_${reason}_` } },
      { type: "context", elements: [{ type: "mrkdwn", text: ctxText }] },
    ],
  });
}

function discord(e: AlertEvent): string {
  const isDown = e.event === "down";
  const icon = isDown ? "🔴" : "🟢";
  const { verb, reason, timing } = describe(e);
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: "Status", value: e.event, inline: true },
  ];
  // Latency field is only meaningful when the number reflects a real
  // response time (or a real time-to-failure-detection). For timeouts the
  // number is config + jitter, so we omit it.
  if (timing !== null) {
    const label = isDown ? "Time to failure" : "Response time";
    fields.push({ name: label, value: `${e.latency_ms}ms`, inline: true });
  }
  return JSON.stringify({
    content: `${icon} **${e.monitor_name}** ${verb}`,
    embeds: [
      {
        title: e.monitor_name,
        description: reason,
        color: isDown ? COLOR_DOWN : COLOR_UP,
        timestamp: new Date(e.at).toISOString(),
        fields,
      },
    ],
  });
}

function googleChat(e: AlertEvent): string {
  const isDown = e.event === "down";
  const icon = isDown ? "🔴" : "🟢";
  const { verb, reason, timing } = describe(e);
  // Google Chat markdown: *bold*, _italic_, single asterisks (not CommonMark).
  const parts = [`${icon} *${e.monitor_name}* ${verb}`, `_${reason}_`];
  if (timing) parts.push(timing);
  return JSON.stringify({ text: parts.join(" · ") });
}

// JSON-safe escape for values substituted into a custom template. Escapes
// the four characters that would break a JSON string literal. Numeric
// values pass through as their natural string form.
function escapeForJson(s: string): string {
  return s.replace(/[\\"\n\r\t]/g, (c) => {
    if (c === "\\") return "\\\\";
    if (c === '"') return '\\"';
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return c;
  });
}

function custom(template: string, e: AlertEvent): string {
  // Placeholders: {{event}} {{monitor.id}} {{monitor.name}} {{detail}}
  //               {{latency_ms}} {{at}} {{at_iso}}
  const isoAt = new Date(e.at).toISOString();
  return template
    .replace(/\{\{event\}\}/g, escapeForJson(e.event))
    .replace(/\{\{monitor\.id\}\}/g, String(e.monitor_id))
    .replace(/\{\{monitor\.name\}\}/g, escapeForJson(e.monitor_name))
    .replace(/\{\{detail\}\}/g, escapeForJson(e.detail))
    .replace(/\{\{latency_ms\}\}/g, String(e.latency_ms))
    .replace(/\{\{at\}\}/g, String(e.at))
    .replace(/\{\{at_iso\}\}/g, escapeForJson(isoAt));
}

export function formatPayload(
  format: WebhookFormat,
  template: string | null,
  event: AlertEvent,
): string {
  switch (format) {
    case "slack":       return slack(event);
    case "discord":     return discord(event);
    case "google_chat": return googleChat(event);
    case "custom":      return custom(template ?? "", event);
    case "generic":
    default:            return generic(event);
  }
}

export function isValidFormat(s: string): s is WebhookFormat {
  return (WEBHOOK_FORMATS as readonly string[]).includes(s);
}

// Display label + short description for the UI select.
export const FORMAT_LABELS: Record<WebhookFormat, { label: string; hint: string }> = {
  generic: { label: "Generic JSON", hint: "Raw event payload — for n8n, Zapier, custom HTTP endpoints" },
  slack: { label: "Slack", hint: "Slack Incoming Webhooks — uses Block Kit" },
  discord: { label: "Discord", hint: "Discord webhook — uses embeds with color" },
  google_chat: { label: "Google Chat", hint: "Google Chat incoming webhook — text format" },
  custom: { label: "Custom template", hint: "Use {{event}} {{monitor.name}} {{detail}} {{latency_ms}} {{at_iso}} placeholders" },
};
