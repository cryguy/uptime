import { readSession } from "../auth";
import { db } from "../db";

export type Theme = "dark" | "light";
export type Density = "comfort" | "compact" | "dense";

export type PageContext = {
  isAdmin: boolean;
  theme: Theme;
  density: Density;
  pathname: string;
  // Count of currently-down monitors — drives the Incidents nav badge.
  activeIncidents: number;
};

const VALID_DENSITY = new Set<Density>(["comfort", "compact", "dense"]);

function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// Unacked open incidents drive the nav badge — "stuff demanding attention".
// Acked-but-still-down incidents are hidden here so the badge clears on ack.
const countUnackedOpen = db.query<{ c: number }, []>(
  "SELECT COUNT(*) AS c FROM incidents WHERE ended_at IS NULL AND acked_at IS NULL",
);

export function pageContext(req: Request): PageContext {
  const cookie = req.headers.get("cookie");
  const themeCookie = getCookie(cookie, "theme");
  const densityCookie = getCookie(cookie, "density") as Density | null;
  return {
    isAdmin: !!readSession(cookie),
    theme: themeCookie === "light" ? "light" : "dark",
    density: densityCookie && VALID_DENSITY.has(densityCookie) ? densityCookie : "compact",
    pathname: new URL(req.url).pathname,
    activeIncidents: countUnackedOpen.get()?.c ?? 0,
  };
}
