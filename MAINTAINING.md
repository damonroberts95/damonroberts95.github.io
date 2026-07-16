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
| `play.html` / `play.js` | "NODE RUN" — the unlinked dodge game (easter egg, but indexable). Deep-dived in `GAME.md`. |
| `GAME.md` | Full internals reference for the game (`play.js`). Read it before changing the game. |
| `audio/vo/` | Pre-rendered announcer clips (`<slug>.wav`) + `manifest.json`. **Generated** — see below. |
| `scripts/gen-voiceovers.ps1` | Renders the announcer voiceover clips via Windows SAPI. Phrase tables mirror `say(...)` in `play.js`; re-run after changing spoken lines. |
| `scripts/leaderboard-rls.sql` | Supabase RLS + rate-limit/validation trigger for the leaderboard (run once in the SQL editor). See §9. |
| `scripts/keepalive-table.sql` | Tiny `keepalive` table + policies the cron below writes to (run once in the SQL editor). See §9. |
| `.github/workflows/keepalive.yml` | Cron (every 3 days) that pings Supabase so the free-tier project doesn't auto-pause. See §9. |
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

An easter-egg arcade game. **You are the cursor;** coloured nodes chase you per
their colour's personality, clump with their own colour, and string lethal "web"
lines between near neighbours. Power-ups, bosses, five play modes, generative
music, a global leaderboard, and an ambient idle/screensaver mode.

**How to reach it:** on the home page, **click the "D" of DAMON** (desktop) or
**drag the "D"** (touch). That's wired in `app.js` (the `#egg` element) and just
navigates to `play.html`. There is no link to it anywhere else — that's the point.
(The stale comment at the top of `play.js` mentioning "the O in ROBERTS" is wrong;
it's the D.)

`play.js` is a single self-contained IIFE, ~3,200 lines, no dependencies. It is the
most complex part of the site and has its **own full reference doc:**

> ### 📖 See **[GAME.md](GAME.md)** for the complete game internals
> — architecture, the five modes (Classic / Waves / Journey / Bullet Hell / Idle),
> node personalities & physics, biomes & background patterns, the Web-Audio music
> engine, power-ups & bosses, the idle/screensaver, performance notes, a tunables
> cheat-sheet, and a "how do I…" cookbook.

The essentials:

- **Modes:** Classic (endless), Waves (themed, bosses), Journey (8 scripted levels
  + win screen), Bullet Hell (desktop WASD shooter), and **Idle** (a small button →
  invincible ambient screensaver with song-structured music).
- **Tunables:** constants near the top of `play.js` (lines ~52–67); per-colour feel
  in `PERSONA`; per-biome music in `PROFILES`; the difficulty/spawn block in `loop()`.
- **`makeAudio()`** — generative Web Audio (no files); a vaporwave loop, a Wipeout-
  style arena track, and a full song for idle. `M` mutes.
- **Leaderboard** — Supabase, per-mode, shown on both the game-over and journey-win
  panels (see §9).
- **Performance** — a pooled spatial grid keeps the physics near O(n); nodes are
  batch-drawn per colour without per-node shadow. Keep new effects off the per-node
  path. (Details + gotchas in GAME.md.)

Scores are time-survived + points, kept as a best in `localStorage` and submitted to
the leaderboard (next section).

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
- There's no anti-cheat — anyone can read the key and POST a score. For basic
  abuse protection, **`scripts/leaderboard-rls.sql`** adds a `BEFORE INSERT` trigger
  (`enforce_score_insert`) that rate-limits per client IP (15s cooldown + 8/hr,
  logged in a `submit_log` table) and validates fields (name shape, numeric bounds,
  allowed mode). It coexists with the `trim_scores` AFTER INSERT trigger above —
  different name, different timing. It manages policies named `scores_read` /
  `scores_insert`; if your existing policies have other names, drop those first so
  you don't end up with duplicate permissive policies. IP comes from the **last**
  `x-forwarded-for` hop (the trusted-proxy one; the leftmost is client-spoofable).
  This is best-effort (CGNAT shares IPs) — for airtight limits move writes behind a
  serverless/Edge function with the `service_role` key. The client also self-limits
  (`lbRateBlock` in `play.js`), but that's only a courtesy; the DB trigger is the
  real gate.

To turn the leaderboard **off**, blank out `LB.url` in `play.js` — the board
then shows "leaderboard not set up" and the submit button no-ops.

**Keeping the free Supabase project alive:** Supabase auto-pauses free-tier
projects after **7 days with no API requests**. A site with low traffic can
easily go quiet that long, which would silently kill the leaderboard.
`.github/workflows/keepalive.yml` runs 1–3 times a day (2 on average) at
jittered times — one anchor slot (04:17 UTC) always fires, two optional
slots each fire ~50% of days, and every scheduled run sleeps a random
0–50 minutes first, so the pings don't look like a metronome. Each ping:

1. `GET`s the scores board (a normal read). If the read fails (a paused
   project loses its DNS entirely, so the symptom is
   `Could not resolve host`), the workflow **self-heals**: it calls the
   Supabase Management API to restore the project and polls until the API
   answers again (up to 20 min). This needs the `SUPABASE_ACCESS_TOKEN`
   repo secret — a personal access token created at
   supabase.com/dashboard/account/tokens, added with
   `gh secret set SUPABASE_ACCESS_TOKEN`. Without it the run fails loudly
   with instructions instead of restoring.
2. Upserts the single row in a dedicated `keepalive` table (a **write** —
   stronger evidence of activity than a read, and it doubles as a smoke test
   that insert/RLS still works). Table + policies live in
   `scripts/keepalive-table.sql` — run it once in the SQL editor, same as
   `leaderboard-rls.sql`. It never touches the public `scores` table.
3. Commits an updated timestamp file back to the repo — but only when the
   last push is more than 7 days old, so the daily runs don't fill the
   history with keepalive commits.

Step 3 is there for a separate reason: GitHub disables **scheduled**
workflows after 60 days with no *repository* activity (pushes) — even one
that has been firing correctly on schedule the whole time doesn't count.
An occasional commit resets that clock, so the workflow keeps re-enabling
itself indefinitely without you needing to touch it.

Caveat learned the hard way (July 2026): pings only *prevent* a pause — once
Supabase has already **scheduled** a pause (it emails a "will be paused on
<date>" warning after a quiet week), later API traffic doesn't reliably
cancel it, and a paused project can only be un-paused via the dashboard or
the Management API. That's exactly what the self-heal step is for.

If you ever migrate off Supabase, delete both files and the workflow.

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

---

## 15. Code reference — file by file

The game (`play.js`) has its own document: **[GAME.md](GAME.md)**. Here's the rest of
the JavaScript.

### `app.js` (home page only)

Three jobs, each a small IIFE:

1. **Footer year** — fills `#year` with the current year.
2. **Copy-email button** (`#copy-email`) — on click, `navigator.clipboard.writeText`
   of its `data-email`, shows the `#toast` for 2 s; falls back to a `mailto:` link if
   the clipboard is blocked. **If you change the email, update `data-email` AND the
   visible `mailto:` href in `index.html`.**
3. **Easter-egg trigger** (`#egg`, the "D") — click (desktop) or drag >46 px / tap
   <8 px (touch) navigates to `play.html`. Uses pointer capture; a
   `lostpointercapture` handler springs the letter back if the gesture is dropped. It
   also shimmers two random palette colours via the CSS vars `--egg-c1/--egg-c2` on
   each animation iteration.
4. **Posts list** — fetches `posts/index.json`, sorts newest-first, renders `<li>`s
   into `#posts` (the Writing section, currently `hidden`). Titles/summaries are
   HTML-escaped (`escapeHtml`); dates formatted en-GB (`formatDate`).

All DOM hooks are optional (guarded), so `app.js` is safe to load on a page missing
any of them.

### `bg.js` (home, 404, and play pages)

1. **Time-of-day wash** — runs on every page that loads it (even without the canvas).
   `clockDaylight()` is a sine peaking at noon, zero at 06:00/18:00; `applyDaylight()`
   writes CSS vars `--day / --night / --glow / --grain` on `:root` (re-applied every
   5 min). `styles.css` uses these to brighten/dim the page.
2. **Node-network canvas** — only if `<canvas id="bg">` exists (home/404; **not**
   visible on `play.html`, which draws its own background). Drifting nodes, links
   between near ones (squared-distance, O(n²) over a small capped count), energy
   pulses travelling links, gentle cursor pull, click-to-disperse, anti-clump
   repulsion. All knobs are in the `CONFIG` object near the top (density, link
   distance, palette, speed, pulse rate). Honours `prefers-reduced-motion` (renders
   one static frame, no interaction). DPR capped at 1.5.

### `post.js` (single-post page)

Reads `?slug=` (validated against `/^[a-z0-9-]+$/i`), fetches `posts/<slug>.md`,
splits front-matter from body with a regex, renders the body via the self-hosted
`marked.parse` (`vendor/marked.min.js`), and injects it into `#article` (title + date
escaped; body is trusted repo markdown). Missing/invalid slug or fetch error →
`showError("Post not found.")`. Sets `document.title` and the footer year.

### `scripts/build-index.mjs` (build step, CI only)

Node ES-module run by the GitHub Action. Scans `posts/*.md`, parses front-matter
(`title`/`date`/`summary`), writes **`posts/index.json`** (array, newest-first) and
**`sitemap.xml`** (home stamped today + each post stamped with its `date`). Never edit
those two outputs by hand — they're regenerated every deploy. Run locally with
`node scripts/build-index.mjs` to preview.

### Gotchas worth repeating

- **Slugs must be kebab-case lowercase** (`a-z0-9-`). GitHub Pages serves on Linux
  (case-sensitive); a `Hello-World.md` file won't be found by a `hello-world` fetch.
- **`.nojekyll`** must stay — it stops GitHub Pages running Jekyll over these raw
  files. **`CNAME`** must stay — losing it breaks the custom domain.
- Posts are published the moment their `.md` is pushed; there's no draft state. Delete
  the file to unpublish (the next build drops it from the index + sitemap).
