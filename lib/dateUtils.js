import {
  MONTH_NAMES_ID,
  UNIT_MS,
  UNIT_LABEL,
  DUE_SOON_MS,
  uid,
} from "./constants.js";

export function formatCreatedDate(ts) {
  try {
    return new Date(ts).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch (e) {
    return "";
  }
}

export function toDateInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateInputToTimestamp(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 8, 0, 0, 0).getTime();
}

export function resolveManualCreatedAt(dateStr) {
  if (!dateStr) return undefined;
  const todayStr = toDateInputValue(Date.now());
  return dateStr === todayStr ? Date.now() : dateInputToTimestamp(dateStr);
}

export function startDateHint(dateStr) {
  if (!dateStr) return "kosongkan = hari ini";
  const todayStr = toDateInputValue(Date.now());
  if (dateStr === todayStr) return "mulai dari waktu sekarang";
  if (dateStr > todayStr) return "mulai 08:00 di tanggal ini";
  return "tanggal lampau · dihitung mulai 08:00";
}

export function monthKeyOf(year, monthIndex0) {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

export function currentMonthKey() {
  const d = new Date();
  return monthKeyOf(d.getFullYear(), d.getMonth());
}

export function monthKeyFromTimestamp(ts) {
  const d = new Date(ts);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}

export function parseMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return { year: y, monthIndex0: m - 1 };
}

export function monthKeyLabel(key) {
  const { year, monthIndex0 } = parseMonthKey(key);
  return `${MONTH_NAMES_ID[monthIndex0]} ${year}`;
}

export function shiftMonthKey(key, delta) {
  const { year, monthIndex0 } = parseMonthKey(key);
  const d = new Date(year, monthIndex0 + delta, 1);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}

export function defaultColumnsTemplate(seed) {
  const s = seed || uid();
  return [
    { id: `${s}-c0`, name: "Belum Dikerjakan", cardIds: [] },
    { id: `${s}-c1`, name: "Sedang Dikerjakan", cardIds: [] },
    { id: `${s}-c2`, name: "Selesai", cardIds: [] },
  ];
}

export function getMonthBoard(board, monthKey) {
  if (board.monthly && board.monthly[monthKey]) return board.monthly[monthKey];
  return { columns: defaultColumnsTemplate(monthKey), cards: {} };
}

export function formatHoursMinutes(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} menit`;
  if (minutes === 0) return `${hours} jam`;
  return `${hours} jam ${minutes} menit`;
}

export function getDurationInfo(card) {
  if (!card.duration) return null;
  if (!card.startedAt) return null; // masih di "Belum Dikerjakan" — timer belum aktif
  const { amount, unit } = card.duration;
  const due = card.startedAt + amount * UNIT_MS[unit];
  const remaining = due - Date.now();
  const label = `${amount} ${UNIT_LABEL[unit]}`;
  if (remaining <= 0) {
    return {
      text: `Terlambat ${formatHoursMinutes(Math.abs(remaining))} · target ${label}`,
      status: "overdue",
    };
  }
  const remText = `${formatHoursMinutes(remaining)} lagi`;
  const status = remaining <= DUE_SOON_MS ? "due_soon" : "ok";
  return { text: `${remText} · target ${label}`, status };
}

export function collectUrgentCards(wsData) {
  const overdue = [];
  const dueSoon = [];
  const mk = currentMonthKey();
  (wsData.boardOrder || []).forEach((bid) => {
    const board = wsData.boards[bid];
    if (!board) return;
    const monthBoard = board.monthly && board.monthly[mk];
    if (!monthBoard) return;
    monthBoard.columns.forEach((col) => {
      col.cardIds.forEach((cid) => {
        const card = monthBoard.cards[cid];
        if (!card || !card.duration) return;
        const info = getDurationInfo(card);
        if (!info) return;
        const item = {
          boardId: board.id,
          boardName: board.name,
          columnName: col.name,
          cardText: card.text,
          text: info.text,
        };
        if (info.status === "overdue") overdue.push(item);
        else if (info.status === "due_soon") dueSoon.push(item);
      });
    });
  });
  return { overdue, dueSoon };
}
