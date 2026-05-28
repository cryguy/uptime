import { readSession } from "../auth";
import { verifyToken } from "../api_auth";
import { pageContext, type PageContext } from "../views/context";

export const htmlHeaders = { "Content-Type": "text/html; charset=utf-8" };

// JSX in @kitajs/html resolves to `string | Promise<string>` — synchronous in
// practice for us, but the union forces an async signature here.
export async function htmlResponse(
  body: string | Promise<string>,
  init?: ResponseInit,
): Promise<Response> {
  const html = typeof body === "string" ? body : await body;
  return new Response(html, {
    ...init,
    headers: { ...htmlHeaders, ...(init?.headers ?? {}) },
  });
}

// Public route: anyone can access. Handler receives a PageContext whose
// `isAdmin` flag reflects whether the request carries a valid session, so
// the page can conditionally render admin-only chrome (edit buttons, etc.)
// without splitting URLs.
export function publicRoute<P extends string>(
  handler: (req: Bun.BunRequest<P>, ctx: PageContext) => Response | Promise<Response>,
): (req: Bun.BunRequest<P>) => Response | Promise<Response> {
  return (req) => handler(req, pageContext(req));
}

// Admin route: requires a valid session. Otherwise redirects to /login with
// a `next` query param so the user returns here after authenticating.
export function adminRoute<P extends string>(
  handler: (req: Bun.BunRequest<P>, ctx: PageContext) => Response | Promise<Response>,
): (req: Bun.BunRequest<P>) => Response | Promise<Response> {
  return (req) => {
    if (!readSession(req.headers.get("cookie"))) {
      const url = new URL(req.url);
      const next = encodeURIComponent(url.pathname + url.search);
      return Response.redirect(`/login?next=${next}`, 302);
    }
    return handler(req, pageContext(req));
  };
}

// Legacy alias for handlers not yet migrated to the (req, ctx) signature.
// Behaves identically to adminRoute but doesn't pass ctx.
export function authed<P extends string>(
  handler: (req: Bun.BunRequest<P>) => Response | Promise<Response>,
): (req: Bun.BunRequest<P>) => Response | Promise<Response> {
  return (req) => {
    if (!readSession(req.headers.get("cookie"))) {
      const url = new URL(req.url);
      const next = encodeURIComponent(url.pathname + url.search);
      return Response.redirect(`/login?next=${next}`, 302);
    }
    return handler(req);
  };
}

// API route: requires a valid Bearer token in the Authorization header.
// Returns 401 JSON otherwise. The handler receives the token id so it can
// log which client made the request if needed.
export function apiRoute<P extends string>(
  handler: (req: Bun.BunRequest<P>, tokenId: number) => Response | Promise<Response>,
): (req: Bun.BunRequest<P>) => Response | Promise<Response> {
  return (req) => {
    const tokenId = verifyToken(req.headers.get("authorization"));
    if (tokenId === null) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        },
      });
    }
    return handler(req, tokenId);
  };
}

// Validates a `next` query param for an open-redirect safe path:
// must be a relative URL starting with `/`, not `//` (protocol-relative),
// and not `/login` itself (would create a redirect loop).
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return fallback;
  return value;
}
