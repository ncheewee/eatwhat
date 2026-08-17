/**
 * EatWhat ranking — a ladder, not a score soup.
 *
 * First matching rung wins. Distance and rating only break ties inside a
 * rung. Soft prefs (budget, MRT, taste) cannot jump a rung.
 *
 *   liked     — you already said yes
 *   michelin  — verified guide
 *   creator   — GetFed / Alderic named it
 *   media     — a food blog named it
 *   hawker    — a real stall in a hawker centre / eating house
 *   other     — everyone else, by rating and distance
 */

import { matchesKnownHawkerCentre } from "./hawker-centres.js";
import { isCreatorSource } from "./curated-gems.js";

export const RUNGS = ["liked", "michelin", "creator", "media", "hawker", "other"];

// Gap is larger than any quality + soft total (~40), so rungs cannot leapfrog.
const RUNG_GAP = 1000;
const RUNG_INDEX = { liked: 5, michelin: 4, creator: 3, media: 2, hawker: 1, other: 0 };

const FOODCOURT_HINTS = /\bfood court\b|koufu|kopitiam|food republic|food junction|foodfare|deppa food hall|food opera/i;
const HAWKER_HINTS = /\bhawker\b|\beating house\b|\bcoffee ?shop\b|\bfood centre\b|\bfood center\b/i;

const TRADITIONAL_HINTS = /hawker|kopitiam|food court|coffee house|zi char|teochew|hainanese|heritage/i;
const MODERN_HINTS = /fine dining|contemporary|omakase|degustation|tasting menu|wine bar|cocktail/i;
const HALAL_HINTS = /halal|muslim/i;
const PORK_HINTS = /pork|bak kut teh|char siu|bak kwa|lard/i;
const BEEF_HINTS = /beef|steak|wagyu/i;
const VEGETARIAN_TYPES = /vegetarian|vegan/i;

const PRICE_MAP = {
  $: "PRICE_LEVEL_INEXPENSIVE",
  $$: "PRICE_LEVEL_MODERATE",
  $$$: "PRICE_LEVEL_EXPENSIVE",
};

export { FOODCOURT_HINTS };

export function classifyVenue(v) {
  const text = `${v.name} ${v.typeLabel || ""} ${v.primaryType || ""}`;
  const address = v.formattedAddress || "";
  if (FOODCOURT_HINTS.test(text) || FOODCOURT_HINTS.test(address)) return "foodcourt";
  if (HAWKER_HINTS.test(text) || HAWKER_HINTS.test(address)) return "hawker";
  if (matchesKnownHawkerCentre(address)) return "hawker";
  return "restaurant";
}

function venueText(v) {
  return `${v.name} ${v.typeLabel || ""} ${(v.types || []).join(" ")}`;
}

/** True when the user's dietary "no" clashes with the venue name/type. */
export function dietaryClash(v, dietary) {
  if (!dietary || !dietary.length) return false;
  const text = venueText(v);
  const wantsVeg = dietary.includes("vegetarian") || dietary.includes("vegan");
  if (wantsVeg && (PORK_HINTS.test(text) || BEEF_HINTS.test(text))) return true;
  if ((dietary.includes("halal") || dietary.includes("no_pork")) && PORK_HINTS.test(text)) return true;
  if (dietary.includes("no_beef") && BEEF_HINTS.test(text)) return true;
  return false;
}

export function venueRung({ isLiked, mich, curated, category }) {
  if (isLiked) return "liked";
  if (mich) return "michelin";
  if (curated && isCreatorSource(curated.source)) return "creator";
  if (curated) return "media";
  if (category === "hawker") return "hawker";
  return "other";
}

function qualityScore(v) {
  const cappedReviews = Math.min(v.reviewCount || 0, 3000);
  let score = (v.rating || 0) * Math.log10(cappedReviews + 1);
  if (v.reviewCount > 8000) score -= Math.min((v.reviewCount - 8000) / 4000, 3);
  if (v.distanceKm != null) score -= v.distanceKm * 0.8;
  return score;
}

function stylePrefBonus(v, style) {
  if (!style || style === "either") return 0;
  const text = venueText(v);
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
  if (ambience === "minimal" && v.priceSymbol === "$") return 1;
  return 0;
}

function dietaryMatchBonus(v, dietary) {
  if (!dietary || !dietary.length) return 0;
  const text = venueText(v);
  const types = (v.types || []).join(" ");
  let score = 0;
  if ((dietary.includes("vegetarian") || dietary.includes("vegan")) &&
      (VEGETARIAN_TYPES.test(types) || VEGETARIAN_TYPES.test(text))) {
    score += 2;
  }
  if (dietary.includes("halal") && HALAL_HINTS.test(text)) score += 2;
  return score;
}

function noveltyBonus(novelty, isRecent) {
  if (!novelty || novelty === "mix" || !isRecent) return 0;
  if (novelty === "repeat") return 4;
  if (novelty === "explore") return -6;
  return 0;
}

function softScore(v, { hype, mich, prefs, isRecent, budget, transitOnly, nearStation }) {
  let score = 0;
  if (mich) score += mich.weight || 0;
  if (hype?.trending) score += 2;
  if (hype?.reviewedBy) score += 1;
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
    score += dietaryMatchBonus(v, prefs.dietary);
    score += noveltyBonus(prefs.novelty, isRecent);
  }
  return score;
}

export function scoreVenue(v, ctx) {
  const rung = ctx.rung || venueRung(ctx);
  return RUNG_INDEX[rung] * RUNG_GAP + qualityScore(v) + softScore(v, ctx);
}

function whyTail(v) {
  const parts = [];
  if (v.priceSymbol) parts.push(v.priceSymbol);
  if (v.rating) parts.push(`${v.rating.toFixed(1)}★`);
  if (v.distanceKm != null) parts.push(`${v.distanceKm}km`);
  if (v.openNow === true) parts.push("open now");
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function michWhy(mich, v) {
  if (!mich) return null;
  const map = {
    three_star: "Three MICHELIN stars",
    two_star: "Two MICHELIN stars",
    one_star: "MICHELIN starred",
    bib_gourmand: "Bib Gourmand · great value",
    selected: "In the MICHELIN Guide",
  };
  return (map[mich.tier] || "In the MICHELIN Guide") + whyTail(v);
}

/** One sentence: the rung that won, plus close/open facts. */
export function buildWhy({ rung, mich, curated, v }) {
  switch (rung) {
    case "liked":
      return "You liked this" + whyTail(v);
    case "michelin":
      return michWhy(mich, v);
    case "creator":
    case "media":
      return `${curated.source} pick` + whyTail(v);
    case "hawker":
      return "Hawker stall" + whyTail(v);
    default:
      return (v.openNow ? "Nearby and open now" : "Well rated nearby") + whyTail(v);
  }
}

export function rankVenues(venues) {
  return [...venues].sort((a, b) => b._score - a._score);
}
