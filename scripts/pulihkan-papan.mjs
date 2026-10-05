// Memulihkan kartu papan tim yang hilang pada satu bulan + memastikan tiga kolom tetap.
//
// Pemakaian (REDIS_URL = Redis yang dipakai aplikasi sekarang):
//   REDIS_URL=redis://... node scripts/pulihkan-papan.mjs --month=2026-10
//        -> mode PERIKSA: hanya menampilkan kondisi dan apa yang bisa dipulihkan
//   ... --source=redis://URL_BACKUP     ambil kartu yang hilang dari salinan/backup Redis
//   ... --dari-pengajuan                susun ulang kartu dari data pengajuan yang masih ada
//   ... --apply                         benar-benar menulis perubahan (backup JSON dibuat dulu)
// Opsi lain: --workspace=<id> --board=<id> (default: papan penerima pengajuan)
import { createClient } from "redis";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v === undefined ? true : v]; }));
const FIXED = ["Belum Dikerjakan", "Sedang Dikerjakan", "Selesai"];
const month = args.month || new Date().toISOString().slice(0, 7);
const blobKey = (ws) => `shared:ruang-data-${ws}`;
const norm = (n) => String(n || "").trim().toLowerCase();

async function connect(url) { const c = createClient({ url }); await c.connect(); return c; }
const readJson = async (c, k) => { const r = await c.get(k); return r ? JSON.parse(r) : null; };

function fixColumns(columns, cards) {
  const used = new Set();
  const idx = FIXED.map((n) => { const i = columns.findIndex((c, j) => !used.has(j) && norm(c.name) === norm(n)); if (i >= 0) used.add(i); return i; });
  const left = columns.map((_, i) => i).filter((i) => !used.has(i));
  const out = FIXED.map((name, slot) => {
    let src = idx[slot] >= 0 ? columns[idx[slot]] : null;
    if (!src && left.length) src = columns[left.shift()];
    return { id: (src && src.id) || `${month}-c${slot}`, name, cardIds: src ? [...(src.cardIds || [])] : [] };
  });
  left.forEach((i) => (columns[i].cardIds || []).forEach((c) => { if (!out[2].cardIds.includes(c)) out[2].cardIds.push(c); }));
  const placed = new Set(out.flatMap((c) => c.cardIds));
  Object.keys(cards).forEach((c) => { if (!placed.has(c)) out[0].cardIds.push(c); });
  return out;
}

const slotOfSourceColumn = (srcCols, cardId) => {
  const col = (srcCols || []).find((c) => (c.cardIds || []).includes(cardId));
  const i = col ? FIXED.findIndex((n) => norm(n) === norm(col.name)) : -1;
  return i >= 0 ? i : 0;
};

function cardFromRequest(r) {
  const days = r.neededBy ? Math.max(1, Math.ceil((new Date(`${r.neededBy}T17:00:00`).getTime() - Date.now()) / 86400000)) : 1;
  return {
    id: `req-${r.id}`, text: r.title, createdAt: r.createdAt || Date.now(), duration: { amount: days, unit: "hari" },
    involvedMembers: [], cardType: r.cardType || "", qty: Number(r.qty) > 0 ? Number(r.qty) : 1, checked: false,
    priority: !!r.urgent, requestId: r.id, requestRev: Number(r.rev) || 0, requester: r.submitter,
    description: r.description || "", neededBy: r.neededBy || "", link: r.link || "",
  };
}

const target = await connect(process.env.REDIS_URL || "redis://localhost:6379");
const cfg = await readJson(target, "config:intake");
const ws = args.workspace || (cfg && cfg.workspaceId);
const boardId = args.board || (cfg && cfg.boardId);
if (!ws || !boardId) { console.error("Tidak ada papan penerima. Beri --workspace=<id> --board=<id>."); process.exit(1); }

const blob = await readJson(target, blobKey(ws));
if (!blob || !blob.boards || !blob.boards[boardId]) { console.error(`Papan ${boardId} tidak ditemukan di ruang ${ws}.`); process.exit(1); }
const board = blob.boards[boardId];
board.monthly = board.monthly || {};
const mb = board.monthly[month] || { columns: [], cards: {} };
mb.cards = mb.cards || {};
console.log(`Ruang ${ws} · papan "${board.name}" · bulan ${month}`);
console.log("Kondisi sekarang:", (mb.columns || []).map((c) => `${c.name} (${(c.cardIds || []).length})`).join(" | ") || "(belum ada kolom)");

const before = JSON.stringify(blob);
mb.columns = fixColumns(mb.columns || [], mb.cards);
const known = new Set(Object.values(board.monthly).flatMap((m) => Object.keys((m && m.cards) || {})));
const restore = []; // { card, slot, from }

if (args.source) {
  const src = await connect(args.source);
  const sblob = await readJson(src, blobKey(ws));
  const smb = sblob && sblob.boards && sblob.boards[boardId] && sblob.boards[boardId].monthly && sblob.boards[boardId].monthly[month];
  if (!smb) console.log("! Backup tidak memuat bulan/papan ini.");
  else for (const [id, card] of Object.entries(smb.cards || {})) if (!known.has(id)) restore.push({ card, slot: slotOfSourceColumn(smb.columns, id), from: "backup" });
  await src.quit();
}
if (args["dari-pengajuan"]) {
  const keys = await target.keys("request:*");
  for (const k of keys) {
    const r = await readJson(target, k);
    if (!r || r.cancelledAt || !r.ingested || r.ingested.boardId !== boardId || r.ingested.monthKey !== month) continue;
    const id = `req-${r.id}`;
    if (known.has(id) || restore.some((x) => x.card.id === id)) continue;
    restore.push({ card: cardFromRequest(r), slot: 0, from: "pengajuan" });
  }
}

console.log(`\nKartu yang bisa dipulihkan: ${restore.length}`);
restore.forEach((x) => console.log(`  - [${FIXED[x.slot]}] ${x.card.text}  (dari ${x.from})`));
const structureChanged = JSON.stringify({ ...blob }) !== before;

if (!args.apply) {
  console.log(`\nMODE PERIKSA — belum ada yang diubah.${structureChanged ? " Struktur 3 kolom akan diperbaiki." : ""}${restore.length ? "" : " Tidak ada kartu yang bisa dipulihkan dengan opsi yang diberikan."}`);
  console.log("Tambahkan --apply untuk menerapkan.");
  await target.quit();
  process.exit(0);
}

const file = `backup-papan-${ws}-${Date.now()}.json`;
fs.writeFileSync(file, before);
console.log(`\nBackup kondisi sebelum perubahan: ${file}`);
for (const x of restore) {
  mb.cards[x.card.id] = x.card;
  mb.columns[x.slot].cardIds = [x.card.id, ...mb.columns[x.slot].cardIds.filter((c) => c !== x.card.id)];
}
board.monthly[month] = mb;
await target.set(blobKey(ws), JSON.stringify(blob));
console.log("Selesai. Kolom sekarang:", mb.columns.map((c) => `${c.name} (${c.cardIds.length})`).join(" | "));
console.log("Minta semua operator me-refresh halaman agar tidak menimpa hasil pemulihan.");
await target.quit();
