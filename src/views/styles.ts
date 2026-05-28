// Design system CSS (Direction D, locked).
// Sourced verbatim from design/d-app.html with these adjustments:
//   - `.app[data-theme]` removed; rules attached to `body[data-theme]`.
//   - Added density attribute selectors so `data-density` cascades to rows,
//     status dots, type chips, pills, and uptime strips.
//   - Added font-face import from /static/fonts/fonts.css.
//   - Page-helper (mockup demo nav) removed.

export const stylesheet = `
@import url('/static/fonts/fonts.css');

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Inter Tight', system-ui, -apple-system, sans-serif;
  font-feature-settings: 'tnum', 'cv11', 'ss01';
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
}
button { font: inherit; cursor: pointer; border: 0; background: transparent; padding: 0; color: inherit; }
a { color: inherit; text-decoration: none; cursor: pointer; }
kbd { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.85em; }
input, select, textarea { font: inherit; color: inherit; }
svg { display: block; }
:root { --mono: 'JetBrains Mono', ui-monospace, monospace; }

/* ===== Tokens ===== */
body[data-theme="dark"] {
  --bg: #0A0A0C; --bg-2: #101013; --panel: #14141A; --panel-2: #1A1A21;
  --panel-hover: #1F1F27; --border: #232329; --border-2: #2C2C34;
  --text: #ECEDEE; --text-2: #B0B2BA; --muted: #80838E; --dim: #5A5D67;
  --accent: #7C5CFF; --accent-soft: rgba(124,92,255,0.13); --accent-hi: #A18EFF;
  --up: #3DCF8E; --up-soft: rgba(61,207,142,0.12); --up-bar: #2C8C5A;
  --down: #FF5A6A; --down-soft: rgba(255,90,106,0.12); --down-bar: #C53747;
  --warn: #F2AD52; --warn-soft: rgba(242,173,82,0.12);
  --shadow-tooltip: 0 6px 16px rgba(0,0,0,0.45);
}
body[data-theme="light"] {
  --bg: #FAFAFB; --bg-2: #FFFFFF; --panel: #FFFFFF; --panel-2: #F4F4F6;
  --panel-hover: #F0F0F3; --border: #E8E8EC; --border-2: #DCDCE2;
  --text: #0E0F12; --text-2: #44464E; --muted: #6C6F77; --dim: #94979F;
  --accent: #5E3DEC; --accent-soft: rgba(94,61,236,0.09); --accent-hi: #4A2BD0;
  --up: #16A55C; --up-soft: rgba(22,165,92,0.10); --up-bar: #25A258;
  --down: #DC3545; --down-soft: rgba(220,53,69,0.09); --down-bar: #B82C40;
  --warn: #B86E00; --warn-soft: rgba(184,110,0,0.10);
  --shadow-tooltip: 0 6px 16px rgba(0,0,0,0.12);
}
body { background: var(--bg); color: var(--text); }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes dim   { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }

/* ===== TopBar ===== */
.topbar { height: 56px; padding: 0 24px; display: flex; align-items: center; gap: 24px; border-bottom: 1px solid var(--border); background: var(--bg-2); }
.brand { display: flex; align-items: center; gap: 9px; }
.brand-name { font-weight: 600; font-size: 14.5px; letter-spacing: -0.01em; }
.brand-mark { border-radius: 6px; }
.nav { display: flex; gap: 2px; }
.nav a { font-size: 13px; padding: 7px 11px; border-radius: 6px; color: var(--muted); font-weight: 500; display: inline-flex; align-items: center; gap: 7px; transition: background 140ms, color 140ms; }
.nav a:hover { background: var(--panel-2); color: var(--text); text-decoration: none; }
.nav a.active { color: var(--text); background: var(--panel-2); }
.nav-badge { font-size: 10px; padding: 1px 6px; background: var(--down-soft); color: var(--down); border-radius: 999px; font-weight: 600; }
.spacer { flex: 1; }
.kbd-button { display: inline-flex; align-items: center; gap: 14px; padding: 6px 8px 6px 12px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); font-size: 12.5px; background: var(--bg); cursor: pointer; }
.kbd-button:hover { border-color: var(--border-2); color: var(--text); }
.kbd-button kbd { font-size: 10px; padding: 2px 5px; background: var(--panel-2); border-radius: 4px; color: var(--muted); }
.theme-toggle { display: flex; padding: 3px; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; }
.theme-toggle button { padding: 5px 10px; font-size: 12px; color: var(--muted); border-radius: 5px; display: flex; align-items: center; gap: 5px; transition: background 120ms, color 120ms; }
.theme-toggle button.active { background: var(--panel-2); color: var(--text); }
.theme-toggle form { margin: 0; display: inline-flex; }
.avatar { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-hi)); color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 600; }
.topbar-login { font-size: 12.5px; color: var(--text-2); padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; }
.topbar-login:hover { color: var(--text); border-color: var(--border-2); text-decoration: none; }
.logout-form { margin: 0; }
.logout-form button { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-hi)); color: #fff; font-size: 11px; font-weight: 600; display: grid; place-items: center; }

/* ===== Buttons ===== */
.btn { padding: 7px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: background 120ms, border-color 120ms, color 120ms; text-decoration: none; font-family: inherit; }
.btn-ghost { color: var(--text-2); border: 1px solid var(--border); background: var(--bg-2); }
.btn-ghost:hover { background: var(--panel-hover); border-color: var(--border-2); color: var(--text); text-decoration: none; }
.btn-primary { color: #fff; background: var(--accent); border: 1px solid var(--accent); }
.btn-primary:hover { background: var(--accent-hi); border-color: var(--accent-hi); color: #fff; }
.btn-danger { color: #fff; background: var(--down); border: 1px solid var(--down); }
.btn-danger:hover { filter: brightness(1.08); color: #fff; }
.btn-mini { padding: 5px 10px; font-size: 12px; }
.btn-link { color: var(--accent); background: transparent; border: none; padding: 0; }
.btn-link:hover { color: var(--accent-hi); text-decoration: underline; }
.btn-icon-danger { color: var(--down); }
.btn-icon-danger:hover { color: var(--down); }

/* ===== Status primitives ===== */
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.status-dot.up { background: var(--up); box-shadow: 0 0 0 3px var(--up-soft); }
.status-dot.down { background: var(--down); box-shadow: 0 0 0 3px var(--down-soft); animation: pulse 1.6s ease-in-out infinite; }
.status-dot.disabled { background: var(--dim); }
.status-dot.unknown { background: var(--dim); box-shadow: 0 0 0 3px rgba(128,131,142,0.12); }
.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 500; letter-spacing: 0.01em; }
.pill-up { background: var(--up-soft); color: var(--up); }
.pill-down { background: var(--down-soft); color: var(--down); }
.pill-disabled { background: var(--panel-2); color: var(--muted); }
.pill-unknown { background: var(--panel-2); color: var(--muted); }
.type-chip { font-family: var(--mono); font-size: 10.5px; padding: 2px 6px; background: var(--panel-2); border: 1px solid var(--border); color: var(--muted); border-radius: 4px; letter-spacing: 0.04em; }

/* ===== Form controls ===== */
input[type="text"], input[type="url"], input[type="number"], input[type="password"], input[type="email"], input:not([type]), select, textarea {
  width: 100%; padding: 8px 12px; background: var(--bg-2); border: 1px solid var(--border); color: var(--text); border-radius: 7px; font-size: 13px; outline: none;
  transition: border-color 120ms, box-shadow 120ms;
  font-family: inherit;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
textarea { font-family: var(--mono); font-size: 12.5px; min-height: 96px; resize: vertical; }
label { display: block; font-size: 11.5px; color: var(--muted); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 6px; margin-top: 14px; }
label.inline { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; text-transform: none; letter-spacing: 0; color: var(--text-2); font-weight: 400; margin-right: 14px; margin-top: 0; cursor: pointer; }
label.inline input { width: auto; }
.form-row { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.form-hint { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.5; }
.form-section { padding-top: 14px; margin-top: 18px; border-top: 1px solid var(--border); }
.form-section:first-child { padding-top: 0; margin-top: 0; border-top: none; }
.form-section-title { font-size: 12.5px; color: var(--text); font-weight: 500; margin-bottom: 4px; }
.form-section-desc { font-size: 12px; color: var(--muted); margin-bottom: 12px; line-height: 1.5; }

/* ===== Segmented control ===== */
.segments { display: inline-flex; gap: 0; padding: 3px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 7px; }
.segments button, .segments a { padding: 5px 10px; font-size: 12px; color: var(--muted); border-radius: 4px; font-family: inherit; transition: background 120ms, color 120ms; text-decoration: none; }
.segments button.active, .segments a.active { background: var(--panel-2); color: var(--text); }
.segments button:hover:not(.active), .segments a:hover:not(.active) { color: var(--text-2); }
.segments form { margin: 0; }

/* ===== Panel ===== */
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.panel-head { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
.panel-h3 { margin: 0; font-size: 12.5px; font-weight: 500; color: var(--text); }
.panel-meta { font-size: 11px; color: var(--muted); font-family: var(--mono); }
.panel-body { padding: 16px; }

/* ===== Incident Banner ===== */
.incident-banner { display: flex; align-items: center; gap: 14px; padding: 13px 24px 13px 27px; background: linear-gradient(90deg, var(--down-soft), transparent 65%); border-bottom: 1px solid var(--border); position: relative; flex-wrap: wrap; }
.incident-banner::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--down); }
.banner-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--down); box-shadow: 0 0 0 4px var(--down-soft); animation: pulse 1.6s ease-in-out infinite; flex-shrink: 0; }
.banner-tag { font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; color: var(--down); padding: 3px 8px; background: var(--bg-2); border: 1px solid var(--down); border-radius: 4px; text-transform: uppercase; }
.banner-text { flex: 1; font-size: 13.5px; color: var(--text); }
.banner-text b { font-weight: 600; }
.banner-text .meta { color: var(--muted); margin-left: 8px; font-size: 12px; }
.banner-text code { font-family: var(--mono); font-size: 11.5px; color: var(--text-2); background: var(--bg-2); padding: 1.5px 6px; border-radius: 3px; border: 1px solid var(--border); }
.banner-actions { display: flex; gap: 6px; }
.banner-btn { padding: 6px 11px; font-size: 12px; font-weight: 500; border: 1px solid var(--border); background: var(--bg-2); color: var(--text); border-radius: 5px; cursor: pointer; font-family: inherit; }
.banner-btn:hover { background: var(--panel-hover); }
.banner-btn.primary { background: var(--down); border-color: var(--down); color: #fff; }
.banner-btn.primary:hover { filter: brightness(1.08); }
.banner-form { margin: 0; display: inline; }

/* ===== Page chrome ===== */
.page-main { max-width: 1400px; margin: 0 auto; padding: 24px 24px 60px; }
.page-main-narrow { max-width: 960px; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 22px; flex-wrap: wrap; }
.page-h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; display: inline-flex; align-items: center; gap: 10px; }
.page-meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
.page-meta .dot-up { width: 6px; height: 6px; border-radius: 50%; background: var(--up); display: inline-block; }
.page-meta .dot-down { width: 6px; height: 6px; border-radius: 50%; background: var(--down); display: inline-block; }
.page-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.page-actions form { margin: 0; display: inline; }
.page-breadcrumbs { font-size: 12.5px; color: var(--muted); margin-bottom: 6px; font-family: var(--mono); letter-spacing: 0.02em; }
.page-breadcrumbs a { color: var(--muted); }
.page-breadcrumbs a:hover { color: var(--text-2); text-decoration: none; }
.page-breadcrumbs .sep { color: var(--dim); margin: 0 6px; }

/* ===== Login ===== */
.login-screen {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px; position: relative; overflow: hidden;
  /* Two-layer background: a soft accent bloom behind the card + a uniform
     dotted grid across the whole viewport. */
  background-image:
    radial-gradient(ellipse 50% 35% at 50% 50%, var(--accent-soft), transparent 70%),
    radial-gradient(circle, var(--border) 1px, transparent 1px);
  background-size: 100% 100%, 22px 22px;
  background-position: 0 0, 0 0;
  background-repeat: no-repeat, repeat;
}
.login-card { position: relative; z-index: 1; }
.login-screen-theme { z-index: 1; }
.login-screen-theme { position: absolute; top: 20px; right: 24px; }
.login-card { width: 100%; max-width: 380px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 32px 30px 28px; }
.login-brand { display: flex; align-items: center; gap: 9px; margin-bottom: 22px; }
.login-h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; letter-spacing: -0.015em; }
.login-sub { font-size: 13px; color: var(--muted); margin-bottom: 18px; }
.login-error { background: var(--down-soft); border: 1px solid var(--down); padding: 9px 12px; border-radius: 6px; color: var(--down); font-size: 12.5px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.login-error svg { flex-shrink: 0; }
.login-card button[type="submit"] { width: 100%; margin-top: 6px; padding: 9px; justify-content: center; }
.login-footer { font-size: 11.5px; color: var(--dim); margin-top: 22px; text-align: center; font-family: var(--mono); }

/* ===== Dashboard ===== */
.dash-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
.dash-kpi { padding: 14px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
.dash-kpi-label { font-size: 11px; color: var(--muted); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
.dash-kpi-row { display: flex; align-items: baseline; gap: 8px; }
.dash-kpi-value { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
.dash-kpi-value.down { color: var(--down); }
.dash-kpi-pct { font-size: 12px; font-weight: 500; color: var(--up); padding: 2px 6px; background: var(--up-soft); border-radius: 5px; font-variant-numeric: tabular-nums; }
.dash-kpi-unit { font-size: 14px; font-weight: 500; color: var(--muted); }
.dash-kpi-spark { margin-top: auto; }
.dash-kpi-meta { font-size: 12px; color: var(--muted); margin-top: 4px; }
.dash-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.dash-search { flex: 1; min-width: 200px; position: relative; }
.dash-search input { padding-left: 32px; }
.dash-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; display: flex; }
.dash-content { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
@media (max-width: 1280px) { .dash-content { grid-template-columns: 1fr; } }
.dash-rail { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 80px; }
.dash-table { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; max-height: calc(100vh - 380px); min-height: 360px; }
.dash-table-scroll { flex: 1; overflow-y: auto; }
.dash-table-scroll::-webkit-scrollbar { width: 10px; }
.dash-table-scroll::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 5px; border: 2px solid var(--panel); }
.dash-thead, .dash-row { display: grid; grid-template-columns: 1.5fr 0.4fr 0.55fr 0.55fr 0.8fr 1.05fr 0.55fr 0.55fr 24px; gap: 11px; padding: 0 16px; align-items: center; }
.dash-thead { padding-top: 11px; padding-bottom: 11px; font-size: 10.5px; color: var(--muted); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.dash-row { height: 42px; border-bottom: 1px solid var(--border); font-size: 13px; transition: background 80ms; cursor: pointer; color: var(--text); }
.dash-row:last-child { border-bottom: none; }
.dash-row:hover { background: var(--panel-hover); }
.dash-row.is-down { background: var(--down-soft); }
.dash-row.is-down:hover { background: color-mix(in srgb, var(--down-soft) 80%, var(--panel-hover)); }
.dash-row a { color: inherit; }
.dash-row-name { display: flex; align-items: center; gap: 9px; min-width: 0; }
.dash-name-text { font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dash-latency-num { font-variant-numeric: tabular-nums; font-weight: 500; }
.dash-latency-unit { color: var(--muted); font-size: 11.5px; margin-left: 1px; }
.dash-uptime-strip { display: flex; gap: 1.5px; height: 16px; align-items: stretch; }
.dash-uptime-bar { flex: 1; min-width: 1.5px; border-radius: 1px; }
.dash-uptime-bar.up { background: var(--up-bar); }
.dash-uptime-bar.down { background: var(--down-bar); }
.dash-uptime-bar.disabled { background: var(--dim); opacity: 0.4; }
.dash-uptime-bar.empty { background: var(--dim); opacity: 0.2; }
.dash-cell-meta { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.dash-cell-empty { color: var(--dim); }
.dash-cell-action { color: var(--dim); justify-self: end; font-size: 14px; }
.dash-row:hover .dash-cell-action { color: var(--text); }
.dash-table-footer { padding: 9px 16px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--muted); font-family: var(--mono); flex-shrink: 0; background: var(--panel-2); }
.dash-table-footer-loading { display: inline-flex; align-items: center; gap: 6px; }
.dash-table-footer-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--muted); animation: dim 1.2s ease-in-out infinite; }

/* ===== Group headers (dashboard "Group by") ===== */
.dash-group-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--panel-2); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--muted); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
.dash-group-header b { color: var(--text-2); font-weight: 500; }
.dash-group-count { font-family: var(--mono); font-size: 11px; }

/* ===== Muted pill / icons ===== */
.pill-muted { background: var(--warn-soft); color: var(--warn); }
.mute-icon { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; color: var(--warn); margin-left: 4px; }
.dash-row.is-muted .dash-name-text::after { content: ' · muted'; color: var(--warn); font-size: 11px; font-weight: 400; }

/* ===== Mute dropdown ===== */
.mute-dropdown { position: relative; display: inline-block; }
.mute-dropdown-trigger { padding: 7px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 1px solid var(--border); background: var(--bg-2); color: var(--text-2); }
.mute-dropdown-trigger.active { background: var(--warn-soft); color: var(--warn); border-color: var(--warn); }
.mute-dropdown-trigger:hover { background: var(--panel-hover); border-color: var(--border-2); color: var(--text); }
.mute-dropdown-menu { position: absolute; top: calc(100% + 4px); right: 0; background: var(--panel); border: 1px solid var(--border-2); border-radius: 8px; box-shadow: var(--shadow-tooltip); display: none; min-width: 160px; z-index: 100; padding: 4px; }
.mute-dropdown[data-open="1"] .mute-dropdown-menu { display: block; }
.mute-dropdown-menu form { margin: 0; }
.mute-dropdown-menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; font-size: 12.5px; color: var(--text-2); border-radius: 5px; background: transparent; border: none; cursor: pointer; font-family: inherit; }
.mute-dropdown-menu button:hover { background: var(--panel-hover); color: var(--text); }

/* ===== Bulk operations ===== */
.dash-bulk-toolbar { display: none; gap: 8px; align-items: center; padding: 8px 12px; background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 7px; margin-bottom: 10px; font-size: 13px; }
.dash-bulk-toolbar.visible { display: flex; }
.dash-bulk-toolbar .count { font-weight: 600; color: var(--text); }
.dash-bulk-toolbar form { margin: 0; display: inline; }
.dash-row-check { display: flex; align-items: center; padding-right: 4px; }
.dash-row-check input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; }
.dash-thead.with-bulk, .dash-row.with-bulk { grid-template-columns: 24px 1.5fr 0.4fr 0.55fr 0.55fr 0.8fr 1.05fr 0.55fr 0.55fr 24px; }

/* ===== Filter dropdown ===== */
.filter-dropdown { position: relative; display: inline-block; }
.filter-dropdown-trigger { padding: 7px 11px; border-radius: 6px; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 1px solid var(--border); background: var(--bg-2); color: var(--text-2); font-family: inherit; }
.filter-dropdown-trigger.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.filter-dropdown-menu { position: absolute; top: calc(100% + 4px); left: 0; background: var(--panel); border: 1px solid var(--border-2); border-radius: 8px; box-shadow: var(--shadow-tooltip); display: none; min-width: 200px; z-index: 100; padding: 6px; }
.filter-dropdown[data-open="1"] .filter-dropdown-menu { display: block; }
.filter-dropdown-menu .filter-section { padding: 6px 8px; }
.filter-dropdown-menu .filter-section-h { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
.filter-dropdown-menu label.inline { font-size: 12.5px; margin-right: 0; padding: 3px 0; display: flex; }
.filter-dropdown-menu form { margin: 0; }
.filter-dropdown-menu .filter-actions { display: flex; gap: 6px; padding: 6px 8px 4px; border-top: 1px solid var(--border); margin-top: 4px; }
.filter-dropdown-menu .filter-actions button { padding: 4px 8px; font-size: 12px; }

/* ===== ⌘K Command palette ===== */
.cmdk-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: none; z-index: 1000; align-items: flex-start; justify-content: center; padding-top: 12vh; }
.cmdk-backdrop.open { display: flex; }
.cmdk-panel { width: 100%; max-width: 540px; background: var(--panel); border: 1px solid var(--border-2); border-radius: 12px; box-shadow: var(--shadow-tooltip); overflow: hidden; }
.cmdk-input { width: 100%; padding: 14px 18px; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--text); font-size: 15px; outline: none; }
.cmdk-input::placeholder { color: var(--dim); }
.cmdk-results { max-height: 50vh; overflow-y: auto; padding: 6px; }
.cmdk-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text-2); cursor: pointer; }
.cmdk-item.active { background: var(--accent-soft); color: var(--text); }
.cmdk-item:hover { background: var(--panel-hover); color: var(--text); }
.cmdk-item-kind { font-size: 10.5px; color: var(--muted); font-family: var(--mono); letter-spacing: 0.04em; text-transform: uppercase; margin-left: auto; }
.cmdk-empty { padding: 24px; text-align: center; color: var(--muted); font-size: 12.5px; }

/* ===== Density tiers ===== */
.dash-table[data-density="comfort"] .dash-row { height: 54px; font-size: 13.5px; }
.dash-table[data-density="comfort"] .status-dot { width: 8px; height: 8px; box-shadow: 0 0 0 3px var(--up-soft); }
.dash-table[data-density="comfort"] .status-dot.down { box-shadow: 0 0 0 3px var(--down-soft); }
.dash-table[data-density="comfort"] .dash-uptime-strip { height: 18px; }
.dash-table[data-density="dense"] .dash-row { height: 32px; font-size: 12px; }
.dash-table[data-density="dense"] .status-dot { width: 6px; height: 6px; box-shadow: 0 0 0 2px var(--up-soft); }
.dash-table[data-density="dense"] .status-dot.down { box-shadow: 0 0 0 2px var(--down-soft); }
.dash-table[data-density="dense"] .dash-uptime-strip { height: 12px; }
.dash-table[data-density="dense"] .type-chip { font-size: 10px; padding: 1px 5px; }
.dash-table[data-density="dense"] .pill { font-size: 10.5px; padding: 1px 6px; }

/* ===== Alert delivery rows ===== */
.alert-row { padding: 10px 16px; display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; border-bottom: 1px solid var(--border); }
.alert-row:last-child { border-bottom: none; }
.alert-channel { display: flex; align-items: center; gap: 8px; font-size: 12.5px; min-width: 0; }
.alert-channel-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alert-icon { width: 18px; height: 18px; border-radius: 4px; background: var(--panel-2); border: 1px solid var(--border); display: grid; place-items: center; font-size: 10px; color: var(--text-2); font-weight: 600; flex-shrink: 0; }
.alert-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-family: var(--mono); }
.alert-status.ok { color: var(--up); background: var(--up-soft); }
.alert-status.retry { color: var(--warn); background: var(--warn-soft); }
.alert-status.fail { color: var(--down); background: var(--down-soft); }
.alert-time { font-size: 11px; color: var(--muted); font-family: var(--mono); }

/* ===== Incident card (rail) ===== */
.incident-card { padding: 12px 16px; }
.incident-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.incident-card-name { font-weight: 500; font-size: 13px; color: var(--text); }
.incident-card-time { font-size: 11px; color: var(--muted); font-family: var(--mono); margin-left: auto; }
.incident-card-detail { font-size: 12px; color: var(--text-2); line-height: 1.55; }

/* ===== Monitor detail ===== */
.detail-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; align-items: start; margin-top: 8px; }
@media (max-width: 1100px) { .detail-grid { grid-template-columns: 1fr; } }
.detail-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
.detail-stat { padding: 12px 14px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
.detail-stat-label { font-size: 10.5px; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 6px; }
.detail-stat-value { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; line-height: 1; font-variant-numeric: tabular-nums; }
.detail-stat-value.down { color: var(--down); }
.detail-stat-value-unit { font-size: 12px; color: var(--muted); }
.detail-stat-meta { font-size: 11.5px; color: var(--muted); margin-top: 4px; font-family: var(--mono); }
.detail-summary { padding: 18px 20px; }
.detail-summary-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12.5px; }
.detail-summary-row:last-child { border-bottom: none; }
.detail-summary-label { color: var(--muted); width: 180px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
.detail-summary-value { color: var(--text-2); font-family: var(--mono); font-size: 12px; }
.checks-table { font-size: 12px; }
.checks-row { display: grid; grid-template-columns: 110px 70px 75px 1fr; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--border); align-items: center; }
.checks-row:last-child { border-bottom: none; }
.checks-row.head { font-size: 10.5px; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }
.checks-row .when { font-family: var(--mono); color: var(--muted); font-size: 11.5px; }
.checks-row .latency { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 12px; color: var(--text-2); }
.checks-row .detail-text { font-size: 11.5px; color: var(--muted); font-family: var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.checks-row.failed .detail-text { color: var(--down); }
.danger-zone { margin-top: 24px; padding: 18px 20px; background: var(--panel); border: 1px solid var(--down); border-radius: 10px; }
.danger-zone h3 { margin: 0 0 4px; font-size: 13.5px; color: var(--down); font-weight: 600; }
.danger-zone p { font-size: 12.5px; color: var(--text-2); margin: 0 0 12px; line-height: 1.55; }
.danger-zone form { margin: 0; }

/* ===== New monitor preview ===== */
.new-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1100px) { .new-grid { grid-template-columns: 1fr; } }
.new-preview { position: sticky; top: 80px; }
.new-preview-body { padding: 16px 18px; font-size: 13px; color: var(--text-2); line-height: 1.6; }
.new-preview-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.new-preview-name { font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.new-preview-rules { border-top: 1px solid var(--border); padding-top: 12px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.new-preview-rules div { margin-bottom: 4px; }
.new-preview-rules b { font-weight: 500; }

/* ===== Webhooks ===== */
.wh-table-row { display: grid; grid-template-columns: 1.3fr 2fr 0.7fr 0.8fr 0.8fr 32px; gap: 14px; padding: 12px 16px; border-bottom: 1px solid var(--border); align-items: center; font-size: 13px; }
.wh-table-row:last-child { border-bottom: none; }
.wh-table-row.head { padding-top: 10px; padding-bottom: 10px; font-size: 10.5px; color: var(--muted); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
.wh-name { font-weight: 500; }
.wh-url { font-family: var(--mono); color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wh-toggle-form { margin: 0; display: inline; }
.wh-toggle { width: 30px; height: 17px; border-radius: 999px; background: var(--up); position: relative; display: inline-block; cursor: pointer; border: none; padding: 0; }
.wh-toggle::after { content: ''; position: absolute; left: 2px; top: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: left 120ms; }
.wh-toggle.off { background: var(--dim); }
.wh-toggle.off::after { left: 15px; background: var(--bg-2); }
.wh-delivery-stat { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.wh-delivery-stat .fail { color: var(--down); }
.wh-action { color: var(--dim); justify-self: end; cursor: pointer; }
.wh-action:hover { color: var(--text); }

/* ===== Incidents ===== */
.inc-tabs { display: inline-flex; gap: 2px; padding: 4px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 20px; }
.inc-tab { padding: 6px 14px; font-size: 13px; color: var(--muted); border-radius: 6px; display: flex; align-items: center; gap: 7px; cursor: pointer; text-decoration: none; }
.inc-tab:hover:not(.active) { color: var(--text-2); }
.inc-tab.active { background: var(--panel-2); color: var(--text); font-weight: 500; }
.inc-tab-badge { font-size: 10px; padding: 1px 6px; background: var(--down-soft); color: var(--down); border-radius: 999px; font-weight: 600; }
.inc-tab.active .inc-tab-badge { background: var(--down); color: #fff; }
.inc-tab-count { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.inc-list { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.inc-item { padding: 16px 18px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 80ms; }
.inc-item:last-child { border-bottom: none; }
.inc-item:hover { background: var(--panel-hover); }
.inc-item-head { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: baseline; margin-bottom: 8px; }
.inc-item-name { font-size: 15px; font-weight: 600; letter-spacing: -0.005em; display: flex; align-items: center; gap: 9px; }
.inc-item-since { font-size: 12.5px; color: var(--muted); font-family: var(--mono); }
.inc-item-detail { font-size: 12.5px; color: var(--text-2); line-height: 1.5; margin-bottom: 10px; }
.inc-item-detail code { font-family: var(--mono); font-size: 11.5px; background: var(--bg-2); padding: 1.5px 6px; border-radius: 3px; border: 1px solid var(--border); color: var(--text-2); }
.inc-item-meta { display: flex; gap: 16px; font-size: 11.5px; color: var(--muted); font-family: var(--mono); flex-wrap: wrap; }
.inc-item-meta b { color: var(--text-2); font-weight: 500; }
.inc-item-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.inc-item-actions form { margin: 0; display: inline; }
.inc-empty { padding: 32px 18px; color: var(--muted); font-size: 12.5px; text-align: center; }

/* ===== Settings ===== */
.settings-grid { display: flex; flex-direction: column; gap: 16px; }
.settings-section { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 20px 22px; }
.settings-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
.settings-section-h3 { margin: 0; font-size: 14px; font-weight: 600; }
.settings-section-status { font-size: 11.5px; color: var(--muted); font-family: var(--mono); }
.settings-section-desc { font-size: 12.5px; color: var(--muted); margin-bottom: 14px; line-height: 1.55; }
.settings-section-desc code { font-family: var(--mono); font-size: 11.5px; background: var(--bg-2); padding: 1px 5px; border-radius: 3px; border: 1px solid var(--border); }
.settings-field { display: grid; grid-template-columns: 200px 1fr auto; gap: 16px; padding: 10px 0; border-top: 1px solid var(--border); align-items: center; }
.settings-field-label { font-size: 12.5px; color: var(--text-2); font-weight: 500; }
.settings-field-value { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.settings-field-readonly { font-family: var(--mono); font-size: 12px; color: var(--text-2); padding: 6px 10px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 5px; user-select: all; }

/* ===== Footer hint ===== */
.footer-hint { padding: 14px 4px 0; font-size: 12px; color: var(--dim); display: flex; justify-content: space-between; align-items: center; }
.footer-hint kbd { padding: 1.5px 5px; background: var(--panel); border: 1px solid var(--border); border-radius: 4px; color: var(--muted); }

/* ===== Spark tooltip ===== */
.spark { display: inline-block; line-height: 0; position: relative; }
.spark[data-interactive] svg { cursor: crosshair; }
.spark-tip {
  position: fixed; transform: translate(-50%, -100%);
  background: var(--panel); border: 1px solid var(--border-2);
  color: var(--text); padding: 5px 9px;
  font-size: 11.5px; font-family: var(--mono); font-variant-numeric: tabular-nums; font-weight: 500;
  border-radius: 5px; white-space: nowrap;
  box-shadow: var(--shadow-tooltip);
  pointer-events: none; z-index: 1000;
}
.spark-tip::after {
  content: ''; position: absolute; left: 50%; bottom: -4px;
  transform: translateX(-50%) rotate(45deg); width: 6px; height: 6px;
  background: var(--panel); border-right: 1px solid var(--border-2); border-bottom: 1px solid var(--border-2);
}

/* ===== Common utility ===== */
.muted { color: var(--muted); font-size: 0.9em; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.flex { display: flex; }
.gap-8 { gap: 8px; }
.gap-12 { gap: 12px; }
.grow { flex: 1; }
hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
`;
