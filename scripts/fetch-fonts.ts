// Downloads Inter Tight + JetBrains Mono woff2 files for self-hosting.
// Run: bun run fetch-fonts
//
// Without a modern User-Agent header, Google Fonts serves TTF and we'd lose
// the (much smaller, hinted) woff2 build. The Chrome UA below triggers the
// modern asset bundle.

import { mkdirSync, writeFileSync } from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const families = [
  "Inter+Tight:wght@300;400;500;600;700",
  "JetBrains+Mono:wght@400;500",
];

const url =
  "https://fonts.googleapis.com/css2?" +
  families.map((f) => `family=${f}`).join("&") +
  "&display=swap";

mkdirSync("public/fonts", { recursive: true });

const cssRes = await fetch(url, { headers: { "User-Agent": UA } });
if (!cssRes.ok) {
  console.error(`Failed to fetch Google Fonts CSS: ${cssRes.status}`);
  process.exit(1);
}

let css = await cssRes.text();
const matches = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)];

const downloaded = new Set<string>();
for (const m of matches) {
  const fontUrl = m[1]!;
  if (downloaded.has(fontUrl)) continue;
  downloaded.add(fontUrl);
  const filename = fontUrl.split("/").pop()!;
  console.log(`fetching ${filename}`);
  const res = await fetch(fontUrl);
  if (!res.ok) {
    console.error(`  failed: ${res.status}`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(`public/fonts/${filename}`, buf);
  // Rewrite all occurrences (Google sometimes references the same URL across
  // multiple unicode-range blocks).
  css = css.split(fontUrl).join(`/static/fonts/${filename}`);
}

writeFileSync("public/fonts/fonts.css", css);
console.log(`wrote ${downloaded.size} font files + fonts.css to public/fonts/`);
