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
| `posts/`          | Your posts live here (one `.md` per post + `index.json`) |
| `CNAME`           | Tells GitHub Pages the custom domain                  |

## Things to fill in (currently placeholders)

Open `index.html` and replace:

- `EMAIL_PLACEHOLDER`     → your email address (appears twice)
- `LINKEDIN_PLACEHOLDER`  → your LinkedIn URL
- `TAGLINE_PLACEHOLDER`   → one-line tagline (appears 3 times: title, og, hero)

Tip: use your editor's Find & Replace for each placeholder.

## Change the colours

Top of `styles.css`, the `:root` block. The `--grad` line is the
purple → pink → orange accent. Swap the colours there and everything updates.

## Add a new post

1. Create a file `posts/my-slug.md` and write it in Markdown.
2. Add an entry to `posts/index.json`:

   ```json
   {
     "slug": "my-slug",
     "title": "My post title",
     "date": "2026-06-01",
     "summary": "One line shown in the list."
   }
   ```

   - `slug` must match the filename (without `.md`).
   - `date` is `YYYY-MM-DD`. Newest sorts to the top automatically.

3. Commit + push. Done.

## Run locally

Markdown posts are fetched over HTTP, so opening the file directly
(`file://`) won't load them. Run a tiny local server instead:

```powershell
# from this folder, with Python installed:
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy (GitHub Pages)

1. Push this folder to a GitHub repo.
2. Repo → **Settings → Pages** → Source = `main` branch, `/ (root)`.
3. Custom domain = `damonroberts.co.uk` (the `CNAME` file already sets this).
4. Add DNS records at Porkbun (see below), then tick **Enforce HTTPS**.

### DNS at Porkbun

```
A      @     185.199.108.153
A      @     185.199.109.153
A      @     185.199.110.153
A      @     185.199.111.153
CNAME  www   damonroberts95.github.io
```
