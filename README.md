# damonroberts.co.uk

Personal contact site + occasional writing. Plain HTML/CSS/JS — no build step,
no framework. Hosted free on GitHub Pages.

## Files

| File              | What it is                                            |
|-------------------|-------------------------------------------------------|
| `index.html`      | Home page — name, tagline, contact links, post list   |
| `styles.css`      | All shared styling (colours live at the top)          |
| `app.js`          | Builds the post list on the home page                 |
| `post.html`       | Template for viewing a single post                    |
| `post.css`        | Styling for the single-post page                      |
| `post.js`         | Loads + renders a post's Markdown                      |
| `bg.js`           | Live node-network background animation                |
| `posts/`          | Your posts live here — one `.md` per post             |
| `posts/index.json`| Auto-generated post list (don't edit by hand)         |
| `scripts/`        | `build-index.mjs` — rebuilds the post list            |
| `.github/`        | GitHub Action that builds + deploys on push           |
| `CNAME`           | Tells GitHub Pages the custom domain                  |

## Still to fill in

- **LinkedIn link** — in `index.html` there's a commented-out LinkedIn block
  (search for `LinkedIn`). Paste your real profile URL and remove the `<!-- -->`
  comment markers to show it.

Email, tagline and focus chips are already set — edit the text in `index.html`
any time.

## Change the colours

Top of `styles.css`, the `:root` block. The `--grad` line is the
purple → pink → orange accent. Swap the colours there and everything updates.

## Add a new post (one file)

1. Create one file: `posts/my-slug.md`. Start it with front-matter, then write
   the body in Markdown:

   ```markdown
   ---
   title: My post title
   date: 2026-06-01
   summary: One line shown in the list.
   ---

   Your post body starts here. **Markdown** works.
   ```

   - The filename (without `.md`) is the URL slug — keep it lowercase, no spaces.
   - `date` is `YYYY-MM-DD`. Newest sorts to the top automatically.

2. Commit + push. That's it.

You do **not** touch `posts/index.json` — a GitHub Action
(`.github/workflows/build-index.yml`) rebuilds it from your post files on every
push. To rebuild it locally too: `node scripts/build-index.mjs`.

## Run locally

Markdown posts are fetched over HTTP, so opening the file directly
(`file://`) won't load them. Run a tiny local server instead:

```powershell
# from this folder, with Python installed:
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy (GitHub Pages)

Deployment is automatic: pushing to `main` runs the
`.github/workflows/build-index.yml` workflow, which rebuilds the post index and
publishes the site. Repo → **Settings → Pages** → Source = **GitHub Actions**.

Custom domain `damonroberts.co.uk` is set by the `CNAME` file. After the DNS
records below are live, tick **Enforce HTTPS** in the Pages settings.

### DNS at Porkbun

```
A      @     185.199.108.153
A      @     185.199.109.153
A      @     185.199.110.153
A      @     185.199.111.153
CNAME  www   damonroberts95.github.io
```
