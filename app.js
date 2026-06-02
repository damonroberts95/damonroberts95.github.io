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

// ---- copy-email button + toast ----
(function () {
  const btn = document.getElementById("copy-email");
  const toast = document.getElementById("toast");
  if (!btn) return;
  let timer;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove("is-visible"), 2000);
  }
  btn.addEventListener("click", async () => {
    const email = btn.dataset.email;
    try {
      await navigator.clipboard.writeText(email);
      showToast("Email copied ✓");
    } catch {
      window.location.href = "mailto:" + email; // fallback if clipboard blocked
    }
  });
})();

// ---- hidden easter egg: the "D" of DAMON launches NODE RUN ----
// desktop: click it. touch: drag it around (or tap).
(function () {
  const egg = document.getElementById("egg");
  if (!egg) return;
  // randomise the shimmer band colours (within the page's vaporwave palette) each cycle
  // tuned to the page's vaporwave-sunset background (see body bg in styles.css)
  const EGG_PALETTE = ["#fff069", "#ff8c46", "#ff56c8", "#b45af6", "#78c4ff", "#22d3ee"];
  const randColors = () => {
    const i = Math.floor(Math.random() * EGG_PALETTE.length);
    let j = Math.floor(Math.random() * EGG_PALETTE.length);
    if (j === i) j = (j + 1) % EGG_PALETTE.length;
    egg.style.setProperty("--egg-c1", EGG_PALETTE[i]);
    egg.style.setProperty("--egg-c2", EGG_PALETTE[j]);
  };
  randColors();
  egg.addEventListener("animationiteration", randColors);
  const go = () => { window.location.href = "play.html"; };
  let dragging = false, sx = 0, sy = 0, moved = 0;

  egg.addEventListener("click", go); // mouse / keyboard-ish

  egg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return; // mouse handled by click
    dragging = true; moved = 0; sx = e.clientX; sy = e.clientY;
    egg.setPointerCapture(e.pointerId);
    egg.style.transition = "none";
  });
  egg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    moved = Math.hypot(dx, dy);
    egg.style.transform = `translate(${dx}px, ${dy}px)`;
    if (moved > 46) { dragging = false; go(); } // dragged far enough → launch
  });
  const spring = () => { egg.style.transition = "transform .25s ease"; egg.style.transform = ""; };
  egg.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    spring();
    if (moved < 8) go(); // a tap counts too
  });
  // gesture cancelled / capture lost → still spring the D back (was getting stuck)
  egg.addEventListener("pointercancel", () => { if (dragging) { dragging = false; spring(); } });
  egg.addEventListener("lostpointercapture", () => { if (dragging) { dragging = false; spring(); } });
})();

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
