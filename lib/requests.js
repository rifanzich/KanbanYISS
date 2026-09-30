import { getRedisClient } from "./redisClient";
import { storageGet } from "./kv";
import { deriveProgress, isOpenStage } from "./requestProgress";

const REQUEST_PREFIX = "request:";
const INTAKE_KEY = "config:intake";
const SHARED_INDEX_RAW_KEY = "ruang-shared-index";
const dataKey = (id) => `ruang-data-${id}`;

const requestKey = (id) => `${REQUEST_PREFIX}${id}`;

export function newRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function listRequests() {
  const client = await getRedisClient();
  const keys = await client.keys(`${REQUEST_PREFIX}*`);
  if (!keys.length) return [];
  const raws = await Promise.all(keys.map((k) => client.get(k)));
  const out = [];
  for (const r of raws) {
    if (!r) continue;
    try {
      out.push(JSON.parse(r));
    } catch (e) {}
  }
  return out;
}

// Nomor antrian: urutan tetap yang diberikan saat pengajuan dibuat (tidak bergeser
// walau pengajuan lain dihapus/dibatalkan).
const QUEUE_COUNTER_KEY = "counter:request-queue";

export async function nextQueueNo() {
  const client = await getRedisClient();
  return Number(await client.incr(QUEUE_COUNTER_KEY));
}

// Pengajuan lama (dibuat sebelum fitur nomor antrian) diberi nomor menurut
// urutan waktu pengajuan, lalu disimpan agar nomornya tetap.
export async function ensureQueueNumbers(list) {
  const missing = list.filter((r) => !r.queueNo).sort((a, b) => a.createdAt - b.createdAt);
  for (const r of missing) {
    r.queueNo = await nextQueueNo();
    await saveRequest(r);
  }
  return list;
}

export async function deleteRequest(id) {
  const client = await getRedisClient();
  await client.del(requestKey(id));
}

export async function getRequest(id) {
  const client = await getRedisClient();
  const raw = await client.get(requestKey(id));
  return raw ? JSON.parse(raw) : null;
}

export async function saveRequest(req) {
  const client = await getRedisClient();
  await client.set(requestKey(req.id), JSON.stringify(req));
}

// Dipanggil saat username pengaju diganti admin, supaya riwayat pengajuannya ikut.
export async function renameRequestSubmitter(oldUsername, newUsername) {
  const all = await listRequests();
  for (const r of all) {
    if (r.submitter === oldUsername) await saveRequest({ ...r, submitter: newUsername });
  }
}

export async function getIntakeConfig() {
  const client = await getRedisClient();
  const raw = await client.get(INTAKE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export async function saveIntakeConfig(cfg) {
  const client = await getRedisClient();
  await client.set(INTAKE_KEY, JSON.stringify(cfg));
}

// Daftar ruang kerja tim (index bersama) — dipakai untuk memvalidasi papan penerima.
export async function getSharedWorkspace(workspaceId) {
  const raw = await storageGet(SHARED_INDEX_RAW_KEY, true, "");
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.find((w) => w.id === workspaceId) || null : null;
  } catch (e) {
    return null;
  }
}

export async function loadWorkspaceBlob(workspaceId) {
  const raw = await storageGet(dataKey(workspaceId), true, "");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Menempelkan progres (dihitung dari kartu di papan tim) ke setiap pengajuan.
// Data ruang kerja dibaca sekali per workspace, bukan sekali per pengajuan.
export async function attachProgress(requests, config) {
  const cache = new Map();
  const blobFor = async (wsId) => {
    if (!cache.has(wsId)) cache.set(wsId, await loadWorkspaceBlob(wsId));
    return cache.get(wsId);
  };
  const withProgress = [];
  for (const r of requests) {
    const blob = r.ingested ? await blobFor(r.ingested.workspaceId) : null;
    withProgress.push({ ...r, progress: deriveProgress(r, blob) });
  }
  // Jumlah pekerjaan yang masih antre di depan (nomor lebih kecil, belum selesai/batal).
  // Dihitung dari semua pengajuan yang diberikan, jadi kirim daftar lengkap.
  const open = withProgress.filter((r) => isOpenStage(r.progress));
  for (const r of withProgress) {
    r.queueAhead = isOpenStage(r.progress) ? open.filter((o) => o.queueNo && r.queueNo && o.queueNo < r.queueNo).length : null;
  }
  let cardTypes = [];
  if (config && config.workspaceId) {
    const blob = await blobFor(config.workspaceId);
    if (blob && Array.isArray(blob.cardTypes)) cardTypes = blob.cardTypes;
  }
  return { requests: withProgress, cardTypes };
}
