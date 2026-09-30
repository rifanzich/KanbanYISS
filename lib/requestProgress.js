// Logika murni (tanpa dependensi server) untuk menurunkan progres sebuah
// pengajuan dari kartu yang ada di papan tim media. Dipakai bersama oleh
// server (API /api/requests) dan klien (Pengajuan Masuk di sisi tim).

export const PROGRESS_STEPS = ["Diajukan", "Diterima", "Dikerjakan", "Selesai"];

export const requestCardId = (requestId) => `req-${requestId}`;

// Mencari kartu pengajuan di satu papan (semua bulan). Bulan yang dicatat
// saat masuk papan dicek lebih dulu, tapi bulan lain tetap dicari supaya
// kartu yang dipindah manual tidak "hilang" dari sisi pengaju.
export function locateRequestCard(wsData, request, fallbackBoardId) {
  if (!wsData || !wsData.boards) return null;
  const boardId = (request.ingested && request.ingested.boardId) || fallbackBoardId;
  const board = boardId ? wsData.boards[boardId] : null;
  if (!board || !board.monthly) return null;
  const cardId = requestCardId(request.id);
  const months = Object.keys(board.monthly);
  const preferred = request.ingested && request.ingested.monthKey;
  const ordered = preferred && months.includes(preferred) ? [preferred, ...months.filter((m) => m !== preferred)] : months;
  for (const monthKey of ordered) {
    const mb = board.monthly[monthKey];
    if (!mb || !mb.cards || !mb.cards[cardId]) continue;
    const columns = mb.columns || [];
    const columnIndex = columns.findIndex((c) => c.cardIds && c.cardIds.includes(cardId));
    return { boardId, monthKey, cardId, card: mb.cards[cardId], columns, columnIndex };
  }
  return null;
}

const LABELS = [
  "Menunggu diterima tim media",
  "Diterima, menunggu dikerjakan",
  "Sedang dikerjakan",
  "Selesai",
];

// step = langkah tertinggi yang sudah tercapai (0..3), sesuai PROGRESS_STEPS.
//  0 Diajukan   : belum ada operator yang menerima
//  1 Diterima   : ada operator yang menerima, kartu masih di kolom pertama
//  2 Dikerjakan : kartu di kolom kedua
//  3 Selesai    : kartu di kolom ketiga atau setelahnya
export function deriveProgress(request, wsData, fallbackBoardId) {
  if (request.cancelledAt) {
    // inBoard: true/false bila data papan tersedia, null bila belum bisa dipastikan.
    let inBoard = false;
    if (request.ingested) {
      if (!wsData) inBoard = null;
      else inBoard = !!locateRequestCard(wsData, request, fallbackBoardId);
    }
    return { step: 0, stage: "cancelled", label: "Dibatalkan", team: [], columnName: "", inBoard, duration: null, startedAt: null, priority: !!request.urgent };
  }
  const base = { step: 0, stage: "waiting", label: LABELS[0], team: [], columnName: "", inBoard: false, duration: null, startedAt: null, priority: !!request.urgent };
  const canLook = !!(request.ingested || fallbackBoardId);
  if (!canLook) return base;
  if (!wsData) return { ...base, stage: "unknown", label: "Status belum bisa dimuat" };

  const found = locateRequestCard(wsData, request, fallbackBoardId);
  if (!found) {
    if (request.ingested) return { ...base, stage: "removed", label: "Kartu dihapus oleh tim media" };
    return base; // belum sempat dimasukkan ke papan
  }

  const team = found.card.involvedMembers || [];
  const idx = found.columnIndex;
  const columnName = idx >= 0 && found.columns[idx] ? found.columns[idx].name : "";
  const common = { team, columnName, inBoard: true, duration: found.card.duration || null, startedAt: found.card.startedAt || null, priority: !!found.card.priority };

  if (idx >= 2) return { ...common, step: 3, stage: "done", label: LABELS[3] };
  if (idx === 1) return { ...common, step: 2, stage: "doing", label: LABELS[2] };
  if (team.length > 0) return { ...common, step: 1, stage: "accepted", label: LABELS[1] };
  return { ...common, step: 0, stage: "waiting", label: LABELS[0] };
}

// Untuk filter/statistik di sisi pengaju maupun tim.
export function progressGroup(progress) {
  if (!progress) return "waiting";
  if (progress.stage === "done") return "done";
  if (progress.stage === "removed") return "removed";
  if (progress.stage === "cancelled") return "cancelled";
  if (progress.stage === "accepted" || progress.stage === "doing") return "active";
  return "waiting";
}

// Pengajuan yang masih berada dalam antrian (belum selesai, dibatalkan, atau hilang).
export function isOpenStage(progress) {
  return !!progress && ["waiting", "accepted", "doing", "unknown"].includes(progress.stage);
}
