// Cross-compiles standalone release binaries for every supported platform.
// Run: bun run build
//
// Each artifact is a single self-contained executable: the Bun runtime, the
// app, all npm dependencies, the built-in `bun:sqlite` engine, and every static
// asset (see src/assets.ts) are baked in. Nothing external is required at run
// time except the env/`.env` secrets and a writable directory for the SQLite DB.
//
// Bun downloads the target's runtime on first use, so the initial build of each
// platform needs network access and is slower than subsequent ones.
import { rmSync, mkdirSync, statSync } from "node:fs";
import type { BunPlugin } from "bun";

interface Target {
  /** Bun cross-compilation target triple. */
  triple: Bun.Build.CompileTarget;
  /** Output filename under dist/. */
  out: string;
  /** Human-readable label for the build log. */
  label: string;
}

// macOS uses the standard (modern) builds — Apple dropped pre-AVX2 Macs long
// ago. Linux and Windows use -baseline so a downloaded binary runs on any x64
// CPU regardless of age (the modern build faults with "Illegal instruction" on
// pre-2013 chips). The musl variant is the only one that runs on Alpine.
const TARGETS: Target[] = [
  { triple: "bun-darwin-x64", out: "uptime-darwin-x64", label: "macOS (Intel)" },
  { triple: "bun-darwin-arm64", out: "uptime-darwin-arm64", label: "macOS (Apple Silicon)" },
  { triple: "bun-linux-x64-baseline", out: "uptime-linux-x64", label: "Linux x64 (glibc, baseline)" },
  { triple: "bun-linux-x64-musl", out: "uptime-linux-x64-musl", label: "Linux x64 (musl / Alpine)" },
  { triple: "bun-windows-x64-baseline", out: "uptime-windows-x64.exe", label: "Windows x64 (baseline)" },
];

// ssh2 optionally loads native crypto addons — `cpu-features` and a bundled
// `sshcrypto.node` — both wrapped in try/catch with a pure-JS fallback. Native
// `.node` files are platform-specific machine code and cannot be cross-compiled,
// so we keep them out of the bundle. The `cpu-features` package is externalized
// by name; this plugin externalizes any stray `.node` require (e.g. ssh2's
// sshcrypto.node, which isn't even present here). At run time those requires
// fail harmlessly and ssh2 falls back to JS crypto — fine for uptime checks.
const externalizeNodeAddons: BunPlugin = {
  name: "externalize-node-addons",
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, external: true }));
  },
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
let failed = false;

console.log(`Building ${TARGETS.length} release binaries → dist/\n`);

for (const { triple, out, label } of TARGETS) {
  const outfile = `dist/${out}`;
  process.stdout.write(`  ${label.padEnd(32)} `);

  const result = await Bun.build({
    entrypoints: ["src/index.ts"],
    compile: { target: triple, outfile },
    minify: true,
    sourcemap: "linked",
    external: ["cpu-features"],
    plugins: [externalizeNodeAddons],
  });

  if (!result.success) {
    console.log("FAILED");
    for (const log of result.logs) console.error(log);
    failed = true;
    continue;
  }

  console.log(`${out.padEnd(24)} ${mib(statSync(outfile).size)}`);
}

if (failed) {
  console.error("\nOne or more targets failed to build.");
  process.exit(1);
}

console.log("\nDone. Binaries are in dist/.");
