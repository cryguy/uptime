import Html from "@kitajs/html";
import { config } from "../config";
import { stylesheet } from "./styles";
import { BrandMark, MoonIcon, SunIcon } from "./components";
import type { PageContext } from "./context";

type LayoutProps = {
  ctx: PageContext;
  title: string;
  hideNav?: boolean;
  // When non-null, rendered between topbar and main (e.g. IncidentBanner).
  banner?: JSX.Element | string;
  // Class for the <main> wrapper. Pass `false` to skip the wrapper entirely
  // (used by the login page which has its own full-bleed shell).
  mainClass?: string | false;
  children: Html.Children;
};

export function Layout({
  ctx,
  title,
  hideNav,
  banner,
  mainClass,
  children,
}: LayoutProps): JSX.Element {
  return (
    <>
      {"<!DOCTYPE html>"}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content={ctx.theme === "light" ? "light dark" : "dark light"} />
          <title safe>{`${title} · Uptime`}</title>
          <style>{stylesheet}</style>
          <script src="/static/htmx.min.js" defer></script>
          <script src="/static/spark.js" defer></script>
          <script src="/static/uptime.js" defer></script>
        </head>
        <body data-theme={ctx.theme}>
          {!hideNav ? <TopBar ctx={ctx} /> : ""}
          {banner ?? ""}
          {mainClass === false
            ? <>{children}</>
            : <main class={mainClass ?? "page-main"}>{children}</main>}
        </body>
      </html>
    </>
  );
}

function TopBar({ ctx }: { ctx: PageContext }): JSX.Element {
  const isActive = (path: string) =>
    ctx.pathname === path || (path === "/dashboard" && (ctx.pathname === "/" || ctx.pathname.startsWith("/monitors")));

  return (
    <header class="topbar">
      <a href="/dashboard" class="brand">
        <BrandMark />
        <span class="brand-name">Uptime</span>
      </a>
      <nav class="nav">
        <a href="/dashboard" class={isActive("/dashboard") ? "active" : ""}>Monitors</a>
        <a href="/incidents" class={isActive("/incidents") ? "active" : ""}>
          Incidents
          {ctx.activeIncidents > 0 ? <span class="nav-badge">{String(ctx.activeIncidents)}</span> : ""}
        </a>
        {ctx.isAdmin ? (
          <>
            <a href="/webhooks" class={isActive("/webhooks") ? "active" : ""}>Webhooks</a>
            <a href="/settings" class={isActive("/settings") ? "active" : ""}>Settings</a>
          </>
        ) : ""}
      </nav>
      <div class="spacer" />
      <button type="button" class="kbd-button" aria-label="Open command palette">
        <span>Search · jump to monitor</span>
        <kbd>⌘K</kbd>
      </button>
      <ThemeToggle ctx={ctx} />
      {ctx.isAdmin
        ? <AdminAvatar />
        : <a href={`/login?next=${encodeURIComponent(ctx.pathname)}`} class="topbar-login">Log in</a>}
    </header>
  );
}

export function ThemeToggle({ ctx }: { ctx: PageContext }): JSX.Element {
  return (
    <form method="post" action="/preferences/theme" class="theme-toggle">
      <input type="hidden" name="next" value={ctx.pathname} />
      <button
        type="submit"
        name="theme"
        value="light"
        class={ctx.theme === "light" ? "active" : ""}
        title="Light theme"
        aria-label="Switch to light theme"
      >
        <SunIcon />
      </button>
      <button
        type="submit"
        name="theme"
        value="dark"
        class={ctx.theme === "dark" ? "active" : ""}
        title="Dark theme"
        aria-label="Switch to dark theme"
      >
        <MoonIcon />
      </button>
    </form>
  );
}

function AdminAvatar(): JSX.Element {
  // Two-letter initials from the admin username; falls back to "AD" (admin).
  const u = config.adminUsername.trim();
  const initials = (u.slice(0, 2) || "AD").toUpperCase();
  return (
    <form method="post" action="/logout" class="logout-form">
      <button type="submit" title={`${u} · log out`} aria-label="Log out" safe>{initials}</button>
    </form>
  );
}
