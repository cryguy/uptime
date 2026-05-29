// Static assets embedded into the standalone binary.
//
// Every import below uses Bun's `with { type: "file" }` attribute, which yields
// a *path string* rather than the file's contents: the real on-disk path when
// running the source via `bun run` (dev), and an internal `$bunfs/...` path when
// running a compiled binary (`bun build --compile`). That single behaviour lets
// the server read assets the same way in both modes — `Bun.file(path)` works
// either way — so there is no dev-vs-compiled branching anywhere in the server.
//
// Because the imports are static, this manifest is self-checking: if a font is
// renamed (e.g. after re-running `bun run fetch-fonts`) without updating the
// list here, both `bun run dev` and `bun run build` fail loudly on the dangling
// import instead of silently 404-ing at runtime.

// --- First-party / vendored JS (served at /static/*.js) ---
import htmx from "../public/htmx.min.js" with { type: "file" };
import spark from "../public/spark.js" with { type: "file" };
import uptimeJs from "../public/uptime.js" with { type: "file" };

// --- Font stylesheet (served at /static/fonts/fonts.css) ---
import fontsCss from "../public/fonts/fonts.css" with { type: "file" };

// --- Inter Tight (woff2, one file per unicode-range subset) ---
import interCyrillicExt from "../public/fonts/NGSwv5HMAFg6IuGlBNMjxLsK8ah8QA.woff2" with { type: "file" };
import interCyrillic from "../public/fonts/NGSwv5HMAFg6IuGlBNMjxLsD8ah8QA.woff2" with { type: "file" };
import interGreekExt from "../public/fonts/NGSwv5HMAFg6IuGlBNMjxLsL8ah8QA.woff2" with { type: "file" };
import interGreek from "../public/fonts/NGSwv5HMAFg6IuGlBNMjxLsE8ah8QA.woff2" with { type: "file" };
import interVietnamese from "../public/fonts/NGSwv5HMAFg6IuGlBNMjxLsI8ah8QA.woff2" with { type: "file" };
import interLatinExt from "../public/fonts/NGSwv5HMAFg6IuGlBNMjxLsJ8ah8QA.woff2" with { type: "file" };
import interLatin from "../public/fonts/NGSwv5HMAFg6IuGlBNMjxLsH8ag.woff2" with { type: "file" };

// --- JetBrains Mono (woff2, one file per unicode-range subset) ---
import jbCyrillicExt from "../public/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx3cwhsk.woff2" with { type: "file" };
import jbCyrillic from "../public/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxTcwhsk.woff2" with { type: "file" };
import jbGreek from "../public/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxPcwhsk.woff2" with { type: "file" };
import jbVietnamese from "../public/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx_cwhsk.woff2" with { type: "file" };
import jbLatinExt from "../public/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2" with { type: "file" };
import jbLatin from "../public/fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2" with { type: "file" };

// --- OpenAPI spec (served at /openapi.yml and /api/v1/openapi.yml) ---
import openapi from "../openapi.yml" with { type: "file" };

// `with { type: "file" }` produces a path string at build + runtime. TS types
// the import by extension (woff2/css via assets.d.ts, yml as `any`, and the
// .js files resolve as real JS modules under `allowJs`), so coerce uniformly to
// the string path the loader actually returns.
const asPath = (x: unknown): string => x as string;

/**
 * Maps the `/static/` sub-path (the segment after `/static/`) to the embedded
 * file path. Membership in this map is the static-asset allowlist — an exact
 * key match is a stricter guard than a path regex, and traversal sequences like
 * `..` simply match nothing.
 */
export const STATIC_ASSETS: Record<string, string> = {
  "htmx.min.js": asPath(htmx),
  "spark.js": asPath(spark),
  "uptime.js": asPath(uptimeJs),

  "fonts/fonts.css": asPath(fontsCss),

  "fonts/NGSwv5HMAFg6IuGlBNMjxLsK8ah8QA.woff2": asPath(interCyrillicExt),
  "fonts/NGSwv5HMAFg6IuGlBNMjxLsD8ah8QA.woff2": asPath(interCyrillic),
  "fonts/NGSwv5HMAFg6IuGlBNMjxLsL8ah8QA.woff2": asPath(interGreekExt),
  "fonts/NGSwv5HMAFg6IuGlBNMjxLsE8ah8QA.woff2": asPath(interGreek),
  "fonts/NGSwv5HMAFg6IuGlBNMjxLsI8ah8QA.woff2": asPath(interVietnamese),
  "fonts/NGSwv5HMAFg6IuGlBNMjxLsJ8ah8QA.woff2": asPath(interLatinExt),
  "fonts/NGSwv5HMAFg6IuGlBNMjxLsH8ag.woff2": asPath(interLatin),

  "fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx3cwhsk.woff2": asPath(jbCyrillicExt),
  "fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxTcwhsk.woff2": asPath(jbCyrillic),
  "fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxPcwhsk.woff2": asPath(jbGreek),
  "fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx_cwhsk.woff2": asPath(jbVietnamese),
  "fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2": asPath(jbLatinExt),
  "fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2": asPath(jbLatin),
};

/** Embedded path to the OpenAPI spec. */
export const OPENAPI_ASSET: string = asPath(openapi);
