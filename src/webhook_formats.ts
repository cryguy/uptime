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
  const headline = `${icon} *${e.monitor_name}* ${isDown ? "is down" : "recovered"}`;
  return JSON.stringify({
    text: `${icon} ${e.monitor_name} ${isDown ? "is down" : "recovered"}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${headline}\n_${e.detail}_` } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `latency: ${e.latency_ms}ms · <!date^${Math.floor(e.at / 1000)}^{date_short_pretty} {time}|${new Date(e.at).toISOString()}>`,
          },
        ],
      },
    ],
  });
}

function discord(e: AlertEvent): string {
  const isDown = e.event === "down";
  const icon = isDown ? "🔴" : "🟢";
  return JSON.stringify({
    content: `${icon} **${e.monitor_name}** ${isDown ? "is down" : "is back up"}`,
    embeds: [
      {
        title: e.monitor_name,
        description: e.detail,
        color: isDown ? COLOR_DOWN : COLOR_UP,
        timestamp: new Date(e.at).toISOString(),
        fields: [
          { name: "Status", value: e.event, inline: true },
          { name: "Latency", value: `${e.latency_ms}ms`, inline: true },
        ],
      },
    ],
  });
}

function googleChat(e: AlertEvent): string {
  const isDown = e.event === "down";
  const icon = isDown ? "🔴" : "🟢";
  const verb = isDown ? "is down" : "is back up";
  return JSON.stringify({
    text: `${icon} *${e.monitor_name}* ${verb}\n_${e.detail}_ · ${e.latency_ms}ms`,
  });
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
