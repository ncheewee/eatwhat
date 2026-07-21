/**
 * Curated list of well-known Singapore hawker centres and markets.
 *
 * Why this exists: a hawker stall's own Google Places display name almost
 * never says "hawker centre" (it's usually just the stall's name, e.g.
 * "Heng Kee Fishball Noodle") — but its formattedAddress almost always
 * names the building it's in ("2 Adam Rd, Adam Road Food Centre, ..."). By
 * matching the address against this list, we can tell a stall is inside a
 * real hawker centre even when nothing about the stall's own name hints at
 * it, which is a much stronger signal than keyword-matching the stall name.
 *
 * This is a "well-known, not exhaustive" list (Singapore has 100+ NEA-run
 * hawker centres) — it covers the ones most likely to come up in everyday
 * searches. If a genuine hawker centre keeps getting missed, add its name
 * here (normalizeName handles minor punctuation/spacing differences).
 */

export const KNOWN_HAWKER_CENTRES = [
  "Maxwell Food Centre",
  "Chinatown Complex",
  "Amoy Street Food Centre",
  "Tekka Centre",
  "Tekka Market",
  "Adam Road Food Centre",
  "Chomp Chomp Food Centre",
  "Old Airport Road Food Centre",
  "Tiong Bahru Market",
  "Bukit Timah Market",
  "Newton Food Centre",
  "Lau Pa Sat",
  "East Coast Lagoon Food Village",
  "Bedok Interchange Hawker Centre",
  "Ghim Moh Market",
  "Alexandra Village Food Centre",
  "Zion Riverside Food Centre",
  "Whampoa Makan Place",
  "Golden Mile Food Centre",
  "People's Park Food Centre",
  "Berseh Food Centre",
  "Yishun Park Hawker Centre",
  "Pasir Panjang Food Centre",
  "Redhill Food Centre",
  "Tanglin Halt Market",
  "Holland Village Market",
  "Toa Payoh Lorong 8 Market",
  "Bukit Merah View Market",
  "Serangoon Garden Market",
  "Sembawang Hawker Centre",
  "Woodlands 685",
  "Marsiling Mall Hawker Centre",
  "Yishun 925 Food Centre",
  "Oasis Terraces",
  "Rivervale Plaza Hawker Centre",
  "Hougang 105 Hawker Centre",
  "Bedok Marketplace",
  "Kim San Leng Food Centre",
  "Chong Boon Market",
  "Beo Crescent Market",
  "Dunman Food Centre",
  "Geylang Serai Market",
  "Haig Road Market",
  "Kovan 209 Market",
  "Jurong West 505 Market",
  "Boon Lay Place Market",
  "Fengshan Market",
  "Our Tampines Hub Hawker Centre",
  "Tampines Round Market",
  "Loyang Point Hawker Centre",
  "Beach Road Food Centre",
];

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED = KNOWN_HAWKER_CENTRES.map(normalize);

export function matchesKnownHawkerCentre(addressOrName) {
  const text = normalize(addressOrName);
  if (!text) return false;
  return NORMALIZED.some((centre) => text.includes(centre));
}
