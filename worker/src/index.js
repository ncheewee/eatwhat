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
import { matchesKnownHawkerCentre } from "./hawker-centres.js";

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

    if (url.pathname === "/api/place-detail" && request.method === "GET") {
      return handlePlaceDetail(url, env);
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
    // budget accepts "any", a single symbol "$"/"$$"/"$$$", or an array like ["$","$$"]
    // for a multi-select ("show me cheap and mid-range together").
    const budget = Array.isArray(body.budget) ? body.budget : (body.budget || "any");
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
    // How many suggestions the user wants to see, user-configurable 3-10 (default 3).
    const count = Math.max(3, Math.min(10, Number(body.count) || 3));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: "lat/lng required" }, 400);
    }

    const prefsKey = prefs
      ? `:${prefs.style || "-"}:${prefs.ambience || "-"}:${prefs.novelty || "-"}:${(prefs.dietary || []).slice().sort().join(",")}`
      : "";
    const budgetKey = Array.isArray(budget) ? budget.slice().sort().join(",") : budget;
    const cacheKey = `search:${lat.toFixed(2)}:${lng.toFixed(2)}:${radiusKm}:${budgetKey}${prefsKey}${transitOnly ? ":mrt" : ""}:n${count}`;

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
      result = await runPipeline({ lat, lng, radiusKm, budget, partySize, prefs, recentPlaceIds, transitOnly, count, env });
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

// Lazy, on-demand detail fetch — only called when the user actually taps into
// a listing, so we don't pay for these richer (pricier) fields on all ~8
// candidates every search, only the 1-3 someone actually opens.
const PLACE_DETAIL_CACHE_TTL = 60 * 60 * 24 * 3; // 3 days — reviews/photos don't change fast

async function handlePlaceDetail(url, env) {
  const id = url.searchParams.get("id");
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return new Response("Invalid id", { status: 400, headers: CORS_HEADERS });
  }
  if (!env.GOOGLE_PLACES_API_KEY) {
    return json({ error: "GOOGLE_PLACES_API_KEY not set" }, 500);
  }

  const cacheKey = `detail:${id}`;
  if (env.SEARCH_CACHE) {
    const cached = await env.SEARCH_CACHE.get(cacheKey, "json");
    if (cached) return json({ ...cached, cached: true });
  }

  const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
    headers: {
      "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": [
        "photos",
        "editorialSummary",
        "reviews.text",
        "reviews.rating",
        "reviews.authorAttribution.displayName",
        "reviews.relativePublishTimeDescription",
        "formattedAddress",
      ].join(","),
    },
  });
  if (!res.ok) return json({ error: `Place details error ${res.status}` }, res.status);
  const data = await res.json();

  const result = {
    photoRefs: (data.photos || []).slice(0, 6).map((p) => p.name),
    editorialSummary: data.editorialSummary?.text || null,
    reviews: (data.reviews || []).slice(0, 5).map((r) => ({
      text: r.text?.text || "",
      rating: r.rating || null,
      author: r.authorAttribution?.displayName || "Google user",
      when: r.relativePublishTimeDescription || "",
    })).filter((r) => r.text),
    formattedAddress: data.formattedAddress || null,
  };

  if (env.SEARCH_CACHE) {
    await env.SEARCH_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: PLACE_DETAIL_CACHE_TTL });
  }

  return json(result);
}

async function runPipeline({ lat, lng, radiusKm, budget, partySize, prefs, recentPlaceIds, transitOnly, count, env }) {
  if (!env.GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY not set");

  // MICHELIN tagging — curated list, no API call, no cost, no hallucination.
  // Reads a KV override first (so the list can be refreshed without redeploying),
  // falling back to the embedded 2025 seed. Built early so the hawker-centre
  // filter below can safety-check against it.
  let michelinData = null;
  if (env.SEARCH_CACHE) {
    try {
      michelinData = await env.SEARCH_CACHE.get("michelin:list", "json");
    } catch { /* fall through to embedded seed */ }
  }
  const michelin = buildMichelinIndex(michelinData);

  // "Tiong Bahru Market" or "Chinatown Complex Food Centre" as a whole is too
  // broad a suggestion — you can't order "a hawker centre". Drop the umbrella
  // venue itself, but only when it's NOT itself a specific curated stall name
  // (safety net for any edge-case naming collision), so the individual stalls
  // Places already lists separately (which do match the Bib Gourmand/Selected
  // list via lookupMichelin below) still come through untouched.
  const GENERIC_HAWKER = /\b(food centre|food center|market|food court|hawker centre|hawker center|hawker complex|kopitiam|complex)\s*$/i;

  // Budget and "near MRT only" used to be hard filters at the fetch stage —
  // which is exactly what could leave someone with a shortlist of one when
  // both were strict and the radius was small. The search area stays fixed
  // (the user picked it on purpose); instead of throwing candidates away for
  // not matching, they're scored as preferences: an exact budget match or a
  // spot right by a station ranks higher, but a venue that's merely close
  // (not exact) still competes for a slot. If the user asked for `count`
  // picks, they get `count` — the "greatness bar" flexes before the list
  // comes up short, not the geography.
  let venues = await fetchNearbyPlaces({ lat, lng, radiusKm, apiKey: env.GOOGLE_PLACES_API_KEY });
  venues = venues.filter((v) => !GENERIC_HAWKER.test(v.name) || lookupMichelin(v.name, michelin));

  if (!venues.length) return { pool: MOCK_POOL, mock: true, error: "No venues found nearby" };

  let stations = [];
  if (transitOnly) {
    try {
      stations = await fetchTransitStations({ lat, lng, radiusKm, apiKey: env.GOOGLE_PLACES_API_KEY });
    } catch {
      stations = []; // station lookup failed — scoring bonus just won't apply, nothing hard-fails
    }
  }

  const shortlist = venues.slice(0, 40); // rank the whole widened pool, not just the first 20

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
    mergeVenue(v, hypeTags[v.name.toLowerCase()], lookupMichelin(v.name, michelin), prefs, recentPlaceIds, stations, budget, transitOnly)
  );
  const ranked = rankVenues(merged);

  if (!ranked.length) return { pool: MOCK_POOL, mock: true, error: "No venues found nearby" };

  // Guarantee at least one hawker/kopitiam-style pick makes the winning
  // set — otherwise the raw score, even with the boost above, can still
  // lose to several very-high-review-count restaurants clustered at the
  // top. This is a deliberate editorial floor, not just a scoring nudge:
  // the category is too easily crowded out to leave to score alone.
  const guaranteeSlot = Math.min(3, count); // still slot it in early even if the user asked for more than 3
  const poolSize = Math.min(ranked.length, count + 5); // a little padding beyond the "winners" for the reveal animation
  let topN = ranked.slice(0, poolSize);
  const hasHawkerInWinners = topN.slice(0, count).some((v) => v._category === "hawker");
  if (!hasHawkerInWinners) {
    const bestHawkerIdx = topN.findIndex((v) => v._category === "hawker");
    if (bestHawkerIdx >= count) {
      const [hawkerPick] = topN.splice(bestHawkerIdx, 1);
      topN.splice(guaranteeSlot - 1, 0, hawkerPick); // slot it in near the top, bumping the rest down
      topN = topN.slice(0, poolSize);
    }
  }

  const winners = topN.slice(0, count);
  const pool = topN.map(({ _score, _category, ...v }, i) => ({ ...v, win: i < count }));

  // "Near MRT only" is now a soft preference rather than a hard filter, so
  // there's no all-or-nothing fallback to react to — just tell the user
  // plainly if none of the actual winners ended up tagged as near a station.
  const transitFallback = transitOnly && stations.length > 0 && !winners.some((v) => v.tags.includes("Near MRT"));

  return { pool, guideYear: michelin.year, transitOnly, transitFallback };
}

// ---------- Google Places API (New) ----------

const PRICE_MAP = {
  "$": "PRICE_LEVEL_INEXPENSIVE",
  "$$": "PRICE_LEVEL_MODERATE",
  "$$$": "PRICE_LEVEL_EXPENSIVE",
};

const PLACES_FIELD_MASK = [
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
  "places.formattedAddress",
].join(",");

async function searchNearbyRaw({ lat, lng, radiusKm, apiKey, includedTypes, rankPreference }) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 20,
      rankPreference,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusKm * 1000, 50000) },
      },
    }),
  });

  if (!res.ok) throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.places || [];
}

async function fetchNearbyPlaces({ lat, lng, radiusKm, apiKey }) {
  // A single Nearby Search call is capped at 20 raw results by Google — too
  // thin a pool for hawker stalls and other lower-review-volume gems to have
  // a fair shot once scoring/filtering runs, since they tend to rank low on
  // "POPULARITY" alone even when they're genuinely excellent. Running two
  // queries in parallel with different type sets and rank preferences, then
  // merging and deduping by place id, gives the pipeline a meaningfully
  // bigger and more varied raw pool (roughly 2-3x a single call) before any
  // of our own filtering starts — instead of that filtering having to work
  // with an already-thin, popularity-skewed list.
  const [byPopularity, byDistance] = await Promise.all([
    searchNearbyRaw({ lat, lng, radiusKm, apiKey, includedTypes: ["restaurant"], rankPreference: "POPULARITY" }),
    searchNearbyRaw({ lat, lng, radiusKm, apiKey, includedTypes: ["restaurant", "food_court", "meal_takeaway"], rankPreference: "DISTANCE" }),
  ]);

  const byId = new Map();
  for (const p of [...byPopularity, ...byDistance]) {
    if (p.id && !byId.has(p.id)) byId.set(p.id, p);
  }
  const places = [...byId.values()];

  const EXCLUDED_TYPES = /lodging|hotel|resort|shopping_mall|tourist_attraction|casino/i;

  // The real distinction isn't "chain vs independent" — it's "background
  // infrastructure everyone already knows" vs "a distinctive dining
  // experience," and a newly-arrived overseas chain (Korea's bhc opening
  // its first Singapore outlet) is squarely the latter: genuinely
  // interesting, not something anyone needs an app to find. Filtering all
  // "chains", or the whole fast_food_restaurant type, would wrongly exclude
  // exactly that case. So this list only hard-blocks the handful of
  // multinationals that have been fully saturated in Singapore for decades
  // (dozens of outlets, tens of thousands of reviews each, zero novelty) —
  // it is NOT a general chain filter. Everything else, including other
  // chains and new entrants, is left to compete on its own merits via the
  // saturation-aware scoring below.
  // Google's displayName often uses a curly apostrophe (’), not the ASCII
  // one — the blocklist has to match both or names like "McDonald’s" slip through.
  const SATURATED_CHAIN_BLOCKLIST = /\b(mcdonald['’]?s|kfc|kentucky fried chicken|burger king|subway|domino['’]?s|pizza hut|texas chicken|long john silver['’]?s|a\s?&\s?w|wendy['’]?s|taco bell)\b/i;

  return places
    // Places tags big hotels/malls as "restaurant" — they crowd out actual eateries
    .filter((p) => !EXCLUDED_TYPES.test((p.types || []).join(" ")))
    .filter((p) => !SATURATED_CHAIN_BLOCKLIST.test(p.displayName?.text || ""))
    // Budget is no longer a hard filter here — see runPipeline. It's applied
    // as a scoring preference instead, so a narrow budget never empties out
    // the whole candidate pool before the shortlist gets a chance to fill.
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
      formattedAddress: p.formattedAddress || "",
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
  // No silent "$$" default — an unpriced venue should read as unknown, not
  // be mislabeled as moderately priced (which was actively misleading under
  // a "$$$" search that let it through).
  return { PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" }[level] || null;
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

// Hawker/kopitiam-style food, mall/office food courts, and sit-down
// restaurants are genuinely different categories, not one "cheap eats"
// bucket. A hawker centre stall is usually independently run, single-dish
// specialist, and reviewed less by its (often older, local) regulars — so
// a modest review count at a high rating is still a strong signal, and
// price is basically irrelevant since everything there is cheap anyway.
// A food court (Kopitiam, Koufu, Food Republic, Food Junction and similar
// mall/office chains) is commercially operated — closer in spirit to a
// chain restaurant than a hawker centre — so it shouldn't inherit "gem"
// status just for being cheap and under one roof. A sit-down restaurant or
// cafe is judged fine by the existing rating x reviews formula, since its
// review base is more consistent.
//
// Deliberately NOT matching on dish keywords ("noodle", "laksa", "chicken
// rice" etc.) anymore — that caught plenty of proper sit-down restaurants
// that just happen to serve those dishes, which is a false signal, not a
// real one.
const FOODCOURT_HINTS = /\bfood court\b|koufu|kopitiam|food republic|food junction|foodfare|deppa food hall|food opera/i;
const HAWKER_HINTS = /\bhawker\b|\beating house\b|\bcoffee ?shop\b|\bfood centre\b|\bfood center\b/i;

function classifyVenue(v, mich) {
  const text = `${v.name} ${v.typeLabel || ""} ${v.primaryType || ""}`;
  // The address is a better signal than the stall's own name — a stall is
  // rarely named "X Hawker Centre" itself, but its formattedAddress almost
  // always names the building it's in ("2 Adam Rd, Adam Road Food Centre").
  const address = v.formattedAddress || "";
  if (FOODCOURT_HINTS.test(text) || FOODCOURT_HINTS.test(address)) return "foodcourt";
  if (mich?.tier === "bib_gourmand") return "hawker"; // Singapore's own "hawker gem" recognition
  if (HAWKER_HINTS.test(text) || HAWKER_HINTS.test(address)) return "hawker";
  if (matchesKnownHawkerCentre(address)) return "hawker"; // e.g. "Chomp Chomp", "Tekka Centre" — names that don't contain the word "hawker" at all
  if (v.priceSymbol === "$" && (v.rating || 0) >= 4.3) return "hawker"; // fallback proxy — tightened bar now that dish keywords are gone
  return "restaurant";
}

function mergeVenue(v, hype, mich, prefs, recentPlaceIds, stations, budget, transitOnly) {
  const tags = [];
  let source = "reviews";
  const nearStation = !!(stations && stations.length && nearestStationKm(v, stations) <= 0.45);
  if (nearStation) tags.push("Near MRT");

  const category = classifyVenue(v, mich);

  // Curated MICHELIN tier takes priority — it's verified data, not inferred
  if (mich) {
    tags.push(mich.label);
    if (mich.green) tags.push("Green Star");
    source = "michelin";
  } else if (category === "hawker") {
    tags.push("Hawker gem");
  } else if (category === "foodcourt") {
    tags.push("Food court"); // informational, not celebratory — no score boost either
  }
  if (hype?.trending) { tags.push("Trending"); if (!mich) source = "trend"; }
  if (hype?.reviewedBy) tags.push(`@${hype.reviewedBy}`);
  if (!tags.length) tags.push(v.openNow ? "Open now" : "Nearby");

  const metaParts = [v.rating ? v.rating.toFixed(1) : "—", v.distanceKm != null ? `${v.distanceKm}km` : "—"];
  if (v.priceSymbol) metaParts.push(v.priceSymbol);
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
    _score: scoreVenue(v, hype, mich, prefs, isRecent, category, budget, transitOnly, nearStation),
    _category: category,
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
  if (v.priceSymbol) parts.push(v.priceSymbol);
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

function scoreVenue(v, hype, mich, prefs, isRecent, category, budget, transitOnly, nearStation) {
  // Cap the review-count signal — past a few thousand reviews it's telling
  // you a place is a high-traffic fixture, not that it's better than a place
  // with 800 reviews and a devoted following. Uncapped, this term let sheer
  // footfall (chains, mall food courts) drown out smaller genuine standouts.
  const cappedReviews = Math.min(v.reviewCount || 0, 3000);
  let score = (v.rating || 0) * Math.log10(cappedReviews + 1);

  // Beyond the cap, add a gentle negative pressure for venues with truly
  // huge review counts (long-established, high-turnover fixtures) — a
  // second, independent nudge on top of the cap so any hyper-saturated spot
  // (not just the handful of hard-blocked mega-chains) drifts down rather
  // than dominating purely on volume. A newly-opened outlet — whether an
  // independent stall or a first-in-Singapore overseas chain — has a low
  // review count regardless of brand, so this never penalises genuine
  // newcomers, only places that have been the "safe default" for years.
  if (v.reviewCount > 8000) score -= Math.min((v.reviewCount - 8000) / 4000, 3);

  if (mich) score += mich.weight; // 10/9/8 stars, 6 bib, 3 selected
  // Only true hawker/kopitiam gets the structural boost — food courts are
  // commercially generic by nature and compete on raw merit only, same as
  // any sit-down restaurant.
  if (category === "hawker" && !mich) score += 4;
  if (hype?.trending) score += 4;
  if (hype?.reviewedBy) score += 2;
  if (v.distanceKm != null) score -= v.distanceKm * 0.8;
  if (v.openNow === false) score -= 3;

  // Budget and "near MRT only" are preferences, not hard cutoffs (see
  // runPipeline) — matches get a strong push up the ranking, confirmed
  // mismatches a mild push down, and unknown/unpriced venues stay neutral
  // rather than being penalised for data Google never gave us. This is what
  // lets a narrow budget or a near-station requirement still fill out a full
  // shortlist from the same search area instead of running out of matches.
  if (budget && budget !== "any") {
    const wanted = Array.isArray(budget) ? budget : [budget];
    if (v.priceLevel && v.priceLevel !== "PRICE_LEVEL_UNSPECIFIED") {
      score += wanted.some((b) => v.priceLevel === PRICE_MAP[b]) ? 6 : -4;
    }
  }
  if (transitOnly) score += nearStation ? 6 : -3;
  if (prefs) {
    score += stylePrefBonus(v, prefs.style);
    score += ambienceBonus(v, prefs.ambience);
    score += dietaryBonus(v, prefs.dietary);
    score += noveltyBonus(prefs.novelty, isRecent);
  }
  return score;
}

function rankVenues(venues) {
  return [...venues].sort((a, b) => b._score - a._score);
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
