import test from "node:test";
import assert from "node:assert/strict";
import { groupSpoons, parseMapsShare, spoonSummary } from "./spoons.js";
import { handleSpoonRequest } from "./spoon-api.js";
import worker from "./index.js";

function memoryKv() {
  const m = new Map();
  return {
    async get(key, type) {
      const v = m.get(key);
      if (v == null) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) { m.set(key, value); },
    async delete(key) { m.delete(key); },
    async list({ prefix }) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

const PLACE = {
  placeId: "ChIJexampleplace01",
  name: "Chef Kang’s Noodle House",
  lat: 1.332,
  lng: 103.848,
  address: "Toa Payoh",
};

function envWith(kv) {
  return { SEARCH_CACHE: kv, GOOGLE_PLACES_API_KEY: "test" };
}

async function sessionFor(kv, name) {
  const res = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/session", {
      method: "POST",
      body: JSON.stringify({ credential: "good-" + name }),
    }),
    envWith(kv),
    { verifyGoogle: async (credential) => ({ id: "user-" + credential.slice(5), name }) },
  );
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

test("one person's spoons stay named, and a crowd is not averaged", () => {
  const groups = groupSpoons([
    { userId: "a", userName: "Min Tan", placeId: "p1", name: "Stall", lat: 1.301, lng: 103.8, spoons: 3 },
    { userId: "b", userName: "Chee Wee", placeId: "p1", name: "Stall", lat: 1.301, lng: 103.8, spoons: 1 },
    { userId: "a", userName: "Min Tan", placeId: "p2", name: "Far", lat: 1.4, lng: 103.9, spoons: 3 },
  ], { lat: 1.3, lng: 103.8, radiusKm: 2, me: "b" });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].placeId, "p1");
  assert.equal(groups[0].highest, 3);
  assert.equal(groups[0].people, 2);
  assert.equal(groups[0].line, "2 people · 3 spoons");
  assert.equal(groups[0].breakdown, "Min 3 · You 1");
  assert.equal(groups[0].by.some((p) => p.userId), false);

  const alone = groupSpoons([
    { userId: "a", userName: "Min Tan", placeId: "p1", name: "Stall", lat: 1.301, lng: 103.8, spoons: 1 },
  ], { lat: 1.3, lng: 103.8, radiusKm: 2, me: null });
  assert.equal(spoonSummary({ highest: 1, by: [{ name: "Min Tan", isYou: false }] }), "Min · 1 spoon");
  assert.equal(alone[0].line, "Min · 1 spoon");
});

test("higher spoons sort first inside the people list only", () => {
  const groups = groupSpoons([
    { userId: "a", userName: "Ada", placeId: "low", name: "Low", lat: 1.3, lng: 103.8, spoons: 1 },
    { userId: "b", userName: "Bea", placeId: "high", name: "High", lat: 1.301, lng: 103.801, spoons: 3 },
  ], { lat: 1.3, lng: 103.8, radiusKm: 2, me: null });
  assert.deepEqual(groups.map((g) => g.name), ["High", "Low"]);
});

test("parses a Maps place link and a pasted place id", () => {
  const named = parseMapsShare("https://www.google.com/maps/place/Chef+Kang/@1.332,103.848,17z");
  assert.equal(named.query, "Chef Kang");
  assert.equal(named.lat, 1.332);
  assert.equal(named.lng, 103.848);

  const id = parseMapsShare("https://maps.google.com/?q=noodles&query_place_id=ChIJexampleplace01");
  assert.equal(id.placeId, "ChIJexampleplace01");

  const short = parseMapsShare("Look https://maps.app.goo.gl/abc123");
  assert.equal(short.shortUrl, "https://maps.app.goo.gl/abc123");
});

test("session, save, nearby, mine, and remove stay off the search route", async () => {
  const kv = memoryKv();
  const deps = {
    verifyGoogle: async (credential) => ({ id: "user-" + credential.slice(5), name: credential.endsWith("min") ? "Min Tan" : "Chee Wee" }),
    fetchPlace: async () => PLACE,
    searchPlaces: async () => [PLACE],
    followRedirects: async (url) => url.replace("maps.app.goo.gl/abc", "www.google.com/maps/place/Chef+Kang/@1.332,103.848,17z"),
  };

  const token = await sessionFor(kv, "Chee Wee");
  const auth = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  const denied = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/spoons", { method: "POST", body: JSON.stringify({ placeId: PLACE.placeId, spoons: 3 }) }),
    envWith(kv),
    deps,
  );
  assert.equal(denied.status, 401);

  const saved = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/spoons", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ placeId: PLACE.placeId, spoons: 3 }),
    }),
    envWith(kv),
    deps,
  );
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).place.name, PLACE.name);

  const mine = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/spoons/mine", { headers: auth }),
    envWith(kv),
    deps,
  );
  assert.equal((await mine.json()).places.length, 1);

  const near = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/spoons/nearby?lat=1.332&lng=103.848&radiusKm=2", { headers: auth }),
    envWith(kv),
    deps,
  );
  const nearBody = await near.json();
  assert.equal(nearBody.places[0].line, "You · 3 spoons");

  const found = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/places/find", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ query: "https://maps.app.goo.gl/abc" }),
    }),
    envWith(kv),
    deps,
  );
  assert.equal((await found.json()).places[0].placeId, PLACE.placeId);

  const removed = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/spoons", {
      method: "DELETE",
      headers: auth,
      body: JSON.stringify({ placeId: PLACE.placeId }),
    }),
    envWith(kv),
    deps,
  );
  assert.equal(removed.status, 200);
  const after = await handleSpoonRequest(
    new Request("https://eatwhat.test/api/spoons/mine", { headers: auth }),
    envWith(kv),
    deps,
  );
  assert.equal((await after.json()).places.length, 0);
});

test("search is untouched and still returns a pool when Places isn't configured", async () => {
  const res = await worker.fetch(new Request("https://eatwhat.test/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 1.33, lng: 103.85, radiusKm: 2 }),
  }), {});
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.pool));
  assert.equal(body.mock, true);
  assert.equal(body.pool.some((p) => p.spoons != null), false);
});

test("a bad sign-in does not 404", async () => {
  const res = await worker.fetch(new Request("https://eatwhat.test/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: "nope" }),
  }), { SEARCH_CACHE: memoryKv() });
  assert.equal(res.status, 401);
});
