# prpack-demo

A pure-static browser demo of [prpack](https://github.com/Lucas2944/prpack). Paste a public GitHub pull request URL; the page calls the GitHub REST API directly and assembles a single markdown file containing the commit list, the per-file diff, and the full post-change content of every touched file. Copy or download the file and drop it into Claude / Cursor / your model of choice.

**Live:** https://lucas2944.github.io/prpack-demo/

## How it works

Pure HTML + ES modules + the browser's `fetch`. No server, no API key, no analytics, no telemetry. All requests go to `api.github.com` from the user's browser using GitHub's unauthenticated REST endpoints (rate-limited to 60 req/hour per IP, which covers ~10 small PRs).

## Run it locally

```sh
git clone https://github.com/Lucas2944/prpack-demo.git
cd prpack-demo
python3 -m http.server 8000   # or any static file server
open http://localhost:8000
```

## Deploy your own copy

It's static. Drop the two files (`index.html`, `pack.js`) anywhere that serves static HTML — GitHub Pages, Vercel, Netlify, Cloudflare Pages, S3, your own server.

## Caveats

- Works on **public** GitHub PRs only. The unauthenticated GitHub API can't read private repos.
- Skips files marked binary by extension.
- Skips files larger than 200 KB (the same default as the CLI).
- Doesn't fetch adjacent non-changed test files (the CLI does, when given a local repo).

## Why a browser demo?

Because the easiest way to evaluate a CLI is to not have to install it. Paste a URL, see the output, decide whether you want the tool in your workflow.

## Related

- [prpack](https://github.com/Lucas2944/prpack) — the CLI itself (MIT).
- [prpack-action](https://github.com/Lucas2944/prpack-action) — GitHub Action that runs prpack on every PR.
- [Pro Pack](https://scottthurman89.itch.io/prpack) — four curated review-style presets + a workflow guide, free or pay-what-you-want.
- [Article: Your LLM code reviewer is reading half the file](https://scottthurman.hashnode.dev/your-llm-code-reviewer-is-reading-half-the-file)

## License

MIT.
