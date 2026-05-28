// Markdown rendering for monitor + incident notes.
//
// Configured with `html: false` so raw HTML in input is treated as literal
// text. The input source is the admin only (notes are written and read by
// the same single admin), but defense-in-depth — if we ever publish incident
// postmortems to the public dashboard, the rendering stays XSS-safe.

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
});

// Open external links in a new tab; safer attrs added by default.
const defaultLinkRender = md.renderer.rules.link_open ||
  function (tokens, idx, opts, _env, self) { return self.renderToken(tokens, idx, opts); };

md.renderer.rules.link_open = function (tokens, idx, opts, env, self) {
  const token = tokens[idx]!;
  const href = token.attrGet("href") ?? "";
  if (href.startsWith("http://") || href.startsWith("https://")) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkRender(tokens, idx, opts, env, self);
};

export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return md.render(text);
}
