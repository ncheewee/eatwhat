/**
 * Account-backed spoons. The search ladder does not call this.
 */

import { groupSpoons, parseMapsShare } from "./spoons.js";
import {
  putUser, getUser, putSession, getSession,
  saveSpoon, deleteSpoon, listUserSpoons, listAllSpoons,
} from "./spoon-store.js";

const GOOGLE_CLIENT_ID = "279502449091-o52oibu40h31odr2rso4igl6up6j224r.apps.googleusercontent.com";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyGoogleCredential(credential, env) {
  if (!credential || typeof credential !== "string" || credential.length > 5000) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
    if (!res.ok) return null;
    const payload = await res.json();
    const clientId = (env && env.GOOGLE_CLIENT_ID) || GOOGLE_CLIENT_ID;
    if (payload.aud !== clientId || !payload.sub) return null;
    const exp = Number(payload.exp);
    if (Number.isFinite(exp) && exp * 1000 < Date.now()) return null;
    const name = String(payload.name || payload.email || "Someone").trim().slice(0, 60) || "Someone";
    return { id: String(payload.sub), name };
  } catch {
    return null;
  }
}

async function readUser(request, kv) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)/i);
  if (!match) return null;
  const session = await getSession(kv, await sha256Hex(match[1]));
  if (!session || !session.userId || Number(session.expiresAt) < Date.now()) return null;
  return getUser(kv, session.userId);
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 8000) throw new Error("too large");
  if (!text) return {};
  return JSON.parse(text);
}

export async function fetchPlace(placeId, apiKey) {
  const res = await fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId), {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,location,formattedAddress,businessStatus",
    },
  });
  if (!res.ok) return null;
  const p = await res.json();
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    placeId: p.id || placeId,
    name: String(p.displayName?.text || "Unnamed").slice(0, 120),
    lat,
    lng,
    address: p.formattedAddress || "",
  };
}

export async function searchPlaces({ query, lat, lng, apiKey }) {
  const body = { textQuery: String(query).slice(0, 200), maxResultCount: 5, regionCode: "SG" };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: 15000 },
    };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.businessStatus",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.places || [])
    .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
    .filter((p) => Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude))
    .map((p) => ({
      placeId: p.id,
      name: String(p.displayName?.text || "Unnamed").slice(0, 120),
      lat: p.location.latitude,
      lng: p.location.longitude,
      address: p.formattedAddress || "",
    }))
    .filter((p) => PLACE_ID.test(p.placeId || ""));
}

async function followRedirects(start) {
  let current = start;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(current, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      if (!loc) return current;
      current = new URL(loc, current).toString();
      continue;
    }
    return current;
  }
  return current;
}

async function resolveQuery(query, lat, lng, deps) {
  let parsed = parseMapsShare(query);
  if (!parsed) return [];
  if (parsed.shortUrl) {
    const finalUrl = await deps.followRedirects(parsed.shortUrl);
    const again = parseMapsShare(finalUrl);
    if (again) parsed = again;
  }
  if (parsed.placeId && PLACE_ID.test(parsed.placeId)) {
    const place = await deps.fetchPlace(parsed.placeId);
    if (place) return [place];
  }
  const text = parsed.query || (!parsed.placeId ? String(query).slice(0, 200) : "");
  if (!text) return [];
  return deps.searchPlaces({
    query: text,
    lat: parsed.lat ?? lat,
    lng: parsed.lng ?? lng,
  });
}

function publicSpoon(row) {
  return {
    placeId: row.placeId,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    spoons: row.spoons,
    updatedAt: row.updatedAt,
  };
}

export async function handleSpoonRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const spoonPath =
    path === "/api/session" ||
    path === "/api/spoons" ||
    path === "/api/spoons/mine" ||
    path === "/api/spoons/nearby" ||
    path === "/api/places/find";
  if (!spoonPath) return null;

  const kv = env && env.SEARCH_CACHE;
  if (!kv) return json({ error: "Spoons aren't available" }, 503);

  const verify = deps.verifyGoogle || verifyGoogleCredential;
  const fetchPlaceFn = deps.fetchPlace || ((id) => fetchPlace(id, env.GOOGLE_PLACES_API_KEY));
  const searchPlacesFn = deps.searchPlaces || ((args) => searchPlaces({ ...args, apiKey: env.GOOGLE_PLACES_API_KEY }));
  const follow = deps.followRedirects || followRedirects;

  try {
    if (path === "/api/session" && request.method === "POST") {
      let body;
      try { body = await readJson(request); } catch { return json({ error: "Invalid JSON" }, 400); }
      const profile = await verify(body.credential, env);
      if (!profile) return json({ error: "Sign-in didn't check out" }, 401);
      await putUser(kv, profile);
      const token = newToken();
      const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
      await putSession(kv, await sha256Hex(token), { userId: profile.id, expiresAt }, SESSION_TTL_SECONDS);
      return json({ token, user: { name: profile.name } });
    }

    if (path === "/api/spoons/nearby" && request.method === "GET") {
      const lat = Number(url.searchParams.get("lat"));
      const lng = Number(url.searchParams.get("lng"));
      const radiusKm = Math.min(Math.max(Number(url.searchParams.get("radiusKm")) || 2, 0.2), 30);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "lat/lng required" }, 400);
      const me = await readUser(request, kv);
      const records = await listAllSpoons(kv);
      const places = groupSpoons(records, { lat, lng, radiusKm, me: me && me.id });
      return json({ places });
    }

    const user = await readUser(request, kv);
    if (!user) return json({ error: "Sign in again" }, 401);

    if (path === "/api/spoons/mine" && request.method === "GET") {
      const rows = await listUserSpoons(kv, user.id);
      return json({ places: rows.map(publicSpoon) });
    }

    if (path === "/api/spoons" && request.method === "POST") {
      let body;
      try { body = await readJson(request); } catch { return json({ error: "Invalid JSON" }, 400); }
      const placeId = String(body.placeId || "");
      const spoons = Number(body.spoons);
      if (!PLACE_ID.test(placeId) || ![1, 2, 3].includes(spoons)) {
        return json({ error: "Need a place and 1, 2, or 3 spoons" }, 400);
      }
      if (!env.GOOGLE_PLACES_API_KEY && !deps.fetchPlace) {
        return json({ error: "Couldn't look up that place" }, 502);
      }
      const place = await fetchPlaceFn(placeId);
      if (!place) return json({ error: "Couldn't look up that place" }, 502);
      const existing = await listUserSpoons(kv, user.id);
      const already = existing.some((r) => r.placeId === place.placeId);
      if (!already && existing.length >= 200) return json({ error: "Your list is full" }, 400);
      const record = {
        userId: user.id,
        userName: user.name,
        placeId: place.placeId,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        spoons,
        updatedAt: Date.now(),
      };
      await saveSpoon(kv, record);
      return json({ place: publicSpoon(record) });
    }

    if (path === "/api/spoons" && request.method === "DELETE") {
      let body;
      try { body = await readJson(request); } catch { return json({ error: "Invalid JSON" }, 400); }
      const placeId = String(body.placeId || "");
      if (!PLACE_ID.test(placeId)) return json({ error: "Need a place" }, 400);
      await deleteSpoon(kv, user.id, placeId);
      return json({ ok: true });
    }

    if (path === "/api/places/find" && request.method === "POST") {
      let body;
      try { body = await readJson(request); } catch { return json({ error: "Invalid JSON" }, 400); }
      const query = String(body.query || "").trim();
      if (!query) return json({ error: "Type a place or paste a Maps link" }, 400);
      if (!env.GOOGLE_PLACES_API_KEY && !deps.searchPlaces && !deps.fetchPlace) {
        return json({ error: "Couldn't look up that place" }, 502);
      }
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const places = await resolveQuery(query, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null, {
        fetchPlace: fetchPlaceFn,
        searchPlaces: searchPlacesFn,
        followRedirects: follow,
      });
      return json({ places: places.slice(0, 5) });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: "Something went wrong" }, 500);
  }
}
