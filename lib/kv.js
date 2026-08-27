import { kv } from "@vercel/kv";

const ACCOUNT_PREFIX = "account:";

export function accountKey(username) {
  return `${ACCOUNT_PREFIX}${username}`;
}

export async function listAccounts() {
  const keys = await kv.keys(`${ACCOUNT_PREFIX}*`);
  if (!keys.length) return [];
  const accounts = await Promise.all(keys.map((k) => kv.get(k)));
  return accounts
    .filter(Boolean)
    .map((a) => ({ username: a.username, role: a.role }));
}

export async function getAccount(username) {
  return kv.get(accountKey(username));
}

export async function saveAccount(account) {
  await kv.set(accountKey(account.username), account);
}

export async function deleteAccount(username) {
  await kv.del(accountKey(username));
}

export async function countAccounts() {
  const keys = await kv.keys(`${ACCOUNT_PREFIX}*`);
  return keys.length;
}

// ---- Generic workspace key/value storage, namespaced per user or shared ----
function namespacedKey(rawKey, shared, username) {
  return shared ? `shared:${rawKey}` : `personal:${username}:${rawKey}`;
}

export async function storageGet(rawKey, shared, username) {
  return kv.get(namespacedKey(rawKey, shared, username));
}

export async function storageSet(rawKey, value, shared, username) {
  await kv.set(namespacedKey(rawKey, shared, username), value);
}

export async function storageDelete(rawKey, shared, username) {
  await kv.del(namespacedKey(rawKey, shared, username));
}

export async function storageListKeys(prefix, shared, username) {
  const nsPrefix = namespacedKey(prefix || "", shared, username);
  const keys = await kv.keys(`${nsPrefix}*`);
  const stripLen = namespacedKey("", shared, username).length;
  return keys.map((k) => k.slice(stripLen));
}
