# EatWhat API — Cloudflare Worker

Backend for the EatWhat PWA. Takes location + budget + radius, calls Google
Places for real nearby venues, calls Gemini (with Google Search grounding) to
tag Michelin/trending/reviewed status, ranks the results, and caches the
merged shortlist in KV for 12h so repeat searches in the same area are free
and instant.

## Prerequisites

- A Cloudflare account (you have one) and Node.js installed locally.
- A **Google Cloud project** with the **Places API (New)** enabled, and an API key.
  https://console.cloud.google.com/apis/library/places-backend.googleapis.com
- A **Gemini API key** from Google AI Studio (free tier): https://aistudio.google.com/apikey

## Setup

Run these from this folder (`eatwhat-worker/`), on your own machine — this
needs your Cloudflare login, which isn't available in this chat session.

```bash
npm install -g wrangler        # if you don't have it already
wrangler login                 # opens a browser to authorize your account

# 1. Create the KV namespace used for caching
wrangler kv namespace create SEARCH_CACHE
# ^ copy the "id" it prints, then paste it into wrangler.toml
#   under [[kv_namespaces]] -> id = "..."

# 2. Set your two API keys as secrets (never committed to code)
wrangler secret put GOOGLE_PLACES_API_KEY
wrangler secret put GEMINI_API_KEY

# 3. Deploy
wrangler deploy
```

Wrangler will print a URL like `https://eatwhat-api.<your-subdomain>.workers.dev`.
That's the endpoint the frontend calls.

## API

```
POST /api/search
Content-Type: application/json

{
  "lat": 1.2769,
  "lng": 103.8459,
  "radiusKm": 2,
  "budget": "$$",     // "any" | "$" | "$$" | "$$$"
  "partySize": 2
}
```

Response:

```json
{
  "pool": [
    { "name": "...", "emoji": "🍜", "source": "trend|michelin|reviews",
      "win": true, "tags": ["Trending"], "meta": "4.6 · 0.4km · $$ · Open now",
      "why": "short reason" },
    ...
  ]
}
```

If either API key is missing or a call fails, it returns `{ "pool": [...], "mock": true }`
with demo data instead of erroring — the frontend can check `mock` and show a
subtle "demo data" indicator if you want.

## Costs at MVP scale

- Places API: 5,000 free calls/month, then ~$32/1,000 (Text/Nearby Search Pro SKU).
- Gemini grounding: ~1,500 requests/day free on Flash, 5,000 grounded prompts/month free, then ~$14/1,000.
- The 12h KV cache means repeat searches in the same neighborhood/budget don't
  re-hit either API, so real usage should stay well inside both free tiers
  until you have meaningful daily active users.

## Local testing without deploying

```bash
wrangler dev
```

This runs the worker on `http://localhost:8787` with the same secrets, so you
can point the frontend at that during development before deploying.
