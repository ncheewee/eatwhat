/**
 * MICHELIN Guide Singapore — curated dataset.
 *
 * Source: official MICHELIN Guide Singapore 2025 selection (announced 24 July 2025).
 * 42 Starred (3 x three-star, 7 x two-star, 32 x one-star), 89 Bib Gourmand, 157 Selected.
 *
 * ⚠️ UPDATE SCHEDULE: The MICHELIN Guide Singapore 2026 (10th edition) lands
 *    - Bib Gourmand: 28 July 2026
 *    - Stars ceremony: 04 August 2026 (Raffles Sentosa)
 * After those dates, refresh these arrays and bump GUIDE_YEAR. You can update
 * without redeploying by writing a JSON override into KV:
 *
 *   wrangler kv key put --binding=SEARCH_CACHE "michelin:list" --path ./michelin-2026.json
 *
 * The Worker reads that KV key first and falls back to this embedded seed.
 */

export const GUIDE_YEAR = 2025;

export const THREE_STAR = [
  "Les Amis",
  "Odette",
  "Zén",
];

export const TWO_STAR = [
  "Cloudstreet",
  "Jaan by Kirk Westaway",
  "Meta",
  "Saint Pierre",
  "Shoukouwa",
  "Sushi Sakuta",
  "Thevar",
];

export const ONE_STAR = [
  "Alma",
  "Araya",
  "Born",
  "Buona Terra",
  "Burnt Ends",
  "Candlenut",
  "Chaleur",
  "CUT",
  "Esora",
  "Euphoria",
  "Hamamoto",
  "Hill Street Tai Hwa Pork Noodle",
  "Iggy's",
  "Imperial Treasure Fine Teochew Cuisine (Orchard)",
  "Jag",
  "Labyrinth",
  "Lei Garden",
  "Lerouy",
  "Ma Cuisine",
  "Marguerite",
  "Nae:um",
  "Nouri",
  "Omakase @ Stevens",
  "Pangium",
  "Seroja",
  "Shisen Hanten",
  "Summer Palace",
  "Summer Pavilion",
  "Sushi Ichi",
  "Waku Ghin",
  "Whitegrass",
  "Willow",
];

export const GREEN_STAR = [
  "Fiz",
  "Seroja",
];

export const BIB_GOURMAND = [
  "A Noodle Story",
  "Adam Rd Noo Cheng Big Prawn Noodle",
  "Alliance Seafood",
  "Anglo Indian (Shenton Way)",
  "Ar Er Soup",
  "Bahrakath Mutton Soup",
  "Beach Road Fish Head Bee Hoon",
  "Bismillah Biryani (Little India)",
  "Boon Tong Kee (Balestier Road)",
  "Chai Chuan Tou Yang Rou Tang",
  "Chef Kang's Noodle House",
  "Cheok Kee",
  "Chey Sua Carrot Cake",
  "Chuan Kee Boneless Braised Duck",
  "Cumi Bali",
  "Da Shi Jia Big Prawn Mee",
  "Delhi Lahori",
  "Dudu Cooked Food",
  "Eminent Frog Porridge & Seafood (Lor 19)",
  "Fei Fei Roasted Noodle",
  "Fico",
  "Fu Ming Cooked Food",
  "Hai Nan Xing Zhou Beef Noodle",
  "Hai Nan Zai",
  "Han Kee",
  "Heng",
  "Heng Heng Cooked Food",
  "Heng Kee",
  "Hong Heng Fried Sotong Prawn Mee",
  "Hong Kong Yummy Soup",
  "Hoo Kee Bak Chang",
  "Hui Wei Chilli Ban Mian",
  "Indocafé",
  "J2 Famous Crispy Curry Puff",
  "Jalan Sultan Prawn Mee",
  "Jason Penang Cuisine",
  "Ji De Lai Hainanese Chicken Rice",
  "Ji Ji Noodle House",
  "Jian Bo Tiong Bahru Shui Kueh",
  "Joo Siah Bak Koot Teh",
  "Jungle",
  "Kelantan Kway Chap Pig Organ Soup",
  "Kitchenman Nasi Lemak",
  "Koh Brother Pig's Organ Soup",
  "Kok Sen",
  "Kotuwa",
  "Kwang Kee Teochew Fish Porridge",
  "Kwee Heng",
  "Lagnaa",
  "Lai Heng Handmade Teochew Kueh",
  "Lao Fu Zi Fried Kway Teow",
  "Lian He Ben Ji Claypot",
  "Lixin Teochew Fishball Noodles",
  "Margaret Drive Sin Kee Chicken Rice",
  "MP Thai (Vision Exchange)",
  "Muthu's Curry",
  "Na Na Curry",
  "Nam Sing Hokkien Fried Mee",
  "New Lucky Claypot Rice",
  "No.18 Zion Road Fried Kway Teow",
  "Outram Park Fried Kway Teow Mee",
  "Ru Ji Kitchen",
  "Selamat Datang Warong Pak Sapari",
  "Sik Bao Sin",
  "Sin Heng Claypot Bak Koot Teh",
  "Sin Huat Seafood Restaurant",
  "Singapore Fried Hokkien Mee",
  "Soh Kee Cooked Food",
  "Song Fa Bak Kut Teh (New Bridge Road)",
  "Song Fish Soup",
  "Song Kee Teochew Fish Porridge",
  "Soon Huat",
  "Spinach Soup",
  "Tai Seng Fish Soup",
  "Tai Wah Pork Noodle",
  "The Blue Ginger",
  "The Coconut Club (Beach Road)",
  "Tian Tian Hainanese Chicken Rice",
  "Tiong Bahru Hainanese Boneless Chicken Rice",
  "To-Ricos Kway Chap",
  "True Blue Cuisine",
  "Un-Yang-Kor-Dai",
  "Whole Earth",
  "Wok Hei Hor Fun",
  "Yhingthai Palace",
  "Yong Chun Wan Ton Noodle",
  "Zai Shun Curry Fish Head",
  "Zhi Wei Xian Zion Road Big Prawn Noodle",
  "Zhup Zhup",
];

export const SELECTED = [
  "545 Whampoa Prawn Noodles",
  "91 Fried Kway Teow Mee",
  "Ah Heng Duck Rice",
  "Ah Hock Fried Hokkien Noodles",
  "Ah Ter Authentic Teochew Fish Ball Noodles",
  "Allauddin's Briyani",
  "Ammãkase",
  "Ann Chin Handmade Popiah",
  "Aunty Oats Pancake",
  "Bar-Roque Grill",
  "Bedok Chwee Kueh",
  "Bhoomi",
  "Birds Of Paradise (Katong)",
  "Boon Tong Kee Kway Chap Braised Duck",
  "Brasserie Astoria",
  "Buko Nero",
  "Butcher's Block",
  "C.M.Y. Satay",
  "Ce Soir",
  "Cheng Heng Kway Chap and Braised Duck Rice",
  "Chomp Chomp Satay",
  "Chung Cheng",
  "Claudine",
  "Come Daily Fried Hokkien Prawn Mee",
  "Da Po",
  "Esquina",
  "Fatty Ox HK Kitchen",
  "Feng Zhen Lor Mee",
  "Fiamma",
  "Fiz",
  "Fleur de Sel",
  "Foc (Clarke Quay)",
  "Food Street Fried Kway Teow Mee",
  "Fu He Turtle Soup",
  "Garibaldi",
  "Ghim Moh Chwee Kueh",
  "Gordon Grill",
  "Gunther's",
  "Heng Gi Goose and Duck Rice",
  "Heng Long BBQ Chicken Rice",
  "Hill Street Fried Kway Teow",
  "Hock Hai (Hong Lim) Curry Chicken Noodle",
  "Hock Seng Choon Fish Ball Kway Teow Mee",
  "Hoe Kee Kitchen",
  "Hokkien Man Hokkien Mee",
  "Hokkien Street Bak Kut Teh",
  "Hong Peng La Mian Xiao Long Bao",
  "Hong Wen Mutton Soup",
  "Hougang Traditional Famous Wanton Noodle",
  "Hua Xing Bak Kut Teh",
  "Huat Heng Fried Oyster",
  "Hup Hong Chicken Rice",
  "Hup Kee Teochew Fishball Mee",
  "Ibid",
  "Ichigo Ichie",
  "Imperial Treasure Super Peking Duck (Paragon)",
  "Iru Den",
  "Ishizawa",
  "Ivy's Hainanese Herbal Mutton Soup",
  "Jade Palace",
  "Jian Bo Shui Kueh",
  "Jiang-Nan Chun",
  "Jiao Cai Seafood",
  "Jin Hua",
  "Kang Le Fishball Noodles",
  "Kang's Wanton Noodle",
  "Keng Eng Kee (Bukit Merah)",
  "Ki Su",
  "Koka Wanton Noodles",
  "L'Antica Pizzeria da Michele",
  "La D'Oro",
  "Lao Jie Fang",
  "Latido",
  "Leon Kee Claypot Pork Rib Soup",
  "Lolla",
  "Long Kee Wanton Noodle",
  "Loong Kee Yong Tau Fu",
  "Lor 9 Beef Kway Teow",
  "Lor Mee 178",
  "Luke's",
  "Maison Boulud",
  "Majestic",
  "Maxwell Fuzhou Oyster Cake",
  "Mellben Seafood (Ang Mo Kio)",
  "Min Jiang at Dempsey",
  "Mustard",
  "Mustard Seed",
  "Na Oh",
  "Nasi Lemak Ayam Taliwang",
  "National Kitchen",
  "New World Mutton Soup",
  "Nómada",
  "Nyonya Chendol",
  "Olivia",
  "Open Farm Community",
  "Osteria Mozza",
  "Path",
  "People's Park Hainanese Chicken Rice",
  "Podi & Poriyal",
  "Poh Cheu (KPT Coffee Shop)",
  "Pondok Makan Indonesia",
  "Putien (Kitchener Road)",
  "Quenino",
  "R&B Express",
  "Redhill Pork Porridge",
  "Rempapa",
  "Revolver",
  "Rojak Popiah & Cockle",
  "San Shu Gong (Geylang)",
  "San Xiang Rou Cuo Mian",
  "Shang Palace",
  "Shanyuan Teochew Kway Teow Mian",
  "Sheng Seng Fried Prawn Noodle",
  "Shi Le Yuan",
  "Shunsui",
  "Sin Hoi Sai (Tiong Bahru)",
  "Singapore Famous Rojak",
  "Solo",
  "Somma",
  "Sospiri",
  "Spago Dining Room",
  "Springleaf Prata Place (Spring Leaf Garden)",
  "Straits Chinese (Cecil Street)",
  "Sugarra",
  "Sushi Hare",
  "Sushi Katori",
  "Sushi Masaaki",
  "Sushi Ryujiro",
  "Sushi Sato",
  "Sushi Yuki",
  "Tambuah Mas (Orchard)",
  "Terra",
  "The 1950's Coffee",
  "The Prince",
  "Tien Lai Rice Stall",
  "Tiong Bahru Lien Fa Shui Jing Pau",
  "Toa Payoh 93 Soon Kueh",
  "Torno Subito",
  "Tow Kwar Pop",
  "Traditional Hakka Lui Cha",
  "Tunglok Heen",
  "Unforgettable Carrot Cake",
  "Ushidoki Wagyu Kaiseki",
  "Vue",
  "Wah Lok",
  "Wakuda",
  "Whampoa Soya Bean & Grass Jelly Drinks",
  "Xing Yun Hainanese Boneless Chicken Rice",
  "Yan Ting",
  "Ye Tang",
  "Yì By Jereme Leung",
  "Yong Fu",
  "Yong Kee Claypot Bak Kut Teh",
  "Yong Xiang Xing Tou Fu",
  "Zhang Ji Shanghai La Mian Xiao Long Bao",
  "Zheng Zhi Wen Ji Pig's Organ Soup",
  "Zi Jing Cheng Hainanese Boneless Chicken Rice",
];

/**
 * Normalise a restaurant name so Google Places names and MICHELIN names match.
 * Handles: case, accents (Zén→zen), parenthetical branches, punctuation,
 * "restaurant"/"the" noise words, and & → and.
 */
export function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")    // strip accents (Zén -> zen)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")                          // drop (Branch Name)
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")                               // drop apostrophes
    .replace(/[^a-z0-9]+/g, " ")                         // punctuation → space
    .replace(/\b(restaurant|pte|ltd|singapore|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the lookup map: normalised name → { tier, label, weight }. */
export function buildMichelinIndex(data) {
  const src = data || {
    threeStar: THREE_STAR, twoStar: TWO_STAR, oneStar: ONE_STAR,
    bibGourmand: BIB_GOURMAND, selected: SELECTED, greenStar: GREEN_STAR,
    year: GUIDE_YEAR,
  };
  const year = src.year || GUIDE_YEAR;
  const index = new Map();

  const add = (names, tier, label, weight) => {
    (names || []).forEach((n) => {
      const key = normalizeName(n);
      if (!key) return;
      const existing = index.get(key);
      // Higher-weight tier wins if a name appears in more than one list
      if (!existing || weight > existing.weight) {
        index.set(key, { tier, label: `${label} ${year}`, weight, original: n });
      }
    });
  };

  add(src.threeStar, "three_star", "MICHELIN ★★★", 10);
  add(src.twoStar, "two_star", "MICHELIN ★★", 9);
  add(src.oneStar, "one_star", "MICHELIN ★", 8);
  add(src.bibGourmand, "bib_gourmand", "Bib Gourmand", 6);
  add(src.selected, "selected", "MICHELIN Selected", 3);

  const greenKeys = new Set((src.greenStar || []).map(normalizeName));
  return { index, greenKeys, year };
}

/**
 * Look up a Google Places name against the MICHELIN index.
 * Exact normalised match first, then a guarded prefix match to catch cases like
 * Places "Song Fa Bak Kut Teh (11 New Bridge Road)" vs MICHELIN "Song Fa Bak Kut Teh (New Bridge Road)".
 */
export function lookupMichelin(placeName, built) {
  const key = normalizeName(placeName);
  if (!key) return null;

  const direct = built.index.get(key);
  if (direct) return { ...direct, green: built.greenKeys.has(key) };

  // Guarded fuzzy: only for reasonably long names, and only when one fully
  // contains the other at a word boundary — avoids "Heng" matching everything.
  if (key.length >= 10) {
    for (const [mKey, val] of built.index) {
      if (mKey.length < 10) continue;
      if (key === mKey) continue;
      if (key.startsWith(mKey + " ") || mKey.startsWith(key + " ")) {
        return { ...val, green: built.greenKeys.has(mKey), fuzzy: true };
      }
    }
  }
  return null;
}
