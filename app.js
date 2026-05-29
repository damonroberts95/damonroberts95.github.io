/* ============================================================
   app.js — builds the "Writing" list on the home page.

   How it works:
     - reads  posts/index.json  (the list of all posts)
     - shows the newest first
     - each links to  post.html?slug=<slug>

   You normally never edit this file. To add a post, see README.
   ============================================================ */

// fill in the year in the footer
document.getElementById("year").textContent = new Date().getFullYear();

const list = document.getElementById("posts");

fetch("posts/index.json")
  .then((res) => {
    if (!res.ok) throw new Error("no index");
    return res.json();
  })
  .then((posts) => {
    // newest first (sort by date string, descending)
    posts.sort((a, b) => (a.date < b.date ? 1 : -1));

    if (!posts.length) {
      list.innerHTML = '<li class="posts__empty">Nothing posted yet.</li>';
      return;
    }

    list.innerHTML = ""; // clear the "Loading…" placeholder
    for (const post of posts) {
      const li = document.createElement("li");
      li.className = "post-item";
      li.innerHTML = `
        <a href="post.html?slug=${encodeURIComponent(post.slug)}">
          <span class="post-item__title">${escapeHtml(post.title)}</span>
          <span class="post-item__date">${formatDate(post.date)}</span>
          <span class="post-item__summary">${escapeHtml(post.summary || "")}</span>
        </a>`;
      list.appendChild(li);
    }
  })
  .catch(() => {
    list.innerHTML = '<li class="posts__empty">Nothing posted yet.</li>';
  });

// "2026-05-29" -> "29 May 2026"
function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// stop any stray characters in titles breaking the page
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
