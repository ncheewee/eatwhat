/**
 * EatWhat API — Cloudflare Worker
 *
 * POST /api/search
 * body: { lat, lng, radiusKm, budget ("any"|"$"|"$$"|"$$$"|string[]), count }
 *
 * Pipeline:
 *   1. Nearby Search (popularity + distance) → real venues
 *   2. Resolve nearby curated gems by name (Text Search)
 *   3. Hard-out: closed, thumbs-down, dietary clash, umbrella food centres
 *   4. Rank on a ladder (liked > Michelin > creator > media > hawker > other)
 *   5. Cache the shortlist per (rounded location + budget + radius) in KV for 12h
 *
 * If GOOGLE_PLACES_API_KEY is missing, or the Places call fails,
 * falls back to demo data so the frontend never hard-breaks.
 */

import { buildMichelinIndex, lookupMichelin } from "./michelin.js";
import { buildCuratedIndex, lookupCurated, GEMS } from "./curated-gems.js";
import { gemAreaNearPin, haversineKm } from "./areas.js";
import {
  FOODCOURT_HINTS,
  classifyVenue,
  dietaryClash,
  venueRung,
  scoreVenue,
  buildWhy,
  rankVenues,
} from "./rank.js";

// Tolerant truthiness for config flags. A value piped in via
// `wrangler secret put` can arrive with a trailing newline, and a
// same-named secret shadows a wrangler.toml [vars] entry — both of which
// silently broke a strict `=== "true"` comparison.
function flagOn(v) {
  return String(v ?? "").trim().toLowerCase() === "true";
}

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

    if (url.pathname === "/api/gem-health" && request.method === "GET") {
      return handleGemHealth(url, env);
    }

    if (url.pathname === "/api/gemini-check" && request.method === "GET") {
      return handleGeminiCheck(env);
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
    // Taste preferences from the onboarding quiz — all optional, all best-effort.
    // { style: "traditional"|"modern"|"either", novelty: "repeat"|"explore"|"mix",
    //   ambience: "minimal"|"somewhat"|"important", dietary: string[] }
    const prefs = body.prefs && typeof body.prefs === "object" ? body.prefs : null;
    // Recently accepted placeIds (most recent first), sent by the client from its
    // own history so "explore vs repeat" can bias ranking without a server-side DB.
    const recentPlaceIds = Array.isArray(body.recentPlaceIds) ? body.recentPlaceIds.slice(0, 15) : [];
    // Explicit thumbs from the feedback prompt. A thumbs-down is a hard "never
    // show me this again" — the user has eaten there and said no, which is
    // better evidence than anything the ranking can infer, so it excludes
    // rather than penalises. A thumbs-up is a nudge, not a pin.
    const likedPlaceIds = Array.isArray(body.likedPlaceIds) ? body.likedPlaceIds.slice(0, 50) : [];
    const dislikedPlaceIds = Array.isArray(body.dislikedPlaceIds) ? body.dislikedPlaceIds.slice(0, 50) : [];
    // "Convenient for public transport" — hard filter to spots within ~5 min walk
    // (~400m) of an MRT/LRT station, using Google's own live transit-station data
    // rather than a hand-maintained station list (which would go stale as new
    // lines/stations open).
    const transitOnly = body.transitOnly === true;
    // How many suggestions the user wants to see, user-configurable 3-10 (default 3).
    const count = Math.max(3, Math.min(10, Number(body.count) || 3));
    // Internal QA aid only — never surfaced in the app UI. Returns the full
    // widened+ranked candidate pool (names/score/category, pre win-cut) so
    // we can audit what Places actually returned vs. what won, without
    // changing default response shape or caching behaviour for real users.
    const debug = body.debug === true;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: "lat/lng required" }, 400);
    }

    const prefsKey = prefs
      ? `:${prefs.style || "-"}:${prefs.ambience || "-"}:${prefs.novelty || "-"}:${(prefs.dietary || []).slice().sort().join(",")}`
      : "";
    const budgetKey = Array.isArray(budget) ? budget.slice().sort().join(",") : budget;
    const cacheKey = `search3:${lat.toFixed(2)}:${lng.toFixed(2)}:${radiusKm}:${budgetKey}${prefsKey}${transitOnly ? ":mrt" : ""}:n${count}`;

    // Skip the cache entirely once novelty/recency personalization is in play —
    // the ranking depends on this specific user's recent history, so a shared
    // cache entry would leak one person's ranking to another.
    const canCache = env.SEARCH_CACHE && recentPlaceIds.length === 0 && likedPlaceIds.length === 0 && dislikedPlaceIds.length === 0 && !debug;

    if (canCache) {
      const cached = await env.SEARCH_CACHE.get(cacheKey, "json");
      if (cached) {
        return json({ ...cached, cached: true });
      }
    }

    let result;
    try {
      result = await runPipeline({ lat, lng, radiusKm, budget, prefs, recentPlaceIds, likedPlaceIds, dislikedPlaceIds, transitOnly, count, env, debug });
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

/**
 * GET /api/gem-health?offset=0&limit=15
 *
 * Health check over curated-gems.js: resolves each gem and reports its live
 * businessStatus, so closed entries can be pruned instead of sitting in the
 * list until someone notices by eye (which is how OK Chicken Rice & Humfull
 * Laksa survived — closed permanently, still winning an Ang Mo Kio slot).
 *
 * Paginated deliberately. Each gem costs up to two subrequests (identity +
 * live status) and Workers caps subrequests per request, so walking the list
 * in small pages is the only way this stays inside the budget.
 */
async function handleGemHealth(url, env) {
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return json({ error: "GOOGLE_PLACES_API_KEY not set" }, 500);

  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit")) || 15));
  const slice = GEMS.slice(offset, offset + limit);

  const gems = await Promise.all(
    slice.map(async (gem) => {
      const cacheKey = `gemplace2:${gem.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      let raw = null;
      if (env.SEARCH_CACHE) {
        try { raw = await env.SEARCH_CACHE.get(cacheKey, "json"); } catch { /* fall through */ }
      }
      if (!raw) {
        try {
          const [hit] = await searchTextRaw({ query: `${gem.name} ${gem.area} Singapore`, apiKey });
          raw = hit || null;
        } catch { raw = null; }
      }
      if (!raw?.id) return { name: gem.name, area: gem.area, source: gem.source, placeId: null, status: "UNRESOLVED" };

      // The cached identity can be up to 60 days old, so status is re-checked
      // live rather than trusted from the snapshot.
      let status = null;
      try {
        const res = await fetch(`https://places.googleapis.com/v1/places/${raw.id}`, {
          headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "businessStatus,displayName" },
        });
        if (res.ok) {
          const d = await res.json();
          status = d.businessStatus || "UNKNOWN";
          return { name: gem.name, area: gem.area, source: gem.source, placeId: raw.id, resolvedTo: d.displayName?.text || null, status };
        }
        status = `HTTP_${res.status}`;
      } catch (err) {
        status = "LOOKUP_FAILED";
      }
      return { name: gem.name, area: gem.area, source: gem.source, placeId: raw.id, status };
    })
  );

  const problems = gems.filter((g) => g.status !== "OPERATIONAL");
  return json({
    total: GEMS.length,
    offset,
    limit,
    nextOffset: offset + limit < GEMS.length ? offset + limit : null,
    problemCount: problems.length,
    problems,
    gems,
  });
}

// Manual diagnostic — GET /api/gemini-check — makes one minimal live call to
// confirm the Gemini API key/project is actually working right now (quota,
// billing, deprecated model, etc. all show up as a real HTTP status + body
// here rather than silently swallowed like the best-effort fetchHypeTags
// call above is during normal search requests). Never exposes the key itself.
async function handleGeminiCheck(env) {
  if (!env.GEMINI_API_KEY) return json({ ok: false, reason: "GEMINI_API_KEY not set on this Worker" });
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=" + env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with exactly one word: OK" }] }] }),
      }
    );
    const bodyText = await res.text();
    return json({ ok: res.ok, httpStatus: res.status, enableGroundingFlag: flagOn(env.ENABLE_GROUNDING), rawGroundingValue: JSON.stringify(env.ENABLE_GROUNDING ?? null), responseBody: bodyText.slice(0, 800) });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
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

  const cacheKey = `detail2:${id}`;
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
        "businessStatus",
      ].join(","),
    },
  });
  if (!res.ok) return json({ error: `Place details error ${res.status}` }, res.status);
  const data = await res.json();

  const result = {
    photoRefs: (data.photos || []).slice(0, 6).map((p) => p.name),
    editorialSummary: data.editorialSummary?.text || null,
    businessStatus: data.businessStatus || null,
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

async function runPipeline({ lat, lng, radiusKm, budget, prefs, recentPlaceIds, likedPlaceIds = [], dislikedPlaceIds = [], transitOnly, count, env, debug }) {
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

  // Curated food-media picks (Eatbook, ladyironchef, etc.) — a second,
  // independent discovery source alongside Places' own popularity ranking.
  // See curated-gems.js for why this exists and the KV refresh path.
  let curatedData = null;
  if (env.SEARCH_CACHE) {
    try {
      curatedData = await env.SEARCH_CACHE.get("curated:list", "json");
    } catch { /* fall through to embedded seed */ }
  }
  const curatedGems = buildCuratedIndex(curatedData);

  // "Tiong Bahru Market" or "Chinatown Complex Food Centre" as a whole is too
  // broad a suggestion — you can't order "a hawker centre". Drop the umbrella
  // venue itself, but only when it's NOT itself a specific curated stall name
  // (safety net for any edge-case naming collision), so the individual stalls
  // Places already lists separately (which do match the Bib Gourmand/Selected
  // list via lookupMichelin below) still come through untouched.
  //
  // Two known gaps fixed here (2026-07-26 bug report — "still getting entire
  // food courts listed as a spot"):
  //  1. This end-anchored pattern missed branded food-court chains whose
  //     name doesn't literally end in one of these words, e.g. "Kopitiam @
  //     Bugis Junction" or "Food Republic @ VivoCity" — the "@ Location"
  //     suffix meant \s*$ never matched. isGenericVenueName() below also
  //     checks FOODCOURT_HINTS (the same brand list already used to *tag*
  //     individual food-court stalls) against the venue's own name, which
  //     catches these without misfiring on a stall's own name (a real stall
  //     is very unlikely to have "food republic"/"koufu"/"kopitiam" etc. as
  //     part of its own business name).
  //  2. This filter was only ever applied to fetchNearbyPlaces() results —
  //     resolveCuratedGems() venues (Text Search resolutions of curated
  //     picks) were appended to `shortlist` AFTER this filter ran, so a
  //     curated name that Text Search resolved to an entire food centre
  //     (because the specific stall isn't independently listed in Places)
  //     sailed straight through untouched. isGenericVenueName() is now also
  //     applied to gemVenues below, not just the nearby-search pool.
  const GENERIC_HAWKER = /\b(food centre|food center|market|food court|hawker centre|hawker center|hawker complex|kopitiam|complex)\s*$/i;
  const isGenericVenueName = (name) => GENERIC_HAWKER.test(name) || FOODCOURT_HINTS.test(name);

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
  venues = venues.filter((v) => !isGenericVenueName(v.name) || lookupMichelin(v.name, michelin));

  if (!venues.length) return { pool: MOCK_POOL, mock: true, error: "No venues found nearby" };

  let stations = [];
  if (transitOnly) {
    try {
      stations = await fetchTransitStations({ lat, lng, radiusKm, apiKey: env.GOOGLE_PLACES_API_KEY });
    } catch {
      stations = []; // station lookup failed — scoring bonus just won't apply, nothing hard-fails
    }
  }

  let shortlist = venues.slice(0, 40); // rank the whole widened pool, not just the first 20

  // Actively resolve curated food-media gems (see resolveCuratedGems doc
  // comment) and append them AFTER the slice above, deduped by place id —
  // this is what actually gets a scattered-across-town hawker gem into the
  // pool at all, since Nearby Search's top-20-per-query cap otherwise
  // excludes it regardless of scoring. Appending post-slice (rather than
  // merging into `venues` pre-slice) guarantees a resolved gem is never
  // truncated away by the cap sized for the nearby-search pool alone.
  try {
    const gemVenues = await resolveCuratedGems({ lat, lng, radiusKm, apiKey: env.GOOGLE_PLACES_API_KEY, env });
    const seenIds = new Set(shortlist.map((v) => v.id));
    for (const gv of gemVenues) {
      // A curated name that Text Search resolved to an entire food centre
      // (rather than the specific stall) is exactly as unsuggestable as one
      // that came through Nearby Search — same filter, not skipped this time.
      if (gv.id && !seenIds.has(gv.id) && (!isGenericVenueName(gv.name) || lookupMichelin(gv.name, michelin))) {
        shortlist.push(gv);
        seenIds.add(gv.id);
      }
    }
  } catch {
    /* best-effort — curated-gem resolution never blocks the main search */
  }

  // Optional: grounded "trending" tags via Gemini. Disabled by default because
  // Search grounding requires a paid/prepay Gemini project. Set ENABLE_GROUNDING="true"
  // once billing is in place to switch it on.
  let hypeTags = {};
  let groundingDiag = flagOn(env.ENABLE_GROUNDING)
    ? (env.GEMINI_API_KEY ? "attempted" : "skipped: no GEMINI_API_KEY")
    : "skipped: ENABLE_GROUNDING not true";
  if (flagOn(env.ENABLE_GROUNDING) && env.GEMINI_API_KEY) {
    try {
      hypeTags = await fetchHypeTags({ venues: shortlist.slice(0, 15), apiKey: env.GEMINI_API_KEY });
      groundingDiag = `ok: ${Object.keys(hypeTags).length} tagged`;
    } catch (err) {
      groundingDiag = `error: ${String(err).slice(0, 300)}`;
      hypeTags = {}; // best-effort — never fail the request over this
    }
  }

  // Hard-out, not a penalty: closed, thumbs-down, and dietary clash never
  // compete. Unknown hours (openNow === null) stay in — only an explicit
  // closed-now or CLOSED_* status is a no.
  const dietary = prefs?.dietary || [];
  const eligible = shortlist.filter((v) => {
    if (String(v._businessStatus || "").startsWith("CLOSED")) return false;
    if (v.openNow === false) return false;
    if (v.id && dislikedPlaceIds.includes(v.id)) return false;
    if (dietaryClash(v, dietary)) return false;
    return true;
  });
  if (!eligible.length) return { pool: MOCK_POOL, mock: true, error: "No venues open nearby" };

  const merged = eligible.map((v) =>
    mergeVenue(v, hypeTags[v.name.toLowerCase()], lookupMichelin(v.name, michelin), lookupCurated(v.name, curatedGems), prefs, recentPlaceIds, likedPlaceIds, stations, budget, transitOnly)
  );
  const ranked = rankVenues(merged);

  if (!ranked.length) return { pool: MOCK_POOL, mock: true, error: "No venues found nearby" };

  const ordered = ranked;

  // Guarantee at least one real hawker stall in the winning set. Stalls
  // sit on a lower rung than named picks, so a cluster of cafes can
  // otherwise crowd them out of a shortlist. Only address/centre hawkers
  // qualify — a curated cafe is not a stall.
  const guaranteeSlot = Math.min(3, count); // still slot it in early even if the user asked for more than 3
  const poolSize = Math.min(ordered.length, count + 5); // a little padding beyond the "winners" for the reveal animation
  let topN = ordered.slice(0, poolSize);
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
  const pool = topN.map(({ _score, _category, _openNow, _businessStatus, _rung, ...v }, i) => ({ ...v, win: i < count }));

  // "Near MRT only" is now a soft preference rather than a hard filter, so
  // there's no all-or-nothing fallback to react to — just tell the user
  // plainly if none of the actual winners ended up tagged as near a station.
  const transitFallback = transitOnly && stations.length > 0 && !winners.some((v) => v.tags.includes("Near MRT"));

  const out = { pool, guideYear: michelin.year, transitOnly, transitFallback };
  if (debug) {
    out.debugPool = ranked.map((v) => ({
      name: v.name, score: Math.round(v._score * 10) / 10, rung: v._rung, category: v._category,
      tags: v.tags, won: winners.some((w) => w.placeId && w.placeId === v.placeId),
      businessStatus: v._businessStatus || null, why: v.why,
    }));
    out.debugRawFetchCount = shortlist.length; // includes resolved curated gems, post-merge
    out.debugGrounding = groundingDiag;
  }
  return out;
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
  "places.businessStatus",
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
    .map((p) => normalizePlace(p, lat, lng));
}

/** Shared Places-API-raw-object → internal venue shape, used by both the
 * nearby search and the curated-gems Text Search resolver below. */
function normalizePlace(p, lat, lng) {
  return {
    id: p.id,
    name: p.displayName?.text || "Unnamed",
    rating: p.rating || 0,
    reviewCount: p.userRatingCount || 0,
    priceLevel: p.priceLevel || "PRICE_LEVEL_UNSPECIFIED",
    priceSymbol: symbolForPriceLevel(p.priceLevel),
    openNow: p.currentOpeningHours?.openNow ?? null,
    _businessStatus: p.businessStatus || null, // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
    distanceKm: haversineKm(lat, lng, p.location?.latitude, p.location?.longitude),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    formattedAddress: p.formattedAddress || "",
    primaryType: p.primaryType || "restaurant",
    typeLabel: p.primaryTypeDisplayName?.text || null,
    types: p.types || [],
    emoji: emojiForType(p.primaryType, p.types),
    photoRef: p.photos?.[0]?.name || null, // e.g. "places/ChIJ.../photos/AWU5..."
  };
}

async function searchTextRaw({ query, apiKey }) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`Places Text Search error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.places || [];
}

const GEM_CACHE_TTL = 60 * 60 * 24 * 60; // 60 days — a stall's location/rating barely moves week to week

/**
 * Actively resolve curated food-media gems by name via Places Text Search,
 * rather than hoping fetchNearbyPlaces' rank-limited (top-20-per-query)
 * nearby search happens to surface them.
 *
 * WHY THIS EXISTS: a 2026-07-22 debug-mode audit found that for Ang Mo Kio,
 * widening the nearby-search radius from 2km to 5km barely changed the raw
 * candidate count (29→32) and still surfaced zero of Eatbook's named
 * street-hawker picks — they simply don't rank in the top 20 by popularity
 * OR by raw distance from the search pin, so scoring/curated-tagging never
 * got a chance to run on them at all. Text Search finds a place by name
 * directly, sidestepping that ranking cap entirely.
 *
 * Each gem's resolved Places data is cached in KV for GEM_CACHE_TTL, so this
 * only costs a live API call once per gem, ever (until the cache expires) —
 * subsequent requests, from any user/location, hit the cache.
 */
const GEM_OPENNOW_TTL = 60 * 10; // 10 minutes

/**
 * openNow is a live, fast-changing field — it CANNOT ride along with the
 * 60-day gemplace identity cache above (name/address/rating/location are
 * genuinely stable for months; open/closed status is not). A 2026-07 bug
 * report ("Magic Kitchen shown as a pick but it's closed on Google Maps")
 * traced back to exactly this: a gem resolved via Text Search days earlier
 * had its whole raw Places object — openNow included — cached for 60 days,
 * so it kept reporting whatever open/closed state it happened to have at
 * the moment it was first resolved, forever. This does a separate,
 * short-TTL, id-keyed lookup of just the live opening-hours field.
 */
async function fetchLiveOpenNow({ placeId, apiKey, env }) {
  const cacheKey = `gemopen:${placeId}`;
  if (env.SEARCH_CACHE) {
    try {
      const cached = await env.SEARCH_CACHE.get(cacheKey, "json");
      if (cached && typeof cached.openNow !== "undefined") return cached.openNow;
    } catch { /* fall through to live lookup */ }
  }
  let openNow = null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "currentOpeningHours.openNow" },
    });
    if (res.ok) {
      const data = await res.json();
      openNow = data.currentOpeningHours?.openNow ?? null;
    }
  } catch {
    openNow = null; // best-effort — one failed live check shouldn't fail the whole request
  }
  if (env.SEARCH_CACHE) {
    try {
      await env.SEARCH_CACHE.put(cacheKey, JSON.stringify({ openNow }), { expirationTtl: GEM_OPENNOW_TTL });
    } catch { /* cache write failure is non-fatal */ }
  }
  return openNow;
}

async function resolveCuratedGems({ lat, lng, radiusKm, apiKey, env }) {
  const results = await Promise.all(
    GEMS.map(async (gem) => {
      // v2 prefix: entries written before businessStatus joined the field mask
      // have no status to filter on, so the deploy must not reuse them.
      const cacheKey = `gemplace2:${gem.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      let raw = null;
      if (env.SEARCH_CACHE) {
        try {
          raw = await env.SEARCH_CACHE.get(cacheKey, "json");
        } catch { /* fall through to live lookup */ }
      }
      if (raw) {
        const cached = normalizePlace(raw, lat, lng);
        if (cached.distanceKm == null || cached.distanceKm > radiusKm) return null;
        return raw;
      }
      // No cached place: skip the Text Search when the listed area is
      // clearly outside the search pin. Unknown areas still resolve.
      if (gemAreaNearPin(gem.area, lat, lng, radiusKm) === false) return null;
      try {
        const [hit] = await searchTextRaw({ query: `${gem.name} ${gem.area} Singapore`, apiKey });
        raw = hit || null;
      } catch {
        raw = null; // best-effort — one bad lookup shouldn't fail the whole request
      }
      if (raw && env.SEARCH_CACHE) {
        try {
          await env.SEARCH_CACHE.put(cacheKey, JSON.stringify(raw), { expirationTtl: GEM_CACHE_TTL });
        } catch { /* cache write failure is non-fatal */ }
      }
      return raw;
    })
  );

  const resolved = results
    .filter(Boolean)
    .map((p) => normalizePlace(p, lat, lng))
    // Text Search isn't geo-scoped like Nearby Search — a name can resolve to
    // a branch anywhere in Singapore, so this radius check is load-bearing,
    // not a redundant safety net.
    .filter((v) => v.distanceKm != null && v.distanceKm <= radiusKm);

  // Only refresh openNow for the handful of gems that actually survived the
  // radius filter — not all of GEMS — to keep this cheap.
  await Promise.all(
    resolved.map(async (v) => {
      if (v.id) v.openNow = await fetchLiveOpenNow({ placeId: v.id, apiKey, env });
    })
  );

  return resolved;
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

function mergeVenue(v, hype, mich, curated, prefs, recentPlaceIds, likedPlaceIds, stations, budget, transitOnly) {
  const tags = [];
  let source = "reviews";
  const nearStation = !!(stations && stations.length && nearestStationKm(v, stations) <= 0.45);
  if (nearStation) tags.push("Near MRT");

  const category = classifyVenue(v);
  const isRecent = recentPlaceIds && v.id && recentPlaceIds.includes(v.id);
  const isLiked = !!(likedPlaceIds && v.id && likedPlaceIds.includes(v.id));
  const rung = venueRung({ isLiked, mich, curated, category });

  if (mich) {
    tags.push(mich.label);
    if (mich.green) tags.push("Green Star");
    source = "michelin";
  } else if (curated) {
    tags.push(`${curated.source} pick`);
    source = "curated";
  } else if (category === "hawker") {
    tags.push("Hawker stall");
  } else if (category === "foodcourt") {
    tags.push("Food court");
  }
  if (hype?.trending) { tags.push("Trending"); if (!mich) source = "trend"; }
  if (hype?.reviewedBy) tags.push(`@${hype.reviewedBy}`);
  if (!tags.length) tags.push(v.openNow ? "Open now" : "Nearby");

  const metaParts = [v.rating ? v.rating.toFixed(1) : "—", v.distanceKm != null ? `${v.distanceKm}km` : "—"];
  if (v.priceSymbol) metaParts.push(v.priceSymbol);
  if (v.openNow != null) metaParts.push(v.openNow ? "Open now" : "Closed now");

  if (isLiked) tags.push("You liked this");
  else if (prefs?.novelty === "repeat" && isRecent) tags.push("A favorite of yours");

  const ctx = { hype, mich, curated, prefs, isRecent, isLiked, category, budget, transitOnly, nearStation, rung };
  return {
    placeId: v.id || null,
    name: v.name,
    emoji: v.emoji,
    photoRef: v.photoRef || null,
    description: buildDescription(v),
    source,
    tags,
    meta: metaParts.join(" · "),
    _businessStatus: v._businessStatus || null,
    why: buildWhy({ rung, mich, curated, v }),
    _score: scoreVenue(v, ctx),
    _category: category,
    _rung: rung,
    _openNow: v.openNow,
  };
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
