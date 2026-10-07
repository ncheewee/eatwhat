# EatWhat

A PWA that helps you decide what to eat in 30 seconds — solo or with others,
grounded in real nearby restaurant data and the MICHELIN Guide Singapore.

You can also spoon a place from 1 to 3. Other people's spoons show up beside
the EatWhat shortlist when you search. The two lists stay separate. You choose.

- `index.html` — the frontend PWA (single file, served via GitHub Pages)
- `worker/` — the Cloudflare Worker backend (Google Places + curated MICHELIN
  matching + KV caching). See `worker/README.md` to deploy your own.

Live app: https://ncheewee.github.io/eatwhat/
API: https://eatwhat-api.ncheewee.workers.dev
