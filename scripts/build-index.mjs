/* ============================================================
   build-index.mjs — regenerates posts/index.json AND sitemap.xml

   Scans every posts/*.md file, reads its front-matter
   (title / date / summary), writes the list to posts/index.json
   (newest first), and writes a sitemap.xml covering the home page
   and every post.

   Runs automatically via GitHub Actions on every push
   (see .github/workflows/build-index.yml). You can also run
   it by hand:  node scripts/build-index.mjs
   ============================================================ */

const SITE = "https://damonroberts.co.uk";

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const postsDir = join(root, "posts");

const files = (await readdir(postsDir)).filter((f) => f.endsWith(".md"));

const posts = [];
for (const file of files) {
  const slug = file.replace(/\.md$/, "");
  const raw = await readFile(join(postsDir, file), "utf8");
  const meta = parseFrontMatter(raw);
  posts.push({
    slug,
    title: meta.title || slug,
    date: meta.date || "",
    summary: meta.summary || "",
  });
}

// newest first
posts.sort((a, b) => (a.date < b.date ? 1 : -1));

await writeFile(join(postsDir, "index.json"), JSON.stringify(posts, null, 2) + "\n");
console.log(`Wrote posts/index.json — ${posts.length} post(s).`);

// --- sitemap.xml: home page + every post ---
// home page changes on every deploy, so stamp it with today's build date
const today = new Date().toISOString().slice(0, 10);
const urls = [
  { loc: `${SITE}/`, lastmod: today },
  { loc: `${SITE}/play.html`, lastmod: today }, // NODE RUN game (unlinked easter egg, but indexable)
  ...posts.map((p) => ({
    loc: `${SITE}/post.html?slug=${p.slug}`,
    lastmod: p.date,
  })),
];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls
    .map(
      (u) =>
        `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`
    )
    .join("\n") +
  `\n</urlset>\n`;
await writeFile(join(root, "sitemap.xml"), sitemap);
console.log("Wrote sitemap.xml.");

function parseFrontMatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = val;
  }
  return meta;
}
