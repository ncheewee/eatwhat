import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyVenue,
  dietaryClash,
  venueRung,
  scoreVenue,
  buildWhy,
  rankVenues,
} from "./rank.js";
import { gemAreaNearPin } from "./areas.js";

const cafe = {
  name: "Grin Affair",
  formattedAddress: "123 Bishan St 12, Singapore",
  priceSymbol: "$",
  rating: 4.6,
  reviewCount: 800,
  distanceKm: 0.4,
  openNow: true,
  priceLevel: "PRICE_LEVEL_INEXPENSIVE",
};

const stall = {
  name: "Heng Kee Fishball Noodle",
  formattedAddress: "2 Adam Rd, Adam Road Food Centre, Singapore",
  rating: 4.4,
  reviewCount: 90,
  distanceKm: 0.6,
  openNow: true,
};

const bakKutTeh = {
  name: "Joo Siah Bak Kut Teh",
  formattedAddress: "Jurong East",
  rating: 4.5,
  reviewCount: 2000,
  distanceKm: 0.5,
  openNow: true,
};

test("classify: hawker is address/centre only", () => {
  assert.equal(classifyVenue(stall), "hawker");
  assert.equal(classifyVenue(cafe), "restaurant");
  assert.equal(
    classifyVenue({ name: "Kopitiam @ Bugis Junction", formattedAddress: "Bugis Junction" }),
    "foodcourt"
  );
});

test("dietary clash is a veto, not a nudge", () => {
  assert.equal(dietaryClash(bakKutTeh, ["halal"]), true);
  assert.equal(dietaryClash(bakKutTeh, ["no_pork"]), true);
  assert.equal(dietaryClash(cafe, ["halal"]), false);
  assert.equal(dietaryClash({ name: "Hong Heng Beef Noodle Soup" }, ["no_beef"]), true);
  assert.equal(dietaryClash({ name: "Chicken Rice" }, ["vegetarian"]), false);
});

test("ladder: first matching rung wins", () => {
  assert.equal(venueRung({ isLiked: true, mich: { tier: "one_star" }, curated: { source: "Alderic" }, category: "hawker" }), "liked");
  assert.equal(venueRung({ isLiked: false, mich: { tier: "bib_gourmand" }, curated: { source: "Alderic" }, category: "hawker" }), "michelin");
  assert.equal(venueRung({ isLiked: false, mich: null, curated: { source: "Alderic" }, category: "restaurant" }), "creator");
  assert.equal(venueRung({ isLiked: false, mich: null, curated: { source: "Eatbook" }, category: "restaurant" }), "media");
  assert.equal(venueRung({ isLiked: false, mich: null, curated: null, category: "hawker" }), "hawker");
  assert.equal(venueRung({ isLiked: false, mich: null, curated: null, category: "restaurant" }), "other");
});

test("rungs cannot leapfrog via rating or budget", () => {
  const superCafe = { ...cafe, rating: 5, reviewCount: 3000, distanceKm: 0.1 };
  const weakMich = { ...stall, rating: 3.8, reviewCount: 40, distanceKm: 2 };
  const cafeScore = scoreVenue(superCafe, {
    rung: "other",
    budget: "$",
    prefs: { style: "traditional" },
  });
  const michScore = scoreVenue(weakMich, {
    rung: "michelin",
    mich: { tier: "selected", weight: 3 },
    budget: "$$$",
  });
  assert.ok(michScore > cafeScore, `michelin ${michScore} should beat other ${cafeScore}`);
});

test("why is the rung that won", () => {
  assert.match(buildWhy({ rung: "liked", v: cafe }), /^You liked this/);
  assert.match(buildWhy({ rung: "media", curated: { source: "Eatbook" }, v: cafe }), /^Eatbook pick/);
  assert.match(buildWhy({ rung: "creator", curated: { source: "Alderic" }, v: stall }), /^Alderic pick/);
  assert.match(buildWhy({ rung: "hawker", v: stall }), /^Hawker stall/);
  assert.match(buildWhy({ rung: "michelin", mich: { tier: "bib_gourmand" }, v: stall }), /^Bib Gourmand/);
});

test("rankVenues sorts by score desc", () => {
  const ranked = rankVenues([{ _score: 1 }, { _score: 5 }, { _score: 3 }]);
  assert.deepEqual(ranked.map((v) => v._score), [5, 3, 1]);
});

test("gem area near pin skips far neighbourhoods", () => {
  // Toa Payoh pin vs Woodlands gem
  assert.equal(gemAreaNearPin("Woodlands", 1.3343, 103.8563, 2), false);
  assert.equal(gemAreaNearPin("Toa Payoh", 1.3343, 103.8563, 2), true);
  assert.equal(gemAreaNearPin("Upper Thomson", 1.3547, 103.8325, 2), true);
  assert.equal(gemAreaNearPin("Some Unknown Alley", 1.3343, 103.8563, 2), null);
});
