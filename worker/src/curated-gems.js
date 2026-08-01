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
  { name: "Ming Kee Chicken Rice", area: "Bishan", source: "Eatbook" },
  { name: "284 Kway Chap", area: "Bishan", source: "Eatbook" },
  { name: "Wei Ji Congee", area: "Bishan", source: "Eatbook" },
  { name: "Mr Egg Fried Rice", area: "Bishan", source: "Eatbook" },
  { name: "Yang Ming Seafood", area: "Bishan", source: "Eatbook" },
  { name: "Galangal", area: "Bishan", source: "Eatbook" },
  { name: "Ding Ji Mushroom Minced Meat Noodles", area: "Bishan", source: "Eatbook" },
  { name: "吃Western", area: "Bishan", source: "Eatbook" },
  { name: "The Wholefood Kitchen", area: "Bishan", source: "Eatbook" },
  { name: "Jai Thai", area: "Bishan", source: "Eatbook" },
  { name: "Grin Affair", area: "Bishan", source: "Eatbook" },
  { name: "Two Chefs Eating Place", area: "Bishan", source: "Eatbook" },
  { name: "Crusty Oven", area: "Bishan", source: "Eatbook" },

  // --- Ang Mo Kio (Eatbook "24 Ang Mo Kio Food Gems" 2024) ---
  { name: "Dim Sum Express", area: "Ang Mo Kio", source: "Eatbook" },
  // 2026-08-01 gem-health: Shanghai Renjia reported CLOSED_TEMPORARILY.
  // Left in place per policy (runPipeline filters it out while closed);
  // remove if it is still not OPERATIONAL on the next refresh.
  { name: "Shanghai Renjia", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Phuket Town Mookata", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "SteakGrill", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Rahim Muslim Food", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Abang Gemuk", area: "Ang Mo Kio", source: "Eatbook" },
  // Pruned Jul 2026 via GET /api/gem-health, all CLOSED_PERMANENTLY:
  //   Uncle Penyet, Yung Yung, Soul Kitchen, Rong Cheng Bak Kut Teh (Bishan)
  //   Fish & Chicks, Soi 19 Thai Wanton Mee, Wonders Cafe (Ang Mo Kio)
  //   Dickson Nasi Lemak (Joo Chiat)
  // Re-run gem-health before adding anything back from an older blog listing.
  //
  // Removed Jul 2026: "OK Chicken Rice" and "Humfull Laksa" were two entries
  // pointing at one venue (721 Ang Mo Kio Ave 8), and it is CLOSED_PERMANENTLY.
  // The pipeline now filters on businessStatus regardless — dropping them here
  // just stops paying for a Text Search that can never yield a suggestion.
  // Do not re-add from a stale Eatbook listing.
  { name: "Banh Mi Sai Gon", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Magic Kitchen", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Jian Zao Ipoh Curry Noodles", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Eng Kee Bak Kut Teh", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Rasa Sayang", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Teck Kee Cooked Food", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Avocadoria", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Teng Sheng Korean BBQ Buffet", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "Hong Heng Beef Noodle Soup", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "BCD Tofu", area: "Ang Mo Kio", source: "Eatbook" },
  { name: "No Horse Run Cafe", area: "Ang Mo Kio", source: "Eatbook" },
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
  // Added 2026-08-01 from Alderic's ranked dish-by-dish series (@Alderic. on
  // YouTube, @aldericc on TikTok/IG): the hokkien mee top 3 + dry mention as
  // recorded by Mothership's writeup of his 16-stall spreadsheet, plus his
  // laksa episode picks and Top 5 Places To Eat In Singapore 2026.
  // Skipped Hainan Fried Hokkien Prawn Mee (his best-dry pick) — already in
  // the list above as a GetFed entry, and both tiers weigh 10 anyway.
  { name: "Xiao Di Fried Prawn Noodle", area: "Serangoon North", source: "Alderic" }, // his #1 hokkien mee
  { name: "Come Daily Fried Hokkien Mee", area: "Toa Payoh", source: "Alderic" },
  { name: "Swee Guan Hokkien Mee", area: "Geylang", source: "Alderic" },
  { name: "Simon Road Hokkien Mee", area: "Kovan", source: "Alderic" },
  { name: "Depot Road Zhen Shan Mei Claypot Laksa", area: "Alexandra Village", source: "Alderic" },
  { name: "928 Yishun Laksa", area: "Yishun", source: "Alderic" },
  { name: "89 Carrot Cake", area: "MacPherson", source: "Alderic" },
  { name: "The Cider Pit", area: "Joo Chiat", source: "Alderic" },

  // --- Alderic, annual "Top 5 Places To Eat In Singapore" + series winners ---
  // Added 2026-08-01 from Chee Wee's compilation of the channel's 2024/2025/2026
  // Top 5 videos and the "Best of [Dish]" series winners. Excluded three items
  // from that compilation that cannot resolve to a single Places venue:
  // "Cai Fan" and "Pandan waffle" (island-wide/generic categories, not venues)
  // and Chomp Chomp Food Centre (a hawker centre — belongs in hawker-centres.js,
  // not here). Also skipped Hill Street Tai Hwa Pork Noodle (already carried by
  // michelin.js, which outranks curated anyway), plus "No. 25" (too generic to
  // Text Search reliably) and Seng Kee (original outlet closed).
  { name: "Fan Ji Speciality Noodle", area: "West Coast", source: "Alderic" }, // 2026 #1
  { name: "Ah Jie Hokkien Mee", area: "Ang Mo Kio", source: "Alderic" },
  { name: "Loyang Way Big Prawn Noodles", area: "Loyang", source: "Alderic" },
  { name: "Generation Coffee Roasters", area: "Hong Lim", source: "Alderic" },
  { name: "Le Cheng Kampong Hainanese Chicken Rice", area: "Eunos", source: "Alderic" }, // 2025 #1
  { name: "Sungei Road Laksa", area: "Jalan Berseh", source: "Alderic" },
  { name: "545 Whampoa Prawn Noodles", area: "Tekka", source: "Alderic" },
  { name: "Ah Seng Durian", area: "Alexandra Village", source: "Alderic" },
  { name: "Sin Hoi Sai Eating House", area: "East Coast", source: "Alderic" },
  { name: "Katong Mei Wei Boneless Chicken Rice", area: "Katong", source: "Alderic" }, // 2024 #1
  { name: "Hougang Oyster Omelette & Fried Kway Teow", area: "Hougang", source: "Alderic" },
  { name: "Laifaba Wanton Noodles & Roasted Meats", area: "Bukit Batok", source: "Alderic" },
  { name: "Keng Eng Kee Seafood", area: "Alexandra Village", source: "Alderic" },
  { name: "Jin Xi Lai Minced Meat Noodle", area: "Jalan Besar", source: "Alderic" }, // bak chor mee series winner
  { name: "Hock Lai Seng", area: "Bukit Merah", source: "Alderic" },
  { name: "Ah Huat Hokkien Mee", area: "Punggol", source: "Alderic" },
  { name: "Brothers Ramen", area: "Anson Road", source: "Alderic" },
  { name: "The Coconut Club", area: "Beach Road", source: "Alderic" },
  { name: "Chef Kang's Noodle House", area: "Toa Payoh", source: "Alderic" },
  { name: "Azmi Restaurant", area: "Serangoon Road", source: "Alderic" },
  { name: "Meng Kee Fried Kway Teow", area: "Whampoa", source: "Alderic" },
  { name: "Tuan Yuan Pork Ribs Soup", area: "Havelock Road", source: "Alderic" },
  { name: "Hill Street Fried Kway Teow", area: "Bedok", source: "Alderic" },
  { name: "Hai Kee Teo", area: "Telok Blangah", source: "Alderic" },
  { name: "Chicken House", area: "Thomson", source: "Alderic" },
  { name: "Ji Zai Ji", area: "Golden Mile", source: "Alderic" },

  // --- Upper Thomson / Shunfu (Eatbook "Shunfu Mart Food Centre Guide") ---
  // Added 2026-08-01 to close the street-level-hawker gap flagged in the
  // Thomson block above: Shunfu Mart is a 7-min walk from Upper Thomson MRT
  // and is all hawker stalls rather than mall restaurants.
  { name: "Leong Hainanese Chicken Rice", area: "Upper Thomson", source: "Eatbook" },
  { name: "Dong Nan Wanton Noodles", area: "Upper Thomson", source: "Eatbook" },
  { name: "Chocolat N' Spice", area: "Upper Thomson", source: "Eatbook" },
  { name: "Lai Heng Fried Kuay Teow", area: "Upper Thomson", source: "Eatbook" },
  { name: "Marsiling Teochew Fish Soup", area: "Upper Thomson", source: "Eatbook" },
  { name: "Wak Limah Stall", area: "Upper Thomson", source: "Eatbook" },
  { name: "Quan Ann Prawn Mee", area: "Upper Thomson", source: "Eatbook" },
  { name: "Mei Zhen Hakka Delicacies", area: "Upper Thomson", source: "Eatbook" },
  { name: "Huat Heng Fried Prawn Mee", area: "Upper Thomson", source: "Eatbook" },
  { name: "Heng Heng Bao Bing", area: "Upper Thomson", source: "Eatbook" },

  // --- Toa Payoh (Eatbook area guide + SethLui "Toa Payoh Lorong 8 Market &
  //     Food Centre", updated Aug 2025) ---
  // Added 2026-08-01. Deliberately skipped the 2015-era hipster cafes in the
  // Eatbook listing (Shrove Tuesday, The Daily Press, JQ Chef Cafe, Frozen By
  // A Thousand Blessings) — high closure risk on an 11-year-old article. The
  // entries below are long-running hawker stalls. Do not re-add those cafes
  // from the same listing without first confirming they still trade.
  { name: "Teochew Handmade Bao", area: "Toa Payoh", source: "Eatbook" },
  { name: "Chey Sua Carrot Cake", area: "Toa Payoh", source: "Eatbook" },
  { name: "Tian Tian Lai Hokkien Mee", area: "Toa Payoh", source: "Eatbook" },
  { name: "Lau Sim Shredded Chicken Noodles", area: "Toa Payoh", source: "Eatbook" },
  { name: "Uncle Gen's Hong Kong Cuisine", area: "Toa Payoh", source: "Eatbook" },
  { name: "Soon Heng Rojak", area: "Toa Payoh", source: "Eatbook" },
  { name: "Hougang 6 Mile Famous Muah Chee", area: "Toa Payoh", source: "Eatbook" },
  { name: "Creamier", area: "Toa Payoh", source: "Eatbook" },
  { name: "J99 Eating House", area: "Toa Payoh", source: "Eatbook" },
  { name: "Hai Kee Noodle", area: "Toa Payoh", source: "SethLui" },
  { name: "Wanted Western Delights", area: "Toa Payoh", source: "SethLui" },
  { name: "Sin Sin Prawn Crackers", area: "Toa Payoh", source: "SethLui" },
  { name: "Nine Stone Avenue", area: "Toa Payoh", source: "SethLui" },
  { name: "Li Huat Hot & Cold Cheng Tng", area: "Toa Payoh", source: "SethLui" },
  { name: "Da Lao Fried White Kway Teow", area: "Toa Payoh", source: "SethLui" },
  { name: "Hock Kee Bak Kut Teh", area: "Toa Payoh", source: "SethLui" },
  { name: "Allauddin's Briyani", area: "Toa Payoh", source: "SethLui" },
  { name: "No.9 Thai Kitchen", area: "Toa Payoh", source: "SethLui" },
  { name: "Coffee House Banh Mi", area: "Toa Payoh", source: "SethLui" },

  // --- Tampines (Eatbook "25 Tampines Hawker Food", Aug 2025 + SethLui
  //     "Tampines Round Market & Food Centre") ---
  // Added 2026-08-01.
  { name: "Old World Bakuteh", area: "Tampines", source: "Eatbook" },
  { name: "Ho Yun Tim Sum", area: "Tampines", source: "Eatbook" },
  { name: "Chai Chee Pork Porridge", area: "Tampines", source: "Eatbook" },
  { name: "Nasi Lemak Specialist", area: "Tampines", source: "Eatbook" },
  { name: "Fu Yuan Teochew Bak Chor Mee", area: "Tampines", source: "Eatbook" },
  { name: "Yummy Sarawak Kolo Mee", area: "Tampines", source: "Eatbook" },
  { name: "Song Han Carrot Cake", area: "Tampines", source: "Eatbook" },
  { name: "Al Mahboob Indian Rojak", area: "Tampines", source: "Eatbook" },
  { name: "137 Lor Mee Prawn Mee", area: "Tampines", source: "Eatbook" },
  { name: "Mui Kee Hainanese Chicken Rice", area: "Tampines", source: "Eatbook" },
  { name: "Soi Thai Kitchen", area: "Tampines", source: "Eatbook" },
  { name: "Tokyo Western Food", area: "Tampines", source: "Eatbook" },
  { name: "Jin Hock Seafood", area: "Tampines", source: "Eatbook" },
  { name: "Shun Shun Prawn Noodles", area: "Tampines", source: "Eatbook" },
  { name: "Teo Kee Mushroom Minced Pork Noodle", area: "Tampines", source: "Eatbook" },
  { name: "Xing Ji Wanton Mee", area: "Tampines", source: "Eatbook" },
  { name: "Granny's Pancake", area: "Tampines", source: "Eatbook" },
  { name: "Rajarani Thosai", area: "Tampines", source: "Eatbook" },
  { name: "Hai Chang Fish Head Steamboat", area: "Tampines", source: "Eatbook" },
  { name: "Botak Cantonese Porridge", area: "Tampines", source: "Eatbook" },
  { name: "Yi Le Shu Shi", area: "Tampines", source: "Eatbook" },
  { name: "House of Dessert", area: "Tampines", source: "Eatbook" },
  { name: "Jin Kimchi Express", area: "Tampines", source: "Eatbook" },
  { name: "The Only Burger", area: "Tampines", source: "Eatbook" },
  { name: "Munchi Pancakes", area: "Tampines", source: "Eatbook" },
  { name: "Xin Xing Carrot Cake", area: "Tampines", source: "SethLui" },

  // --- Jurong East / Yuhua (DanielFoodDiary "11 Yuhua Market & Hawker Centre
  //     Stalls", Oct 2024) ---
  // Added 2026-08-01. Jurong East previously had exactly one entry (Joo Siah
  // Bak Kut Teh, GetFed), so west-side heartland coverage was thin.
  { name: "Lai Heng Handmade Teochew Kueh", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Hua Xing Bak Kut Teh", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Xing Yun Hainanese Boneless Chicken Rice", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Soon Lee Heng", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Simei Penang Laksa Speciality", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Poon Kee Wanton Noodle", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Famous Sungei Road Trishaw Laksa", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Jing Jing Hokkien Mee & Oyster Omelette", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Guang Tai", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Ah Wei Jing Dian", area: "Jurong East", source: "DanielFoodDiary" },
  { name: "Li Fang Zhou Pin", area: "Jurong East", source: "DanielFoodDiary" },
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
