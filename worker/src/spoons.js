/**
 * Spoon recommendations. Kept entirely apart from the EatWhat ranking ladder.
 * Ordering here only makes the people list readable. It is not a verdict
 * against the guide or the engine.
 */

import { haversineKm } from "./areas.js";

export function shortName(name) {
  const n = String(name || "").trim();
  if (!n) return "Someone";
  const first = n.split(/\s+/)[0];
  return first.length > 24 ? first.slice(0, 24) : first;
}

export function spoonWord(n) {
  return Number(n) === 1 ? "spoon" : "spoons";
}

export function spoonSummary(group) {
  const high = group.highest;
  const word = spoonWord(high);
  if (group.by.length === 1) {
    const who = group.by[0].isYou ? "You" : shortName(group.by[0].name);
    return `${who} · ${high} ${word}`;
  }
  return `${group.by.length} people · ${high} ${word}`;
}

export function spoonBreakdown(group) {
  if (!group.by || group.by.length < 2) return "";
  return group.by
    .map((p) => `${p.isYou ? "You" : shortName(p.name)} ${p.spoons}`)
    .join(" · ");
}

/**
 * Group one row per place inside the search radius.
 * Sort: highest spoon, then how many people, then distance. No average.
 */
export function groupSpoons(records, { lat, lng, radiusKm, me, limit = 10 }) {
  const byPlace = new Map();
  for (const r of records) {
    if (!r || !r.placeId || r.lat == null || r.lng == null) continue;
    const spoons = Number(r.spoons);
    if (spoons < 1 || spoons > 3) continue;
    const distanceKm = haversineKm(lat, lng, r.lat, r.lng);
    if (distanceKm == null || distanceKm > radiusKm) continue;
    let g = byPlace.get(r.placeId);
    if (!g) {
      g = {
        placeId: r.placeId,
        name: r.name || "Unnamed",
        lat: r.lat,
        lng: r.lng,
        distanceKm,
        by: [],
      };
      byPlace.set(r.placeId, g);
    }
    if (distanceKm < g.distanceKm) g.distanceKm = distanceKm;
    if (r.name) g.name = r.name;
    const isYou = !!(me && r.userId === me);
    if (g.by.some((p) => p.userId === r.userId)) continue;
    g.by.push({
      userId: r.userId,
      name: r.userName || "Someone",
      spoons,
      isYou,
    });
  }

  const groups = [...byPlace.values()];
  for (const g of groups) {
    g.by.sort((a, b) => b.spoons - a.spoons || shortName(a.name).localeCompare(shortName(b.name)));
    g.highest = g.by.reduce((m, p) => Math.max(m, p.spoons), 0);
    g.people = g.by.length;
    g.line = spoonSummary(g);
    g.breakdown = spoonBreakdown(g);
  }

  groups.sort((a, b) =>
    b.highest - a.highest ||
    b.people - a.people ||
    a.distanceKm - b.distanceKm ||
    a.name.localeCompare(b.name)
  );

  return groups.slice(0, limit).map((g) => ({
    placeId: g.placeId,
    name: g.name,
    lat: g.lat,
    lng: g.lng,
    distanceKm: g.distanceKm,
    highest: g.highest,
    people: g.people,
    line: g.line,
    breakdown: g.breakdown,
    by: g.by.map(({ name, spoons, isYou }) => ({ name, spoons, isYou })),
  }));
}

const PLACE_ID = /\b(ChIJ[A-Za-z0-9_-]{8,})\b/;

export function isShortMapsUrl(url) {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)goo\.gl$/i.test(host) || host === "maps.app.goo.gl";
  } catch {
    return false;
  }
}

/**
 * Pull a place id, a name, and a pin out of a Google Maps share.
 * Short links are returned as shortUrl so the caller can follow them first.
 */
export function parseMapsShare(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  let url = null;
  if (urlMatch) {
    try { url = new URL(urlMatch[0].replace(/[),.;]+$/, "")); } catch { url = null; }
  }

  if (url && isShortMapsUrl(url.toString())) {
    return { shortUrl: url.toString(), placeId: null, query: null, lat: null, lng: null };
  }

  const placeId = (text.match(PLACE_ID) || [])[1] || null;
  let lat = null;
  let lng = null;
  let query = null;

  if (url) {
    const at = url.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (at) { lat = Number(at[1]); lng = Number(at[2]); }
    const data = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (data) { lat = Number(data[1]); lng = Number(data[2]); }
    const named = url.pathname.match(/\/place\/([^/@]+)/);
    if (named) query = decodeURIComponent(named[1].replace(/\+/g, " "));
    const q = url.searchParams.get("q") || url.searchParams.get("query");
    if (!query && q && !PLACE_ID.test(q)) query = q;
  }

  if (!query && !url && !placeId) {
    query = text.slice(0, 120);
  }

  if (!placeId && !query && lat == null) return null;
  return { shortUrl: null, placeId, query, lat, lng };
}
