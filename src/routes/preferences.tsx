// User preference endpoints — persist theme and density via cookies that the
// PageContext layer reads on every render. Public (no auth) by design: the
// preferences are per-browser, not per-user, so anonymous viewers can also
// choose their theme.

import { publicRoute, safeNext } from "./wrap";
import type { Density, Theme } from "../views/context";

const VALID_THEMES = new Set<Theme>(["dark", "light"]);
const VALID_DENSITIES = new Set<Density>(["comfort", "compact", "dense"]);
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function cookieFor(name: string, value: string): string {
  return `${name}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

async function themeHandler(req: Bun.BunRequest<"/preferences/theme">): Promise<Response> {
  const form = await req.formData();
  const theme = String(form.get("theme") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!VALID_THEMES.has(theme as Theme)) {
    return new Response(null, { status: 303, headers: { Location: next } });
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": cookieFor("theme", theme),
    },
  });
}

async function densityHandler(req: Bun.BunRequest<"/preferences/density">): Promise<Response> {
  const form = await req.formData();
  const density = String(form.get("density") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!VALID_DENSITIES.has(density as Density)) {
    return new Response(null, { status: 303, headers: { Location: next } });
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": cookieFor("density", density),
    },
  });
}

export const preferenceRoutes = {
  theme: { POST: publicRoute(themeHandler) },
  density: { POST: publicRoute(densityHandler) },
};
