import { getRedisClient } from "./redisClient";

const ACCOUNT_PREFIX = "account:";

export function accountKey(username) {
  return `${ACCOUNT_PREFIX}${username}`;
}

export async function listAccounts() {
  const client = await getRedisClient();
  const keys = await client.keys(`${ACCOUNT_PREFIX}*`);
  if (!keys.length) return [];
  const raws = await Promise.all(keys.map((k) => client.get(k)));
  return raws
    .filter(Boolean)
    .map((r) => JSON.parse(r))
    .map((a) => ({ username: a.username, role: a.role }));
}

export async function getAccount(username) {
  const client = await getRedisClient();
  const raw = await client.get(accountKey(username));
  return raw ? JSON.parse(raw) : null;
}

export async function saveAccount(account) {
  const client = await getRedisClient();
  await client.set(accountKey(account.username), JSON.stringify(account));
}

export async function deleteAccount(username) {
  const client = await getRedisClient();
  await client.del(accountKey(username));
}

export async function countAccounts() {
  const client = await getRedisClient();
  const keys = await client.keys(`${ACCOUNT_PREFIX}*`);
  return keys.length;
}

// ---- Generic workspace key/value storage, namespaced per user or shared ----
// Values here are already JSON-stringified by the app before they arrive, so
// they're stored and returned as raw strings (no extra JSON encode/decode).
function namespacedKey(rawKey, shared, username) {
  return shared ? `shared:${rawKey}` : `personal:${username}:${rawKey}`;
}

export async function storageGet(rawKey, shared, username) {
  const client = await getRedisClient();
  return client.get(namespacedKey(rawKey, shared, username));
}

export async function storageSet(rawKey, value, shared, username) {
  const client = await getRedisClient();
  const toStore = typeof value === "string" ? value : JSON.stringify(value);
  await client.set(namespacedKey(rawKey, shared, username), toStore);
}

export async function storageDelete(rawKey, shared, username) {
  const client = await getRedisClient();
  await client.del(namespacedKey(rawKey, shared, username));
}

export async function storageListKeys(prefix, shared, username) {
  const client = await getRedisClient();
  const nsPrefix = namespacedKey(prefix || "", shared, username);
  const keys = await client.keys(`${nsPrefix}*`);
  const stripLen = namespacedKey("", shared, username).length;
  return keys.map((k) => k.slice(stripLen));
}

const RUANG_DATA_PREFIX = "ruang-data-";

// Team ("Tim") workspace content lives under shared:ruang-data-<id>. Only the
// workspace's approved roster (allowedMembers) or an admin may read/write it.
// Personal-mode keys are already isolated per-user by namespacedKey() above,
// so this only needs to gate the shared case.
export async function canAccessSharedKey(rawKey, user) {
  if (!rawKey.startsWith(RUANG_DATA_PREFIX)) return true; // not workspace content (e.g. the index itself) — allow
  if (user.role === "admin") return true;
  const workspaceId = rawKey.slice(RUANG_DATA_PREFIX.length);
  const client = await getRedisClient();
  const raw = await client.get(namespacedKey("ruang-shared-index", true, user.username));
  const list = raw ? JSON.parse(raw) : [];
  const ws = list.find((w) => w.id === workspaceId);
  if (!ws) return true; // unknown/not-yet-indexed — fail open to avoid false lockouts on create race
  const allowed = ws.allowedMembers || [];
  return allowed.includes(user.username);
}
