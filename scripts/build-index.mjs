/* ============================================================
   build-index.mjs — regenerates posts/index.json

   Scans every posts/*.md file, reads its front-matter
   (title / date / summary), and writes the list to
   posts/index.json (newest first).

   Runs automatically via GitHub Actions on every push
   (see .github/workflows/build-index.yml). You can also run
   it by hand:  node scripts/build-index.mjs
   ============================================================ */

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
