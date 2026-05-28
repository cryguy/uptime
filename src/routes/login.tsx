import Html from "@kitajs/html";
import { checkLoginRate, createSession, destroySession, readSession, verifyCredentials } from "../auth";
import { pageContext, type PageContext } from "../views/context";
import { Layout, ThemeToggle } from "../views/layout";
import { BrandMark } from "../views/components";
import { htmlResponse, safeNext } from "./wrap";

function LoginPage({
  ctx,
  next,
  error,
}: {
  ctx: PageContext;
  next?: string | null;
  error?: string;
}): JSX.Element {
  const action = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  return (
    <Layout ctx={ctx} title="Sign in" hideNav mainClass={false}>
      <div class="login-screen">
        <div class="login-screen-theme">
          <ThemeToggle ctx={ctx} />
        </div>
        <div class="login-card">
          <div class="login-brand">
            <BrandMark size={26} />
            <span style="font-weight:600;font-size:16px">Uptime</span>
          </div>
          <h1 class="login-h1">Sign in</h1>
          <div class="login-sub">Internal status console · authorized engineers only.</div>
          {error ? (
            <div class="login-error">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3" />
                <path d="M7 4 V8 M7 9.5 V10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
              <span safe>{error}</span>
            </div>
          ) : ""}
          <form method="post" action={action}>
            <label for="u">Username</label>
            <input id="u" name="username" required autofocus />
            <label for="p">Password</label>
            <input id="p" name="password" type="password" required />
            <button type="submit" class="btn btn-primary">Sign in</button>
          </form>
        </div>
      </div>
    </Layout>
  );
}

function loginGet(req: Request): Response | Promise<Response> {
  const ctx = pageContext(req);
  if (ctx.isAdmin) {
    return Response.redirect(safeNext(new URL(req.url).searchParams.get("next")), 302);
  }
  const next = new URL(req.url).searchParams.get("next");
  return htmlResponse(<LoginPage ctx={ctx} next={next} />);
}

async function loginPost(req: Request, server: Bun.Server<unknown>): Promise<Response> {
  const ctx = pageContext(req);
  const ip = server.requestIP(req)?.address ?? "unknown";
  const next = new URL(req.url).searchParams.get("next");

  if (!checkLoginRate(ip)) {
    return htmlResponse(
      <LoginPage ctx={ctx} next={next} error="Too many attempts. Try again in a minute." />,
      { status: 429 },
    );
  }
  const form = await req.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const ok = await verifyCredentials(username, password);
  if (!ok) {
    return htmlResponse(
      <LoginPage ctx={ctx} next={next} error="Invalid credentials." />,
      { status: 401 },
    );
  }
  const { setCookie } = createSession();
  return new Response(null, {
    status: 303,
    headers: { Location: safeNext(next), "Set-Cookie": setCookie },
  });
}

function logoutPost(req: Request): Response {
  const session = readSession(req.headers.get("cookie"));
  const headers: Record<string, string> = { Location: "/dashboard" };
  if (session) headers["Set-Cookie"] = destroySession(session.id);
  return new Response(null, { status: 303, headers });
}

export const loginRoutes = {
  page: { GET: loginGet, POST: loginPost },
  logout: { POST: logoutPost },
};
