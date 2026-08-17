/**
 * Neighbourhood centroids for gem discovery.
 *
 * Intent: only Text-Search a curated gem when its area is plausibly near
 * the search pin. The radius check on the resolved place is still the
 * source of truth — this just skips the API call for far-away names.
 */

export function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat2 == null || lon2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Keys are normalised area strings used in curated-gems.js and the frontend picker.
const AREA_CENTROIDS = {
  "alexandra village": [1.2735, 103.8025],
  "ang mo kio": [1.3691, 103.8454],
  "anson road": [1.2742, 103.8456],
  "balestier": [1.326, 103.8525],
  "beach road": [1.2965, 103.8575],
  "bedok": [1.3236, 103.9273],
  "bishan": [1.3506, 103.8486],
  "bugis rochor": [1.2996, 103.8558],
  "bukit batok": [1.359, 103.7637],
  "bukit merah": [1.282, 103.818],
  "bukit panjang": [1.3774, 103.7719],
  "bukit timah": [1.3294, 103.8021],
  "changi": [1.34, 103.98],
  "choa chu kang": [1.384, 103.747],
  "clementi": [1.3151, 103.7654],
  "downtown core raffles place": [1.2839, 103.8517],
  "east coast": [1.301, 103.906],
  "eunos": [1.3197, 103.903],
  "geylang": [1.318, 103.893],
  "geylang paya lebar": [1.318, 103.893],
  "golden mile": [1.303, 103.8638],
  "golden mile food centre": [1.303, 103.8638],
  "havelock road": [1.2885, 103.8355],
  "holland village": [1.3113, 103.7963],
  "hong lim": [1.285, 103.8458],
  "hougang": [1.3712, 103.8925],
  "jalan berseh": [1.3075, 103.8545],
  "jalan besar": [1.3085, 103.857],
  "joo chiat": [1.3135, 103.8995],
  "jurong east": [1.3329, 103.7436],
  "jurong west": [1.3404, 103.709],
  "kallang": [1.3115, 103.865],
  "kampong glam": [1.3021, 103.8598],
  "katong": [1.305, 103.9005],
  "katong east coast": [1.301, 103.906],
  "kovan": [1.3602, 103.885],
  "lavender": [1.3074, 103.8629],
  "little india": [1.3067, 103.8517],
  "loyang": [1.37, 103.973],
  "macpherson": [1.3265, 103.8895],
  "marina bay": [1.2807, 103.86],
  "maxwell food centre": [1.2804, 103.8448],
  "newton": [1.3128, 103.8382],
  "novena": [1.3204, 103.8437],
  "orchard": [1.3048, 103.8318],
  "outram chinatown": [1.2825, 103.8443],
  "pasir ris": [1.3721, 103.9494],
  "pasir panjang": [1.276, 103.7915],
  "punggol": [1.4043, 103.902],
  "queenstown": [1.2942, 103.806],
  "sembawang": [1.4491, 103.8185],
  "sengkang": [1.3868, 103.8914],
  "serangoon": [1.3554, 103.8679],
  "serangoon north": [1.373, 103.8735],
  "serangoon road": [1.3067, 103.8517],
  "south bridge road": [1.2825, 103.8443],
  "sunset way": [1.3255, 103.7685],
  "tampines": [1.3496, 103.945],
  "tanjong pagar": [1.2762, 103.8455],
  "tekka": [1.3063, 103.8505],
  "telok blangah": [1.2705, 103.8095],
  "thomson": [1.3547, 103.8325],
  "thomson upper thomson": [1.3547, 103.8325],
  "tiong bahru": [1.286, 103.827],
  "tiong bahru bukit merah": [1.282, 103.818],
  "toa payoh": [1.3343, 103.8563],
  "toh guan": [1.337, 103.7465],
  "upper thomson": [1.3547, 103.8325],
  "west coast": [1.302, 103.766],
  "whampoa": [1.3245, 103.8565],
  "woodlands": [1.436, 103.786],
  "yishun": [1.4295, 103.8353],
};

export function areaCentroid(area) {
  const key = norm(area);
  if (!key) return null;
  if (AREA_CENTROIDS[key]) return AREA_CENTROIDS[key];
  for (const [name, ll] of Object.entries(AREA_CENTROIDS)) {
    if (key.includes(name) || name.includes(key)) return ll;
  }
  return null;
}

/**
 * Whether a gem's listed area is close enough to bother resolving.
 * `true` / `false` when we have a centroid; `null` when the area is unknown
 * (caller should still resolve — better a wasted lookup than a missed gem).
 */
export function gemAreaNearPin(area, lat, lng, radiusKm, padKm = 3) {
  const c = areaCentroid(area);
  if (!c) return null;
  const d = haversineKm(lat, lng, c[0], c[1]);
  return d != null && d <= radiusKm + padKm;
}
