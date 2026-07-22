/**
 * Curated food-media "gems" — venues named by human food writers, bloggers,
 * and video reviewers (Eatbook, ladyironchef, Miss Tam Chiak, Danielfooddiary,
 * SethLui, r/singaporefood, YouTube food channels), rather than inferred from
 * Google Places review volume/rating.
 *
 * WHY THIS EXISTS: Google Places' popularity/rating signal structurally
 * favours venues with heavy, digitally-active review traffic (newer cafes,
 * mall spots) over old-school hawker stalls that can be genuinely famous by
 * word of mouth while carrying far fewer Google reviews. A 2026-07-22 test
 * against Eatbook's own Bishan/Ang Mo Kio/Thomson guides found only 1-3 out
 * of 10-24 named picks per neighbourhood surfacing through Places-only
 * scoring — tuning weights on the same signal doesn't fix that; a second,
 * independent discovery source does.
 *
 * SOURCE TIERS: not all curated sources are trusted equally. Per Chee Wee's
 * 2026-07-22 direction, named video creators he personally follows/trusts
 * (GetFed's Ryan Tan — née "Food King"; Alderic/@aldericc) outrank the
 * written food-media outlets (Eatbook, Miss Tam Chiak, etc.), which in turn
 * outrank the generic $-price+rating hawker fallback proxy. See
 * SOURCE_WEIGHT below and weightForSource() — index.js's scoreVenue() reads
 * from this instead of a flat bonus, and consulted before it, not "instead
 * of": a Michelin match still takes priority over any curated source.
 *
 * SCHEMA: each entry is { name, area, source } — `area` is informational
 * (helps a human auditor sanity-check matches at a glance) and is NOT used
 * for geographic filtering; matching is purely by normalised name against
 * whatever Places already returned for the user's actual search radius.
 *
 * REFRESH: like michelin.js, this embedded seed is a fallback. Push updates
 * without redeploying via:
 *   wrangler kv key put --binding=SEARCH_CACHE "curated:list" --path ./curated-2026.json
 * (a JSON array of {name, area, source} objects, same shape as GEMS below).
 *
 * ⚠️ REVISIT SCHEDULE: re-scan source blogs/videos and refresh this list
 *    periodically (see the `curated-gems-refresh` scheduled task) — food
 *    media coverage turns over faster than Michelin's annual cycle.
 */

export const GEMS = [
  // --- Bishan (Eatbook "Bishan Food Guide" 2024 + 2017 "Under $15") ---
  { name: "Shi Xiang Ge", area: "Bishan", source: "Eatbook" },
  { name: "Jiak Mee", area: "Bishan", source: "Eatbook" },
  { name: "Uncle Penyet", area: "Bishan", source: "Eatbook" },
  { name: "Ming Kee Chicken Rice", area: "Bishan", source: "Eatbook" },
  { name: "284 Kway Chap", area: "Bishan", source: "Eatbook" },
  { name: "Wei Ji Congee", area: "Bishan", source: "Eatbook" },
  { name: "Mr Egg Fried Rice", area: "Bishan", source: "Eatbook" },
  { name: "Yang Ming Seafood", area: "Bishan", source: "Eatbook" },
  { name: "Yung Yung", area: "Bishan", source: "Eatbook" },
  { name: "Galangal", area: "Bishan", source: "Eatbook" },
  { name: "Ding Ji Mushroom Minced Meat Noodles", area: "Bishan", source: "Eatbook" },
  { name: "吃Western", area: "Bishan", source: "Eatbook" },
  { name: "The Wholefood Kitchen", area: "Bishan", source: "Eatbook" },
  { name: "Jai Thai", area: "Bishan", source: "Eatbook" },
  { name: "Grin Affair", area: "Bishan", source: "Eatbook" },
  { name: "Two Chefs Eating Place", area: "Bishan", source: "Eatbook" },
  { name: "Soul Kitchen", area: "Bishan", source: "Eatbook" },
  { name: "Rong Cheng Bak Kut Teh", area: "Bishan", source: "Eatbook" },
  { name: "Crusty Oven", area: "Bishan", source: "Eatbook" },

  // --- Ang Mo Kio (Eatbook "24 Ang Mo Kio Food Gems" 2024) ---
  { name: "Dim Sum Express", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Shanghai Renjia", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Fish & Chicks", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Phuket Town Mookata", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "SteakGrill", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Rahim Muslim Food", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Abang Gemuk", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Banh Mi Sai Gon", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Magic Kitchen", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Jian Zao Ipoh Curry Noodles", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Eng Kee Bak Kut Teh", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Rasa Sayang", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Teck Kee Cooked Food", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Avocadoria", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Teng Sheng Korean BBQ Buffet", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "OK Chicken Rice", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Humfull Laksa", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Hong Heng Beef Noodle Soup", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Soi 19 Thai Wanton Mee", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "BCD Tofu", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "No Horse Run Cafe", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Wonders Cafe", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "F.I.C.", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Lao San Kway Chap", area: "Ang Mo Kio", source: "Eatbook" },

  // --- Thomson / Upper Thomson (Eatbook "Thomson Plaza Food Guide" Feb 2026) ---
  // Note: this source skews mall-restaurant rather than street-level hawker —
  // flagged as weaker evidence in the 2026-07-22 D20 test writeup. Worth
  // supplementing with an Upper Thomson-specific hawker/kopitiam scan later.
  { name: "Omoté", area: "Thomson", source: "Eatbook" },
  { name: "Wonderful Bapsang", area: "Thomson", source: "Eatbook" },
  { name: "Hokkaido-ya", area: "Thomson", source: "Eatbook" },
  { name: "Nan Yang Dao", area: "Thomson", source: "Eatbook" },
  { name: "Peach Garden", area: "Thomson", source: "Eatbook" },
  { name: "Shi Li Fang", area: "Thomson", source: "Eatbook" },
  { name: "Hajime Tonkatsu & Ramen", area: "Thomson", source: "Eatbook" },
  { name: "Tsukada Nojo", area: "Thomson", source: "Eatbook" },
  { name: "San Ren Xing", area: "Thomson", source: "Eatbook" },

  // --- GetFed / Ryan Tan (Night Owl Cinematics) — formerly "Food King" ---
  // Sourced from overkill.sg's written recaps of Get Fed episodes 3, 5 and 7
  // (2026-07-22), which list Ryan's specific standing recommendations with
  // addresses. Highest-weighted tier — see SOURCE_WEIGHT below.
  { name: "Hainan Fried Hokkien Mee", area: "Golden Mile Food Centre", source: "GetFed" }, // Ryan's all-time favourite hokkien mee
  { name: "Heng Huat Fried Kway Tiao", area: "Pasir Panjang", source: "GetFed" },
  { name: "Classic Cakes", area: "Sunset Way", source: "GetFed" },
  { name: "Beach Road Prawn Noodle House", area: "East Coast", source: "GetFed" },
  { name: "Union Farm Chee Pow Kai", area: "Toh Guan", source: "GetFed" },
  { name: "Joo Siah Bak Kut Teh", area: "Jurong East", source: "GetFed" },
  { name: "88 Hong Kong Roast Meat Specialist", area: "Lavender", source: "GetFed" },
  { name: "Yong Chun Wan Ton Noodle", area: "Bukit Merah", source: "GetFed" },
  { name: "Dickson Nasi Lemak", area: "Joo Chiat", source: "GetFed" },
  { name: "Petit Pain", area: "Joo Chiat", source: "GetFed" },

  // --- Alderic (@aldericc, Instagram/TikTok/YouTube) ---
  // Sourced from his "Top 5 Places to Eat in Singapore" video and separate
  // laksa/mala top-picks videos (2026-07-22 search). Highest-weighted tier.
  { name: "George's Katong Laksa", area: "Katong", source: "Alderic" },
  { name: "A Hot Hideout", area: "Woodlands", source: "Alderic" }, // his mala top pick
  { name: "Umai", area: "Beach Road", source: "Alderic" },
  { name: "Sweedy", area: "Hougang", source: "Alderic" },
  { name: "Bao Er Cafe", area: "Balestier", source: "Alderic" },
  { name: "Kobashi", area: "South Bridge Road", source: "Alderic" },
  { name: "Dawn", area: "South Bridge Road", source: "Alderic" },
];

/**
 * Higher weight = more trusted. Consulted by scoreVenue() in index.js in
 * place of the old flat +7 curated bonus. Update this table (rather than
 * touching index.js) whenever a new source tier needs adding — e.g. if
 * Chee Wee names another YouTuber/blogger he weighs highly.
 */
export const SOURCE_WEIGHT = {
  GetFed: 10,
  Alderic: 10,
  Eatbook: 7,
};
const DEFAULT_SOURCE_WEIGHT = 7; // any future source not listed above (e.g. ladyironchef, Miss Tam Chiak) defaults here

export function weightForSource(source) {
  return SOURCE_WEIGHT[source] ?? DEFAULT_SOURCE_WEIGHT;
}

/** Same normalisation as michelin.js so the two indexes behave consistently. */
function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(restaurant|pte|ltd|singapore|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the lookup map: normalised name → { area, source, original }. */
export function buildCuratedIndex(data) {
  const src = data || GEMS;
  const index = new Map();
  for (const g of src) {
    const key = normalizeName(g.name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, { area: g.area, source: g.source, original: g.name });
  }
  return { index };
}

/**
 * Look up a Google Places name against the curated-gems index.
 * Exact normalised match first, then the same guarded prefix-fuzzy match
 * michelin.js uses, for the same reason (e.g. Places appending a unit/branch
 * suffix that the blog's name doesn't have).
 */
export function lookupCurated(placeName, built) {
  const key = normalizeName(placeName);
  if (!key) return null;

  const direct = built.index.get(key);
  if (direct) return direct;

  if (key.length >= 10) {
    for (const [gKey, val] of built.index) {
      if (gKey.length < 10) continue;
      if (key === gKey) continue;
      if (key.startsWith(gKey + " ") || gKey.startsWith(key + " ")) {
        return { ...val, fuzzy: true };
      }
    }
  }
  return null;
}
