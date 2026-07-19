/**
 * EatWhat API — Cloudflare Worker
 *
 * POST /api/search
 * body: { lat, lng, radiusKm, budget ("any"|"$"|"$$"|"$$$"), partySize }
 *
 * Pipeline:
 *   1. Google Places API (New) — Nearby Search → real venues, ratings, distance, open-now
 *   2. Gemini (grounded with Google Search) — tags venues as Michelin / trending / reviewed-by
 *   3. Rank + merge → top ~8 candidates, top 4 flagged as winners
 *   4. Cache the merged result per (rounded location + budget + radius) in KV for 12h
 *
 * If GOOGLE_PLACES_API_KEY or GEMINI_API_KEY are missing, or either call fails,
 * falls back to demo data so the frontend never hard-breaks.
 */

import { buildMichelinIndex, lookupMichelin } from "./michelin.js";

const CACHE_TTL_SECONDS = 60 * 60 * 12; // 12h — Michelin/trending data doesn't move fast
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/search" || request.method !== "POST") {
      return json({ error: "Not found. POST /api/search" }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const radiusKm = Number(body.radiusKm) || 2;
    const budget = body.budget || "any";
    const partySize = Number(body.partySize) || 2;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: "lat/lng required" }, 400);
    }

    const cacheKey = `search:${lat.toFixed(2)}:${lng.toFixed(2)}:${radiusKm}:${budget}`;

    if (env.SEARCH_CACHE) {
      const cached = await env.SEARCH_CACHE.get(cacheKey, "json");
      if (cached) {
        return json({ ...cached, cached: true });
      }
    }

    let result;
    try {
      result = await runPipeline({ lat, lng, radiusKm, budget, partySize, env });
    } catch (err) {
      result = { pool: MOCK_POOL, mock: true, error: String(err) };
    }

    if (env.SEARCH_CACHE && !result.mock) {
      ctx.waitUntil(
        env.SEARCH_CACHE.put(cacheKey, JSON.stringify(result), {
          expirationTtl: CACHE_TTL_SECONDS,
        })
      );
    }

    return json(result);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function runPipeline({ lat, lng, radiusKm, budget, partySize, env }) {
  if (!env.GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set");

  const venues = await fetchNearbyPlaces({ lat, lng, radiusKm, budget, apiKey: env.GOOGLE_PLACES_API_KEY });
  if (!venues.length) return { pool: MOCK_POOL, mock: true, error: "No venues found nearby" };

  const shortlist = venues.slice(0, 20);

  // MICHELIN tagging — curated list, no API call, no cost, no hallucination.
  // Reads a KV override first (so the list can be refreshed without redeploying),
  // falling back to the embedded 2025 seed.
  let michelinData = null;
  if (env.SEARCH_CACHE) {
    try {
      michelinData = await env.SEARCH_CACHE.get("michelin:list", "json");
    } catch { /* fall through to embedded seed */ }
  }
  const michelin = buildMichelinIndex(michelinData);

  // Optional: grounded "trending" tags via Gemini. Disabled by default because
  // Search grounding requires a paid/prepay Gemini project. Set ENABLE_GROUNDING="true"
  // once billing is in place to switch it on.
  let hypeTags = {};
  if (env.ENABLE_GROUNDING === "true" && env.GEMINI_API_KEY) {
    try {
      hypeTags = await fetchHypeTags({ venues: shortlist.slice(0, 15), apiKey: env.GEMINI_API_KEY });
    } catch {
      hypeTags = {}; // best-effort — never fail the request over this
    }
  }

  const merged = shortlist.map((v) =>
    mergeVenue(v, hypeTags[v.name.toLowerCase()], lookupMichelin(v.name, michelin))
  );
  const ranked = rankVenues(merged);
  const pool = ranked.slice(0, 8).map((v, i) => ({ ...v, win: i < 4 }));

  return { pool, guideYear: michelin.year };
}

// ---------- Google Places API (New) ----------

const PRICE_MAP = {
  "$": "PRICE_LEVEL_INEXPENSIVE",
  "$$": "PRICE_LEVEL_MODERATE",
  "$$$": "PRICE_LEVEL_EXPENSIVE",
};

async function fetchNearbyPlaces({ lat, lng, radiusKm, budget, apiKey }) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
        "places.location",
        "places.currentOpeningHours.openNow",
        "places.primaryType",
        "places.types",
      ].join(","),
    },
    body: JSON.stringify({
      includedTypes: ["restaurant"],
      maxResultCount: 20,
      rankPreference: "POPULARITY",
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusKm * 1000, 50000) },
      },
    }),
  });

  if (!res.ok) throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const places = data.places || [];

  const EXCLUDED_TYPES = /lodging|hotel|resort|shopping_mall|tourist_attraction|casino/i;

  return places
    // Places tags big hotels/malls as "restaurant" — they crowd out actual eateries
    .filter((p) => !EXCLUDED_TYPES.test((p.types || []).join(" ")))
    .filter((p) => budget === "any" || !p.priceLevel || p.priceLevel === PRICE_MAP[budget])
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text || "Unnamed",
      rating: p.rating || 0,
      reviewCount: p.userRatingCount || 0,
      priceLevel: p.priceLevel || "PRICE_LEVEL_UNSPECIFIED",
      priceSymbol: symbolForPriceLevel(p.priceLevel),
      openNow: p.currentOpeningHours?.openNow ?? null,
      distanceKm: haversineKm(lat, lng, p.location?.latitude, p.location?.longitude),
      primaryType: p.primaryType || "restaurant",
      emoji: emojiForType(p.primaryType, p.types),
    }));
}

function symbolForPriceLevel(level) {
  return { PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" }[level] || "$$";
}

function emojiForType(primaryType = "", types = []) {
  const all = [primaryType, ...types].join(" ").toLowerCase();
  const map = [
    [/ramen|noodle/, "🍜"], [/sushi|japanese/, "🍣"], [/curry|indian/, "🍛"],
    [/salad|vegetarian|vegan/, "🥗"], [/cafe|coffee/, "☕"], [/burger|american/, "🍔"],
    [/pizza|italian/, "🍕"], [/hawker|food_court/, "🥘"], [/dumpling|chinese/, "🥟"],
    [/bbq|grill|steak/, "🍢"], [/seafood/, "🦐"],
  ];
  for (const [re, emoji] of map) if (re.test(all)) return emoji;
  return "🍽️";
}

function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat2 == null || lon2 == null) return null;
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

// ---------- Gemini (grounded hype tagging) ----------

async function fetchHypeTags({ venues, apiKey }) {
  const names = venues.map((v) => v.name).join(", ");
  const prompt = `You have access to Google Search. For each of these Singapore restaurants — ${names} —
check whether it is: (a) listed in the Michelin Guide Singapore 2026 (stars or Bib Gourmand),
(b) currently trending on social media (TikTok/Instagram/Xiaohongshu) in the last 1-2 months,
(c) recently reviewed by a known SG food reviewer, blog, or YouTube channel.
Only mark true if you find real supporting evidence with a source. Respond with ONLY a JSON array,
no prose, no markdown fences, in this exact shape:
[{"name":"<exact name>","michelin":false,"trending":false,"reviewedBy":null,"sourceUrl":null,"why":"<max 6 words>"}]`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" + apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "[]";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return {};

  let arr;
  try {
    arr = JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }

  const out = {};
  for (const item of arr) {
    if (item?.name) out[item.name.toLowerCase()] = item;
  }
  return out;
}

// ---------- Merge + rank ----------

function mergeVenue(v, hype, mich) {
  const tags = [];
  let source = "reviews";

  // Curated MICHELIN tier takes priority — it's verified data, not inferred
  if (mich) {
    tags.push(mich.label);
    if (mich.green) tags.push("Green Star");
    source = "michelin";
  }
  if (hype?.trending) { tags.push("Trending"); if (!mich) source = "trend"; }
  if (hype?.reviewedBy) tags.push(`@${hype.reviewedBy}`);
  if (!tags.length) tags.push(v.openNow ? "Open now" : "Nearby");

  const metaParts = [v.rating ? v.rating.toFixed(1) : "—", v.distanceKm != null ? `${v.distanceKm}km` : "—", v.priceSymbol];
  if (v.openNow != null) metaParts.push(v.openNow ? "Open now" : "Closed now");

  return {
    name: v.name,
    emoji: v.emoji,
    source,
    tags,
    meta: metaParts.join(" · "),
    why: michWhy(mich, v) || hype?.why || (v.openNow ? "Nearby and open now" : "Well rated nearby"),
    _score: scoreVenue(v, hype, mich),
  };
}

function michWhy(mich, v) {
  if (!mich) return null;
  const near = v.distanceKm != null ? ` · ${v.distanceKm}km away` : "";
  const map = {
    three_star: "Three MICHELIN stars",
    two_star: "Two MICHELIN stars",
    one_star: "MICHELIN starred",
    bib_gourmand: "Bib Gourmand · great value",
    selected: "In the MICHELIN Guide",
  };
  return (map[mich.tier] || "In the MICHELIN Guide") + near;
}

function scoreVenue(v, hype, mich) {
  let score = (v.rating || 0) * Math.log10((v.reviewCount || 1) + 1);
  if (mich) score += mich.weight; // 10/9/8 stars, 6 bib, 3 selected
  if (hype?.trending) score += 4;
  if (hype?.reviewedBy) score += 2;
  if (v.distanceKm != null) score -= v.distanceKm * 0.8;
  if (v.openNow === false) score -= 3;
  return score;
}

function rankVenues(venues) {
  return [...venues].sort((a, b) => b._score - a._score).map(({ _score, ...v }) => v);
}

// ---------- Fallback demo data (used if keys are missing or calls fail) ----------

const MOCK_POOL = [
  { name: "Nama Ramen Bar", emoji: "🍜", source: "trend", win: true, tags: ["Trending", "@makanmakan"], meta: "4.6 · 0.4km · $$ · Till 10pm", why: "Trending this week · 0.4km away" },
  { name: "Curry House 88", emoji: "🍛", source: "michelin", win: true, tags: ["Michelin 2026"], meta: "4.5 · 0.9km · $$ · Till 9:30pm", why: "Michelin-selected · fits your budget" },
  { name: "Sakura Sushi Table", emoji: "🍣", source: "michelin", win: true, tags: ["Michelin 2026"], meta: "4.6 · 1.8km · $$ · Till 10:30pm", why: "Highly rated · Michelin list" },
  { name: "Tiny Bean Cafe", emoji: "☕", source: "reviews", win: true, tags: ["@kaya.diaries"], meta: "4.7 · 0.3km · $$ · Till 10pm", why: "Top reviews nearby · closest" },
  { name: "Pho Real", emoji: "🍲", source: "trend", win: false, tags: ["Trending"], meta: "4.4 · 1.5km · $$ · Till 9pm", why: "Rising in your area" },
  { name: "Greenhouse Salad Co.", emoji: "🥗", source: "reviews", win: false, tags: ["Open now"], meta: "4.3 · 1.2km · $ · Till 9pm", why: "Lighter option" },
  { name: "Warong Selera Kita", emoji: "🥘", source: "reviews", win: false, tags: ["Open now"], meta: "4.4 · 0.7km · $ · Till 10pm", why: "Halal-friendly" },
  { name: "The Char Grill", emoji: "🍔", source: "trend", win: false, tags: ["@makanmakan"], meta: "4.2 · 1.1km · $$ · Till 11pm", why: "Group portions" },
];
