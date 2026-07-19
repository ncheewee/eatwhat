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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/photo" && request.method === "GET") {
      return handlePhoto(url, env);
    }

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
    // Taste preferences from the onboarding quiz — all optional, all best-effort.
    // { style: "traditional"|"modern"|"either", novelty: "repeat"|"explore"|"mix",
    //   ambience: "minimal"|"somewhat"|"important", dietary: string[] }
    const prefs = body.prefs && typeof body.prefs === "object" ? body.prefs : null;
    // Recently accepted placeIds (most recent first), sent by the client from its
    // own history so "explore vs repeat" can bias ranking without a server-side DB.
    const recentPlaceIds = Array.isArray(body.recentPlaceIds) ? body.recentPlaceIds.slice(0, 15) : [];
    // "Convenient for public transport" — hard filter to spots within ~5 min walk
    // (~400m) of an MRT/LRT station, using Google's own live transit-station data
    // rather than a hand-maintained station list (which would go stale as new
    // lines/stations open).
    const transitOnly = body.transitOnly === true;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: "lat/lng required" }, 400);
    }

    const prefsKey = prefs
      ? `:${prefs.style || "-"}:${prefs.ambience || "-"}:${prefs.novelty || "-"}:${(prefs.dietary || []).slice().sort().join(",")}`
      : "";
    const cacheKey = `search:${lat.toFixed(2)}:${lng.toFixed(2)}:${radiusKm}:${budget}${prefsKey}${transitOnly ? ":mrt" : ""}`;

    // Skip the cache entirely once novelty/recency personalization is in play —
    // the ranking depends on this specific user's recent history, so a shared
    // cache entry would leak one person's ranking to another.
    const canCache = env.SEARCH_CACHE && recentPlaceIds.length === 0;

    if (canCache) {
      const cached = await env.SEARCH_CACHE.get(cacheKey, "json");
      if (cached) {
        return json({ ...cached, cached: true });
      }
    }

    let result;
    try {
      result = await runPipeline({ lat, lng, radiusKm, budget, partySize, prefs, recentPlaceIds, transitOnly, env });
    } catch (err) {
      result = { pool: MOCK_POOL, mock: true, error: String(err) };
    }

    if (canCache && !result.mock) {
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

// Proxies Google Places photo media so the API key never reaches the client.
// GET /api/photo?ref=<url-encoded photo resource name>&w=400
async function handlePhoto(url, env) {
  const ref = url.searchParams.get("ref");
  const w = Math.min(Number(url.searchParams.get("w")) || 400, 1600);
  if (!ref) return new Response("Missing ref", { status: 400, headers: CORS_HEADERS });
  if (!env.GOOGLE_PLACES_API_KEY) return new Response("Not configured", { status: 500, headers: CORS_HEADERS });

  const photoName = decodeURIComponent(ref);
  // Guard against anything except a genuine Places photo resource path
  if (!/^places\/[^/]+\/photos\/[^/?#]+$/.test(photoName)) {
    return new Response("Invalid ref", { status: 400, headers: CORS_HEADERS });
  }

  const upstream = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${w}&key=${env.GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(upstream);
  if (!res.ok) return new Response("Photo fetch failed", { status: res.status, headers: CORS_HEADERS });

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=604800", // 7 days — photos rarely change
      ...CORS_HEADERS,
    },
  });
}

async function runPipeline({ lat, lng, radiusKm, budget, partySize, prefs, recentPlaceIds, transitOnly, env }) {
  if (!env.GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set");

  const venues = await fetchNearbyPlaces({ lat, lng, radiusKm, budget, apiKey: env.GOOGLE_PLACES_API_KEY });
  if (!venues.length) return { pool: MOCK_POOL, mock: true, error: "No venues found nearby" };

  let candidates = venues;
  let transitFallback = false;
  let stations = [];
  if (transitOnly) {
    try {
      stations = await fetchTransitStations({ lat, lng, radiusKm, apiKey: env.GOOGLE_PLACES_API_KEY });
      if (stations.length) {
        const nearStation = venues.filter((v) => nearestStationKm(v, stations) <= 0.45);
        if (nearStation.length) candidates = nearStation;
        else transitFallback = true; // none matched — don't dead-end the search
      } else {
        transitFallback = true;
      }
    } catch {
      transitFallback = true; // station lookup failed — fall back to unfiltered rather than error out
    }
  }

  const shortlist = candidates.slice(0, 20);

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
    mergeVenue(v, hypeTags[v.name.toLowerCase()], lookupMichelin(v.name, michelin), prefs, recentPlaceIds, stations)
  );
  const ranked = rankVenues(merged);
  const pool = ranked.slice(0, 8).map((v, i) => ({ ...v, win: i < 3 }));

  return { pool, guideYear: michelin.year, transitOnly, transitFallback };
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
        "places.primaryTypeDisplayName",
        "places.types",
        "places.photos",
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
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      primaryType: p.primaryType || "restaurant",
      typeLabel: p.primaryTypeDisplayName?.text || null,
      types: p.types || [],
      emoji: emojiForType(p.primaryType, p.types),
      photoRef: p.photos?.[0]?.name || null, // e.g. "places/ChIJ.../photos/AWU5..."
    }));
}

async function fetchTransitStations({ lat, lng, radiusKm, apiKey }) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.location",
    },
    body: JSON.stringify({
      includedTypes: ["subway_station", "train_station", "light_rail_station"],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: Math.min((radiusKm + 1) * 1000, 50000) },
      },
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.places || [])
    .map((p) => p.location)
    .filter((l) => l && Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
}

function nearestStationKm(v, stations) {
  if (!stations.length || v.lat == null || v.lng == null) return Infinity;
  let min = Infinity;
  for (const s of stations) {
    const d = haversineKm(v.lat, v.lng, s.latitude, s.longitude);
    if (d < min) min = d;
  }
  return min;
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

function mergeVenue(v, hype, mich, prefs, recentPlaceIds, stations) {
  const tags = [];
  let source = "reviews";
  if (stations && stations.length && nearestStationKm(v, stations) <= 0.45) tags.push("Near MRT");

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

  const isRecent = recentPlaceIds && v.id && recentPlaceIds.includes(v.id);
  if (prefs?.novelty === "repeat" && isRecent) tags.push("A favorite of yours");

  return {
    placeId: v.id || null,
    name: v.name,
    emoji: v.emoji,
    photoRef: v.photoRef || null,
    description: buildDescription(v),
    source,
    tags,
    meta: metaParts.join(" · "),
    why: michWhy(mich, v) || hype?.why || (v.openNow ? "Nearby and open now" : "Well rated nearby"),
    _score: scoreVenue(v, hype, mich, prefs, isRecent),
  };
}

// ---------- Taste-preference scoring helpers ----------
// All heuristic and additive — never hard-filter, since Places data is too
// noisy to safely exclude venues outright (a false exclusion is worse than a
// mild mis-ranking).

const TRADITIONAL_HINTS = /hawker|kopitiam|food court|coffee house|zi char|teochew|hainanese|heritage/i;
const MODERN_HINTS = /fine dining|contemporary|omakase|degustation|tasting menu|wine bar|cocktail/i;
const HALAL_HINTS = /halal|muslim/i;
const PORK_HINTS = /pork|bak kut teh|char siu|bak kwa|lard/i;
const BEEF_HINTS = /beef|steak|wagyu/i;
const VEGETARIAN_TYPES = /vegetarian|vegan/i;

function stylePrefBonus(v, style) {
  if (!style || style === "either") return 0;
  const text = `${v.name} ${v.typeLabel || ""} ${(v.types || []).join(" ")}`;
  if (style === "traditional") {
    if (TRADITIONAL_HINTS.test(text)) return 3;
    if (v.priceSymbol === "$") return 1;
    if (MODERN_HINTS.test(text) || v.priceSymbol === "$$$") return -2;
  }
  if (style === "modern") {
    if (MODERN_HINTS.test(text)) return 3;
    if (v.priceSymbol === "$$$") return 2;
    if (TRADITIONAL_HINTS.test(text)) return -1;
  }
  return 0;
}

function ambienceBonus(v, ambience) {
  if (!ambience || ambience === "somewhat") return 0;
  if (ambience === "important") {
    if (v.priceSymbol === "$$$") return 2;
    if (v.priceSymbol === "$$") return 1;
    return -1;
  }
  if (ambience === "minimal") {
    if (v.priceSymbol === "$") return 1;
  }
  return 0;
}

function dietaryBonus(v, dietary) {
  if (!dietary || !dietary.length) return 0;
  const text = `${v.name} ${v.typeLabel || ""}`;
  const types = (v.types || []).join(" ");
  let score = 0;
  if (dietary.includes("vegetarian") || dietary.includes("vegan")) {
    if (VEGETARIAN_TYPES.test(types) || VEGETARIAN_TYPES.test(text)) score += 4;
  }
  if (dietary.includes("halal")) {
    if (HALAL_HINTS.test(text)) score += 4;
    if (PORK_HINTS.test(text)) score -= 3;
  }
  if (dietary.includes("no_pork") && PORK_HINTS.test(text)) score -= 3;
  if (dietary.includes("no_beef") && BEEF_HINTS.test(text)) score -= 3;
  return score;
}

function noveltyBonus(novelty, isRecent) {
  if (!novelty || novelty === "mix" || !isRecent) return 0;
  if (novelty === "repeat") return 4; // resurface known favorites
  if (novelty === "explore") return -6; // push already-visited spots down
  return 0;
}

// Short "glance" line, styled like a Google listing snippet:
// "Ramen restaurant · $$ · 4.6 (1.2k) · 0.4km"
function buildDescription(v) {
  const parts = [];
  parts.push(v.typeLabel || titleCase(v.primaryType) || "Restaurant");
  parts.push(v.priceSymbol);
  if (v.rating) parts.push(`${v.rating.toFixed(1)}★ (${formatCount(v.reviewCount)})`);
  if (v.distanceKm != null) parts.push(`${v.distanceKm}km`);
  return parts.join(" · ");
}

function titleCase(s) {
  if (!s) return null;
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCount(n) {
  if (!n) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
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

function scoreVenue(v, hype, mich, prefs, isRecent) {
  let score = (v.rating || 0) * Math.log10((v.reviewCount || 1) + 1);
  if (mich) score += mich.weight; // 10/9/8 stars, 6 bib, 3 selected
  if (hype?.trending) score += 4;
  if (hype?.reviewedBy) score += 2;
  if (v.distanceKm != null) score -= v.distanceKm * 0.8;
  if (v.openNow === false) score -= 3;
  if (prefs) {
    score += stylePrefBonus(v, prefs.style);
    score += ambienceBonus(v, prefs.ambience);
    score += dietaryBonus(v, prefs.dietary);
    score += noveltyBonus(prefs.novelty, isRecent);
  }
  return score;
}

function rankVenues(venues) {
  return [...venues].sort((a, b) => b._score - a._score).map(({ _score, ...v }) => v);
}

// ---------- Fallback demo data (used if keys are missing or calls fail) ----------

const MOCK_POOL = [
  { placeId: null, name: "Nama Ramen Bar", emoji: "🍜", photoRef: null, description: "Ramen restaurant · $$ · 4.6★ (1.2k) · 0.4km", source: "trend", win: true, tags: ["Trending", "@makanmakan"], meta: "4.6 · 0.4km · $$ · Till 10pm", why: "Trending this week · 0.4km away" },
  { placeId: null, name: "Curry House 88", emoji: "🍛", photoRef: null, description: "Indian restaurant · $$ · 4.5★ (860) · 0.9km", source: "michelin", win: true, tags: ["Bib Gourmand 2025"], meta: "4.5 · 0.9km · $$ · Till 9:30pm", why: "Bib Gourmand · fits your budget" },
  { placeId: null, name: "Sakura Sushi Table", emoji: "🍣", photoRef: null, description: "Sushi restaurant · $$ · 4.6★ (2.1k) · 1.8km", source: "michelin", win: true, tags: ["MICHELIN ★ 2025"], meta: "4.6 · 1.8km · $$ · Till 10:30pm", why: "MICHELIN starred · highly rated" },
  { placeId: null, name: "Tiny Bean Cafe", emoji: "☕", photoRef: null, description: "Cafe · $$ · 4.7★ (410) · 0.3km", source: "reviews", win: false, tags: ["@kaya.diaries"], meta: "4.7 · 0.3km · $$ · Till 10pm", why: "Top reviews nearby · closest" },
  { placeId: null, name: "Pho Real", emoji: "🍲", photoRef: null, description: "Vietnamese restaurant · $$ · 4.4★ (620) · 1.5km", source: "trend", win: false, tags: ["Trending"], meta: "4.4 · 1.5km · $$ · Till 9pm", why: "Rising in your area" },
  { placeId: null, name: "Greenhouse Salad Co.", emoji: "🥗", photoRef: null, description: "Salad restaurant · $ · 4.3★ (310) · 1.2km", source: "reviews", win: false, tags: ["Open now"], meta: "4.3 · 1.2km · $ · Till 9pm", why: "Lighter option" },
  { placeId: null, name: "Warong Selera Kita", emoji: "🥘", photoRef: null, description: "Indonesian restaurant · $ · 4.4★ (540) · 0.7km", source: "reviews", win: false, tags: ["Open now"], meta: "4.4 · 0.7km · $ · Till 10pm", why: "Halal-friendly" },
  { placeId: null, name: "The Char Grill", emoji: "🍔", photoRef: null, description: "Barbecue restaurant · $$ · 4.2★ (280) · 1.1km", source: "trend", win: false, tags: ["@makanmakan"], meta: "4.2 · 1.1km · $$ · Till 11pm", why: "Group portions" },
];
