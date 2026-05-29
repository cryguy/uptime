// Ambient module declarations for binary assets embedded via Bun's
// `with { type: "file" }` import attribute (see assets.ts).
//
// The attribute makes each import resolve to a *path string* — the real on-disk
// path under `bun run`, an internal `$bunfs/...` path inside a compiled binary.
// TypeScript types imports by file extension and ignores the attribute, so it
// needs a declaration per extension. `bun-types` already declares `*.yml` (as
// `any`) and `allowJs` resolves the `*.js` files as real modules; `.woff2` and
// `.css` are otherwise unknown, so we declare them here as string paths.
//
// NOTE: this file is intentionally NOT named to match a `.ts` sibling — a
// `foo.d.ts` next to `foo.ts` is treated as that module's declaration file
// rather than as a global ambient-declaration source, and its `declare module`
// wildcards would be silently ignored.

declare module "*.woff2" {
  var path: string;
  export = path;
}

declare module "*.css" {
  var path: string;
  export = path;
}
