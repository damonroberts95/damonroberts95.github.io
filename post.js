/* ============================================================
   post.js — renders a single post.

   How it works:
     - reads the ?slug=... from the URL
     - finds that post in posts/index.json (for title + date)
     - fetches  posts/<slug>.md  and renders the Markdown to HTML

   You normally never edit this file. To add a post, see README.
   ============================================================ */

document.getElementById("year").textContent = new Date().getFullYear();

const article = document.getElementById("article");
const slug = new URLSearchParams(location.search).get("slug") || "";

if (!slug) {
  showError("No post specified.");
} else {
  // get the post's metadata (title/date) from the index
  fetch("posts/index.json")
    .then((r) => r.json())
    .then((posts) => {
      const meta = posts.find((p) => p.slug === slug);
      // fetch the markdown body
      return fetch(`posts/${slug}.md`).then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.text();
      }).then((md) => ({ meta, md }));
    })
    .then(({ meta, md }) => render(meta, md))
    .catch(() => showError("Post not found."));
}

function render(meta, markdown) {
  const title = meta ? meta.title : "Untitled";
  const date = meta ? formatDate(meta.date) : "";
  document.title = `${title} — Damon Roberts`;

  const html = marked.parse(markdown);
  article.innerHTML = `
    <header class="article__head">
      <h1 class="article__title">${escapeHtml(title)}</h1>
      <p class="article__date">${date}</p>
    </header>
    <div class="article__body">${html}</div>`;
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
