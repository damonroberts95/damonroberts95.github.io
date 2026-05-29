/* ============================================================
   post.js — renders a single post.

   How it works:
     - reads the ?slug=... from the URL
     - fetches  posts/<slug>.md
     - splits off the front-matter (the bit between the --- lines)
       for the title + date
     - renders the Markdown body to HTML with marked.js

   You normally never edit this file. To add a post, see README.
   ============================================================ */

document.getElementById("year").textContent = new Date().getFullYear();

const article = document.getElementById("article");
const slug = new URLSearchParams(location.search).get("slug") || "";

if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
  showError("No post specified.");
} else {
  fetch(`posts/${slug}.md`)
    .then((r) => {
      if (!r.ok) throw new Error("not found");
      return r.text();
    })
    .then((raw) => {
      const { meta, body } = parseFrontMatter(raw);
      render(meta, body);
    })
    .catch(() => showError("Post not found."));
}

function render(meta, markdown) {
  const title = meta.title || "Untitled";
  const date = meta.date ? formatDate(meta.date) : "";
  document.title = `${title} — Damon Roberts`;

  const html = marked.parse(markdown);
  article.innerHTML = `
    <header class="article__head">
      <h1 class="article__title">${escapeHtml(title)}</h1>
      <p class="article__date">${date}</p>
    </header>
    <div class="article__body">${html}</div>`;
}

// Split "---\nkey: value\n---\nbody" into { meta:{...}, body:"..." }
function parseFrontMatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = val;
  }
  return { meta, body: match[2] };
}

function showError(msg) {
  article.innerHTML = `<p class="posts__empty">${escapeHtml(msg)}</p>`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
