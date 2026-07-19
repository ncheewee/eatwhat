# EatWhat

A PWA that helps you decide what to eat in 30 seconds — solo or with others,
grounded in real nearby restaurant data and the MICHELIN Guide Singapore.

- `index.html` — the frontend PWA (single file, served via GitHub Pages)
- `worker/` — the Cloudflare Worker backend (Google Places + curated MICHELIN
  matching + KV caching). See `worker/README.md` to deploy your own.

Live app: https://ncheewee.github.io/eatwhat/
API: https://eatwhat-api.ncheewee.workers.dev
