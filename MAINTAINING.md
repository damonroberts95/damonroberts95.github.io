# Maintaining damonroberts.co.uk — handover guide

This document is written for whoever maintains this site next (including
future-me). It assumes you can use git and a terminal, but not that you know
anything about this codebase. Read the **Overview** and **Deploying** sections
first; everything else is reference you can jump to.

---

## 1. Overview

This is a **personal site**: a contact/landing page, an animated background, an
optional "Writing" (blog) section, and a hidden mini-game easter egg.

Key facts that shape everything else:

- **No framework, no build step for the site itself.** It is plain HTML, CSS,
  and vanilla JavaScript. You can open the files and read them top to bottom.
- **Hosted free on GitHub Pages**, served at the custom domain
  **https://damonroberts.co.uk**.
- **Deploy = `git push` to `main`.** A GitHub Action publishes the site. There
  is no separate server to manage.
- The only "build" is a tiny Node script that regenerates the blog index and
  sitemap from the post files — and even that runs automatically in CI.

If you only ever want to **add blog posts**, skip to section 6. If you want to
**change the contact details or text**, section 5. Everything else is for
deeper changes.

---

## 2. Repository map

| Path | What it is |
|------|------------|
| `index.html` | Home page — name, tagline, About, contact links, (hidden) Writing list |
| `styles.css` | All shared styling. **Colours live in the `:root` block at the top.** |
| `app.js` | Builds the post list on the home page; copy-email button; the hidden-game trigger (the "D" of DAMON) |
| `bg.js` | The live "node-network" background animation (home/post pages) |
| `post.html` / `post.css` / `post.js` | Template + styling + loader for viewing a single blog post |
| `posts/` | Your blog posts — one `.md` file per post |
| `posts/index.json` | **Auto-generated** list of posts. Do not edit by hand. |
| `scripts/build-index.mjs` | Regenerates `posts/index.json` **and** `sitemap.xml` from the post files |
| `play.html` / `play.js` | "NODE RUN" — the hidden dodge game (the easter egg) |
| `fonts.css` / `fonts/` | Self-hosted Clash Display + General Sans (`.woff2`). Linked by every page; no CDN. |
| `vendor/marked.min.js` | Self-hosted Markdown parser (v12, MIT) used by `post.js`. Was a CDN script. |
| `404.html` | Custom not-found page |
| `og.png` / `og-card.html` | Social-share preview image, and the HTML used to generate it |
| `favicon.svg` | Site icon (vaporwave gradient) |
| `sitemap.xml` | **Auto-generated** by the build script |
| `robots.txt` | Allows all crawlers; points to the sitemap |
| `CNAME` | Tells GitHub Pages the custom domain is `damonroberts.co.uk`. **Don't delete it** — losing it breaks the domain. |
| `.github/workflows/build-index.yml` | The GitHub Action that builds + deploys on every push |
| `README.md` | Short quick-start (this file is the long version) |

---

## 3. Running it locally

Because the JS uses `fetch()` (for the post list and the game leaderboard),
you **cannot** just double-click `index.html` — `file://` blocks those
requests. Serve it over HTTP from the project folder:

```bash
# any one of these, from the repo root:
python -m http.server 8000        # Python 3
npx serve .                       # Node
php -S localhost:8000             # PHP
```

Then open **http://localhost:8000**. Edit a file, save, refresh. No
compilation, no watch process.

To play the game directly: **http://localhost:8000/play.html** (or click the
**"D" in DAMON** on the home page — see section 8).

---

## 4. Deploying (how the site goes live)

1. You push to the `main` branch.
2. GitHub Actions runs **`.github/workflows/build-index.yml`** ("Build &
   deploy"). It:
   - runs `node scripts/build-index.mjs` (rebuilds `posts/index.json` +
     `sitemap.xml`),
   - uploads the whole folder as a Pages artifact,
   - deploys it to GitHub Pages.
3. ~30–60 seconds later the new version is live.

You can watch a deploy with the GitHub CLI:

```bash
gh run list --limit 3        # see recent runs
gh run watch <run-id>        # follow one to completion
```

**Things to know:**

- **CDN cache.** GitHub Pages sits behind a cache. After a deploy, a hard
  refresh (Ctrl/Cmd-Shift-R) or a cache-busting query (`?x=123`) shows the new
  version immediately; the bare URL may serve the old one for a minute.
- **Enforce HTTPS** is enabled in the repo's Pages settings. Leave it on. If the
  custom domain ever shows "not secure", check **Settings → Pages → Enforce
  HTTPS** and that `CNAME` still contains `damonroberts.co.uk`.
- **Node version warning** in the Action logs ("Node.js 20 is deprecated…") is
  harmless — the actions are forced onto Node 24. Ignore it.
- **Never** hand-edit `posts/index.json` or `sitemap.xml`; the build overwrites
  them. Edit the post `.md` files instead.

---

## 5. Editing the home page content

All in `index.html`:

- **Tagline** — the `<p class="tagline">` under the name.
- **About** — the `<section class="about">` block.
- **Contact links** — search for `mailto:`, the GitHub `href`, and the LinkedIn
  `href`. Email also appears twice: in the `href` and in the copy-button's
  `data-email="…"` attribute — **update both** if the address changes.
- **Name** — the `<h1 class="name">`. Note the first letter is wrapped:
  `<span id="egg">D</span>AMON`. That span is the hidden-game trigger
  (section 8). If you retype the name, keep the `#egg` span on some letter or
  the easter egg disappears.

### Changing colours / theme

Top of `styles.css`, the `:root` block. Every colour is a CSS variable there.
The headline accent is `--grad` (the cyan→purple→pink→orange→yellow sweep).
Change the values once and the whole site (and the game's UI) follows.

---

## 6. Adding a blog post

A post is **one Markdown file** in `posts/`. You never touch the index or
sitemap — CI regenerates them.

1. Create `posts/<slug>.md`. The filename (minus `.md`) becomes the URL slug:
   lowercase, hyphens, no spaces. Example: `posts/why-iiot.md`.

2. Start the file with **front-matter** (between `---` lines), then the body in
   Markdown:

   ```markdown
   ---
   title: Why IIoT matters
   date: 2026-06-15
   summary: One line shown in the post list.
   ---

   Your post body. **Markdown** works: headings, lists, links, code, etc.
   ```

   - `date` is `YYYY-MM-DD`. Posts sort newest-first automatically.
   - `title` / `summary` show in the home-page list; `title` is also the page
     title.

3. Commit and push. The Action rebuilds `posts/index.json` + `sitemap.xml` and
   deploys. The post appears in the list and at
   `https://damonroberts.co.uk/post.html?slug=<slug>`.

To preview the index rebuild locally before pushing:

```bash
node scripts/build-index.mjs        # rewrites posts/index.json + sitemap.xml
```

**How it renders:** `post.html` reads `?slug=` from the URL, fetches
`posts/<slug>.md`, strips the front-matter, and renders the Markdown in the
browser (see `post.js`). There is no server-side rendering.

### The Writing section is currently hidden

The home page's `<section class="writing" … hidden>` has a `hidden` attribute
(see the comment above it in `index.html`). **To show the blog again, delete
the word `hidden` from that tag.** Posts you add while it's hidden still build
fine; they just won't be listed on the home page until you un-hide it. The
individual `post.html?slug=…` URLs work regardless.

---

## 7. The background animation (`bg.js`)

A Canvas2D "node network": drifting dots, links between near ones, occasional
energy pulses, gentle lean toward the cursor, and a click-to-disperse effect.
It's deliberately cheap (fixed node count, squared-distance comparisons, capped
pulses) and honours `prefers-reduced-motion` (renders one static frame).

Tunables are in the `CONFIG` object near the top of `bg.js` (node density,
link distance, colours/palette, speed, pulse rate). The colour wash behind it
is a static CSS gradient in `styles.css` (`body` background), not canvas.

There's also a time-of-day brightness: it dims at night and brightens at
midday by setting CSS variables (`--day`, `--night`, `--glow`).

---

## 8. The hidden game — "NODE RUN" (`play.html` + `play.js`)

An easter-egg dodge game. **You are the cursor;** coloured "ghost" nodes chase
you, form small same-colour clumps, and you grab power-ups and dodge a boss.

**How to reach it:** on the home page, **click the "D" of DAMON** (desktop) or
**drag the "D"** (touch). That's wired in `app.js` (the `#egg` element) and
just navigates to `play.html`. There is no link to it anywhere else — that's
the point.

`play.js` is a single self-contained IIFE. The pieces, roughly top to bottom:

- **Tunable constants** near the top: `LINK_DIST`, `COH_R` (clump cohesion
  range), `GROUP_R`/`SPLIT_SIZE` (when a clump splits), `JOLT_R`/`JOLT_X`
  (anti-clump pop), `STAR_R`, and the point values `GEM_VAL`/`KILL_VAL`/
  `BOSS_VAL`. Tweak these to change feel.
- **`PERSONA`** — six behaviours keyed by node colour, modelled on Pac-Man
  ghosts: chase (Blinky/purple), ambush (Pinky/pink), erratic (Inky/cyan),
  shy (Clyde/orange), scatter (blue), cluster (yellow). Each has `spd`, `acc`,
  `coh` (cohesion), and optionally `split`.
- **Difficulty ramp** — inside `loop()`, the `maxSpeed` / `accel` / `targetCount`
  lines. These climb slowly with elapsed time.
- **`makeAudio()`** — a generative Web Audio engine (no audio files): a
  vaporwave loop whose tempo tracks play speed (slow on the menu, slower on
  death, very slow + an octave down during freeze) plus synth sound-effects.
  `M` mutes.
- **Power-ups:** rainbow star (expanding blast that destroys nodes as the wave
  reaches them), freeze, shield (absorbs one hit, brightens the music while
  held), point gems (with a combo multiplier), and an occasional boss.
- **Rendering / performance:** physics runs one O(n²) pass that also builds the
  link list; nodes are drawn grouped by colour without per-node shadows. If you
  add visual effects, watch the frame cost here.

Scores are time-survived + points, kept as a best in `localStorage` and
submitted to the leaderboard (next section).

---

## 9. The leaderboard (Supabase)

The game has a global leaderboard backed by **Supabase** (a hosted Postgres +
auto-generated REST API). A static site can't keep a write secret, so this uses
the pattern Supabase is designed for: a **public key + Row-Level Security**.

**Where it's configured:** the `LB` object near the top of `play.js`:

```js
const LB = { url: "https://<project>.supabase.co", anonKey: "sb_publishable_…", limit: 10 };
```

- `url` is the project URL; `anonKey` is the **publishable/anon** key. **This
  key is meant to be public** — it's safe in client code and in git. The
  protection is the database's RLS policy, not key secrecy.
- The client reads the top scores (`GET /rest/v1/scores`) and inserts a new one
  (`POST /rest/v1/scores`). That's all it can do.

**The database (set up once in the Supabase SQL editor):**

- A `scores` table: `name`, `score`, `time`, `points`, plus `id`/`created_at`.
- **RLS is on**, with exactly two policies for the anonymous role: **select**
  (read) and **insert** (write, validated: name ≤ 3 chars, score 0–100000).
  There is intentionally **no update or delete** policy, so visitors can't edit
  or wipe scores.
- A **trim trigger** keeps only the top 10 rows after each insert (a
  `SECURITY DEFINER` function, since the anon role itself can't delete).

**Per-mode leaderboards (Classic / Waves / Journey):** the game sends a `mode`
column with each score and filters the board by it (`?mode=eq.<mode>`). For this
to work the `scores` table needs a `mode` column, and the trim trigger must keep
the top 10 **per mode** (not 10 rows total). Run once in the SQL editor:

```sql
-- 1. add the column (existing rows default to 'classic')
alter table public.scores add column if not exists mode text not null default 'classic';

-- 2. trim trigger: keep only the top 10 rows for the inserted row's mode
create or replace function public.trim_scores() returns trigger
language plpgsql security definer as $$
begin
  delete from public.scores s
  where s.mode = new.mode
    and s.id not in (
      select id from public.scores
      where mode = new.mode
      order by score desc
      limit 10
    );
  return null;
end; $$;

drop trigger if exists trim_scores_trg on public.scores;
create trigger trim_scores_trg after insert on public.scores
for each row execute function public.trim_scores();
```

Old scores (from before modes) keep `mode = 'classic'`, so they stay on the
Classic board. The insert RLS policy still applies; `mode` is a plain text value.

**To moderate / reset scores:** use the Supabase dashboard → Table Editor →
`scores`. Deleting a row there is the only way to remove a bad entry (the public
key can't delete by design).

**Security notes (important):**
- Never put the **`service_role`** key in the client or repo — it bypasses RLS.
  Only the `anon`/publishable key belongs in `play.js`.
- The Data API exposes **every table in the `public` schema**. If you add more
  tables, enable RLS on them or they're world-readable via the anon key.
- There's no anti-cheat — anyone can read the key and POST a score. That's
  acceptable for a hobby leaderboard. If it gets abused, add rate-limiting or
  move writes behind a serverless function.

To turn the leaderboard **off**, blank out `LB.url` in `play.js` — the board
then shows "leaderboard not set up" and the submit button no-ops.

---

## 10. SEO / sharing assets

- **`sitemap.xml`** — auto-generated by the build script (home page + every
  post). Referenced from `robots.txt`.
- **`robots.txt`** — allows all crawlers.
- **Open Graph / Twitter cards** — `<meta property="og:…">` tags in
  `index.html`. The preview image is **`og.png`**; `og-card.html` is the HTML
  template it was screenshotted from (re-screenshot it at 1200×630 if you
  redesign the card).
- **`favicon.svg`** — the tab icon.
- **Canonical URL** and **`theme-color`** are set in each page's `<head>`.

---

## 11. The `darkreader-lock` meta tag

Every page's `<head>` has `<meta name="darkreader-lock" />`. This tells the
Dark Reader browser extension to leave the site alone (the site is already
dark; without this, Dark Reader double-darkens it and the colours look wrong).
Keep it on new pages.

---

## 12. Common tasks — cheat sheet

| I want to… | Do this |
|------------|---------|
| Add a blog post | Add `posts/<slug>.md` with front-matter, push (section 6) |
| Show the blog again | Remove `hidden` from `<section class="writing">` in `index.html` |
| Change a colour | Edit the `:root` variables in `styles.css` |
| Change email / links | Edit `index.html` (update the copy button's `data-email` too) |
| Tweak the game | Edit the constants / `PERSONA` near the top of `play.js` |
| Moderate leaderboard | Supabase dashboard → Table Editor → `scores` |
| Run it locally | `python -m http.server 8000`, open localhost:8000 |
| Rebuild index locally | `node scripts/build-index.mjs` |
| Deploy | `git push` to `main` (Action does the rest) |
| Watch a deploy | `gh run watch <id>` |

---

## 13. Troubleshooting

- **Change didn't appear after deploy** → CDN cache. Hard refresh, or append
  `?x=1` to the URL. Confirm the Action actually succeeded (`gh run list`).
- **"Not secure" on the domain** → check Settings → Pages → Enforce HTTPS, and
  that `CNAME` still says `damonroberts.co.uk`.
- **Post not showing** → is the Writing section still `hidden`? Did the build
  Action run? Is the front-matter well-formed (the `---` fences and a `date:`)?
- **Leaderboard says "unavailable"** → check the Supabase project is up and the
  `LB.url`/`anonKey` in `play.js` are correct; check the browser console for a
  CORS/RLS error.
- **Game won't start / silent** → audio needs a user gesture; it unlocks on the
  Start click. A browser permission popup on page load is **not** from this site
  (it requests no device permissions — verified) — it's the browser or an
  extension.
- **Fonts look wrong** → they are **self-hosted** (Clash Display, General Sans)
  as `.woff2` files in `fonts/`, declared in `fonts.css` (linked by every page).
  No CDN dependency. If a font fails the site falls back to system fonts. To
  update a weight, drop a new `.woff2` in `fonts/` and point `fonts.css` at it.

---

## 14. Conventions when changing code

- Keep it dependency-free and build-step-free for the site. The whole appeal is
  that it's readable plain files on a CDN.
- Match the existing style: small, commented modules; colours via CSS
  variables; behaviour tunable via named constants at the top of a file.
- Test locally over HTTP before pushing (don't rely on `file://`).
- Commit messages: short imperative subject, body explaining *why* when it
  isn't obvious.
