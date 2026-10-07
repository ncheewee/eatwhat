/**
 * Spoons live in the existing SEARCH_CACHE namespace under a prefix the
 * search cache never uses, with no TTL. A separate database would need a
 * Cloudflare login this repo's deploy does not have. Do not flush keys
 * that start with spoon:v1:.
 */

const PREFIX = "spoon:v1:";

export function userKey(userId) {
  return `${PREFIX}user:${encodeURIComponent(userId)}`;
}

export function sessionKey(tokenHash) {
  return `${PREFIX}sess:${tokenHash}`;
}

export function spoonKey(userId, placeId) {
  return `${PREFIX}u:${encodeURIComponent(userId)}:${encodeURIComponent(placeId)}`;
}

export function userSpoonPrefix(userId) {
  return `${PREFIX}u:${encodeURIComponent(userId)}:`;
}

export const ALL_SPOONS_PREFIX = `${PREFIX}u:`;

async function listValues(kv, prefix, cap = 3000) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    const values = await Promise.all(page.keys.map((k) => kv.get(k.name, "json")));
    for (const v of values) if (v) out.push(v);
    if (out.length >= cap) return out.slice(0, cap);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function putUser(kv, user) {
  await kv.put(userKey(user.id), JSON.stringify(user));
}

export async function getUser(kv, userId) {
  return kv.get(userKey(userId), "json");
}

export async function putSession(kv, tokenHash, session, ttlSeconds) {
  await kv.put(sessionKey(tokenHash), JSON.stringify(session), { expirationTtl: ttlSeconds });
}

export async function getSession(kv, tokenHash) {
  return kv.get(sessionKey(tokenHash), "json");
}

export async function saveSpoon(kv, record) {
  await kv.put(spoonKey(record.userId, record.placeId), JSON.stringify(record));
}

export async function deleteSpoon(kv, userId, placeId) {
  await kv.delete(spoonKey(userId, placeId));
}

export async function listUserSpoons(kv, userId) {
  const rows = await listValues(kv, userSpoonPrefix(userId), 200);
  rows.sort((a, b) => b.spoons - a.spoons || (b.updatedAt || 0) - (a.updatedAt || 0) || String(a.name).localeCompare(String(b.name)));
  return rows;
}

export async function listAllSpoons(kv) {
  return listValues(kv, ALL_SPOONS_PREFIX);
}
