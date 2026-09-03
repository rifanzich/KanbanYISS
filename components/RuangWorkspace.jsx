"use client";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { Plus, X, Download, Bell, LogOut, ShieldCheck, PieChart, Calendar, Check, Sun, Moon, Pencil, Users, Tags, Flag } from "lucide-react";

// Install a window.storage shim that forwards to the Next.js API routes
// (backed by Vercel KV) instead of Claude's artifact storage. The call
// signature — get/set/delete(key, shared) and list(prefix, shared) — is kept
// identical so the rest of this component needs no further changes.
if (typeof window !== "undefined" && !window.__ruangStorageInstalled) {
  window.__ruangStorageInstalled = true;
  window.storage = {
    async get(key, shared) {
      const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}&shared=${!!shared}`, { credentials: "include" });
      if (res.status === 404) throw new Error("not found");
      if (!res.ok) throw new Error("storage error");
      const data = await res.json();
      return { key, value: data.value, shared: !!shared };
    },
    async set(key, value, shared) {
      const res = await fetch("/api/kv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key, value, shared: !!shared }),
      });
      if (!res.ok) throw new Error("storage error");
      return { key, value, shared: !!shared };
    },
    async delete(key, shared) {
      const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}&shared=${!!shared}`, { method: "DELETE", credentials: "include" });
      return { key, deleted: res.ok, shared: !!shared };
    },
    async list(prefix, shared) {
      const res = await fetch(`/api/kv/list?prefix=${encodeURIComponent(prefix || "")}&shared=${!!shared}`, { credentials: "include" });
      const data = await res.json().catch(() => ({ keys: [] }));
      return { keys: data.keys || [], prefix, shared: !!shared };
    },
  };
}

const PERSONAL_INDEX_KEY = "ruang-personal-index";
const SHARED_INDEX_KEY = "ruang-shared-index";
const dataKey = (id) => `ruang-data-${id}`;
const DEFAULT_CARD_TYPES = [
  "Video Semenit",
  "Kalam Ulama",
  "Poster Dakwah",
  "Video Dokumentasi/Konten",
  "Poster Kajian/TA",
  "Desain Cetak",
  "Desain Poster Divisi",
];

function formatCreatedDate(ts) {
  try {
    return new Date(ts).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch (e) {
    return "";
  }
}

// Converts a timestamp to the "YYYY-MM-DD" shape a <input type="date"> needs,
// using local calendar fields (not UTC) so the picker shows the day the
// person actually chose.
function toDateInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A manually-picked date (past or future) always starts its countdown at
// 08:00 local time on that day, so the duration/overdue math has a
// consistent, predictable anchor regardless of what time it is right now.
function dateInputToTimestamp(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 8, 0, 0, 0).getTime();
}

// Picking "today" means "start counting from right now" (the actual
// creation/edit moment), not from a fixed 08:00 — the 08:00 anchor is only
// for a date that's genuinely different from today (past or future).
function resolveManualCreatedAt(dateStr) {
  if (!dateStr) return undefined;
  const todayStr = toDateInputValue(Date.now());
  return dateStr === todayStr ? Date.now() : dateInputToTimestamp(dateStr);
}

// The "mulai 08:00 di tanggal ini" hint should only show for a date that's
// tomorrow or later — not for today (which just uses the current time), and
// not for a past date either.
function startDateHint(dateStr) {
  if (!dateStr) return "kosongkan = hari ini";
  const todayStr = toDateInputValue(Date.now());
  if (dateStr === todayStr) return "mulai dari waktu sekarang";
  if (dateStr > todayStr) return "mulai 08:00 di tanggal ini";
  return "tanggal lampau · dihitung mulai 08:00";
}

const uid = () => Math.random().toString(36).slice(2, 10);

const UNIT_MS = { menit: 60000, jam: 3600000, hari: 86400000 };
const UNIT_LABEL = { menit: "menit", jam: "jam", hari: "hari" };
const DUE_SOON_MS = 12 * UNIT_MS.jam;

// ---- Month helpers (papan bulanan) ----
// Each board now keeps a separate set of columns/cards per calendar month
// ("monthly"), so switching months shows a genuinely different board while
// past months stay exactly as they were left.
const MONTH_NAMES_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Warna titik status kolom, gaya ClickUp — dipilih berdasar posisi kolom
// (bukan nama), jadi tetap konsisten meski kolom di-rename atau ditambah.
const COLUMN_DOT_COLORS = ["#9CA3AF", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4"];
function columnDotColor(index) {
  return COLUMN_DOT_COLORS[index % COLUMN_DOT_COLORS.length];
}

function monthKeyOf(year, monthIndex0) {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}
function currentMonthKey() {
  const d = new Date();
  return monthKeyOf(d.getFullYear(), d.getMonth());
}
function monthKeyFromTimestamp(ts) {
  const d = new Date(ts);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}
function parseMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return { year: y, monthIndex0: m - 1 };
}
function monthKeyLabel(key) {
  const { year, monthIndex0 } = parseMonthKey(key);
  return `${MONTH_NAMES_ID[monthIndex0]} ${year}`;
}
function shiftMonthKey(key, delta) {
  const { year, monthIndex0 } = parseMonthKey(key);
  const d = new Date(year, monthIndex0 + delta, 1);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}
function defaultColumnsTemplate(seed) {
  const s = seed || uid();
  return [
    { id: `${s}-c0`, name: "Belum Dikerjakan", cardIds: [] },
    { id: `${s}-c1`, name: "Sedang Dikerjakan", cardIds: [] },
    { id: `${s}-c2`, name: "Selesai", cardIds: [] },
  ];
}
// Returns the month's board (columns+cards), or a fresh (not yet persisted)
// one seeded deterministically from the month key — so every caller asking
// about the same never-visited month sees the exact same column ids, instead
// of a fresh random set each time (which would break renaming/moving/adding
// before that month has been "touched" for the first time).
function getMonthBoard(board, monthKey) {
  if (board.monthly && board.monthly[monthKey]) return board.monthly[monthKey];
  return { columns: defaultColumnsTemplate(monthKey), cards: {} };
}

const emptyWorkspaceData = () => ({
  boards: {},
  boardOrder: [],
  notes: {},
  noteOrder: [],
  cardTypes: [...DEFAULT_CARD_TYPES],
  calendarNotes: {},
  active: { type: "none" },
});

const sampleWorkspaceData = () => {
  const boardId = uid();
  const col1 = uid(), col2 = uid(), col3 = uid();
  const card1 = uid(), card2 = uid();
  const now = Date.now();
  return {
    boards: {
      [boardId]: {
        id: boardId,
        name: "Papan Pertama",
        monthly: {
          [currentMonthKey()]: {
            columns: [
              { id: col1, name: "Belum Dikerjakan", cardIds: [card1] },
              { id: col2, name: "Sedang Dikerjakan", cardIds: [card2] },
              { id: col3, name: "Selesai", cardIds: [] },
            ],
            cards: {
              [card1]: { id: card1, text: "Centang kartu ini untuk pindah otomatis", createdAt: now, duration: null, involvedMembers: [], cardType: "Video Semenit", qty: 1, checked: false },
              [card2]: { id: card2, text: "Centang di sini untuk tandai selesai", createdAt: now, duration: { amount: 10, unit: "jam" }, involvedMembers: [], cardType: "Poster Dakwah", qty: 1, checked: false },
            },
          },
        },
      },
    },
    boardOrder: [boardId],
    notes: {},
    noteOrder: [],
    cardTypes: [...DEFAULT_CARD_TYPES],
    calendarNotes: {},
    active: { type: "board", id: boardId },
  };
};

function normalizeWsData(raw) {
  const base = raw ? raw : emptyWorkspaceData();
  const cardTypes = base.cardTypes && base.cardTypes.length ? base.cardTypes : [...DEFAULT_CARD_TYPES];
  const calendarNotes = base.calendarNotes || {};
  const boards = { ...(base.boards || {}) };

  // Normalizes one month's { columns, cards } bucket: fills in defaults that
  // older cards may be missing (involvedMembers/cardType/qty/startedAt).
  const normalizeMonthBoard = (monthBoard) => {
    const columns = monthBoard.columns || [];
    const cards = { ...(monthBoard.cards || {}) };
    Object.keys(cards).forEach((cid) => {
      const card = cards[cid];
      const involvedMembers = card.involvedMembers ? card.involvedMembers : card.assignee ? [card.assignee] : [];
      const qty = Number(card.qty) > 0 ? Number(card.qty) : 1;
      // Kartu lama (dari sebelum fitur "timer aktif setelah dikerjakan") yang
      // sudah lanjut ke kolom kedua atau lebih dianggap sudah berjalan sejak
      // dibuat, supaya hitung mundurnya tidak tiba-tiba hilang.
      let startedAt = card.startedAt;
      if (!startedAt) {
        const colIndex = columns.findIndex((c) => c.cardIds && c.cardIds.includes(cid));
        if (colIndex >= 1) startedAt = card.createdAt;
      }
      cards[cid] = { ...card, involvedMembers, cardType: card.cardType || "", qty, priority: !!card.priority, startedAt };
    });
    return { columns, cards };
  };

  Object.keys(boards).forEach((bid) => {
    const board = boards[bid];
    let monthly = board.monthly ? { ...board.monthly } : null;
    // Legacy shape (pre-month-feature): the board's cards/columns lived at
    // the top level. Migrate them into the CURRENT month so nothing is
    // reset — existing work stays exactly where it was left.
    if (!monthly) {
      monthly = { [currentMonthKey()]: { columns: board.columns || defaultColumnsTemplate(), cards: board.cards || {} } };
    }
    Object.keys(monthly).forEach((mk) => {
      monthly[mk] = normalizeMonthBoard(monthly[mk]);
    });
    boards[bid] = { id: board.id, name: board.name, monthly };
  });

  return { ...base, cardTypes, calendarNotes, boards };
}

function useDebouncedSave(key, value, shared, ready) {
  const timer = useRef(null);
  useEffect(() => {
    if (!ready || !key) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await window.storage.set(key, JSON.stringify(value), shared);
      } catch (e) {
        console.error("Gagal menyimpan:", e);
      }
    }, 400);
    return () => clearTimeout(timer.current);
  }, [key, value, shared, ready]);
}

function formatHoursMinutes(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} menit`;
  if (minutes === 0) return `${hours} jam`;
  return `${hours} jam ${minutes} menit`;
}

function getDurationInfo(card) {
  if (!card.duration) return null;
  if (!card.startedAt) return null; // masih di "Belum Dikerjakan" — timer belum aktif
  const { amount, unit } = card.duration;
  const due = card.startedAt + amount * UNIT_MS[unit];
  const remaining = due - Date.now();
  const label = `${amount} ${UNIT_LABEL[unit]}`;
  if (remaining <= 0) {
    return { text: `Terlambat ${formatHoursMinutes(Math.abs(remaining))} · target ${label}`, status: "overdue" };
  }
  const remText = `${formatHoursMinutes(remaining)} lagi`;
  const status = remaining <= DUE_SOON_MS ? "due_soon" : "ok";
  return { text: `${remText} · target ${label}`, status };
}

function collectUrgentCards(wsData) {
  const overdue = [];
  const dueSoon = [];
  const mk = currentMonthKey();
  wsData.boardOrder.forEach((bid) => {
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
        const item = { boardId: board.id, boardName: board.name, columnName: col.name, cardText: card.text, text: info.text };
        if (info.status === "overdue") overdue.push(item);
        else if (info.status === "due_soon") dueSoon.push(item);
      });
    });
  });
  return { overdue, dueSoon };
}

function sanitizeSheetName(name) {
  const cleaned = (name || "Papan").replace(/[\[\]\*\/\\\?:]/g, " ").trim();
  return cleaned.slice(0, 31) || "Papan";
}

function buildAndDownloadWorkbook(wsName, data) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();
  (data.boardOrder || []).forEach((bid) => {
    const board = data.boards[bid];
    if (!board || !board.monthly) return;
    const monthKeys = Object.keys(board.monthly).sort();
    monthKeys.forEach((mk) => {
      const monthBoard = board.monthly[mk];
      const rows = [];
      (monthBoard.columns || []).forEach((col) => {
        col.cardIds.forEach((cid) => {
          const card = monthBoard.cards[cid];
          if (!card) return;
          const info = getDurationInfo(card);
          rows.push({
            Kolom: col.name,
            "Jenis Kartu": card.cardType || "",
            Jumlah: Number(card.qty) > 0 ? Number(card.qty) : 1,
            Kartu: card.text,
            "Tim Terlibat": (card.involvedMembers || []).join(", "),
            "Durasi Target": card.duration ? `${card.duration.amount} ${UNIT_LABEL[card.duration.unit]}` : "",
            Status: info ? (info.status === "overdue" ? "Terlambat" : info.status === "due_soon" ? "Mendekati tenggat" : "Tepat waktu") : card.duration && !card.startedAt ? "Belum dimulai" : "",
            "Dibuat pada": formatCreatedDate(card.createdAt),
          });
        });
      });
      let sheetName = sanitizeSheetName(`${board.name} ${monthKeyLabel(mk)}`);
      let i = 2;
      while (usedNames.has(sheetName)) {
        sheetName = sanitizeSheetName(`${board.name} ${monthKeyLabel(mk)} ${i}`);
        i++;
      }
      usedNames.add(sheetName);
      const ws = XLSX.utils.json_to_sheet(
        rows.length ? rows : [{ Kolom: "", "Jenis Kartu": "", Jumlah: "", Kartu: "(belum ada kartu)", "Tim Terlibat": "", "Durasi Target": "", Status: "", "Dibuat pada": "" }]
      );
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
  });
  if ((data.noteOrder || []).length) {
    const noteRows = data.noteOrder.map((nid) => {
      const n = data.notes[nid];
      return { Judul: n.title, Isi: n.content, Diperbarui: new Date(n.updatedAt).toLocaleString("id-ID") };
    });
    const ws2 = XLSX.utils.json_to_sheet(noteRows);
    XLSX.utils.book_append_sheet(wb, ws2, "Catatan");
  }
  if (wb.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Info: "Ruang ini masih kosong" }]), "Info");
  }
  const fileName = `${(wsName || "ruang").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-export.xlsx`;
  XLSX.writeFile(wb, fileName);
}

const RESPONSIVE_CSS = `
.rw-app[data-theme="light"] {
  --app-bg: #F4F4F5;
  --sidebar-bg: #171717;
  --sidebar-border: rgba(255,255,255,0.08);
  --surface: #FFFFFF;
  --surface-solid: #FFFFFF;
  --surface-strong: #FFFFFF;
  --card-border: #E4E4E7;
  --text-primary: #18181B;
  --text-muted: #71717A;
  --text-faint: #A1A1AA;
  --modal-bg: #FFFFFF;
  --modal-overlay: rgba(20,20,20,0.4);
  --input-bg: #FFFFFF;
  --input-border: #D4D4D8;
}
.rw-app[data-theme="dark"] {
  --app-bg: #181818;
  --sidebar-bg: #0d0d0d;
  --sidebar-border: rgba(255,255,255,0.07);
  --surface: #1f1f1f;
  --surface-solid: #232323;
  --surface-strong: #292929;
  --card-border: rgba(255,255,255,0.09);
  --text-primary: #EDEDED;
  --text-muted: #9A9A9A;
  --text-faint: #6B6B6B;
  --modal-bg: #1e1e1e;
  --modal-overlay: rgba(0,0,0,0.65);
  --input-bg: #262626;
  --input-border: rgba(255,255,255,0.14);
}
.rw-glass { backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.rw-sidebar { position: relative; transform: none; z-index: 30; }
.rw-topbar { display: none; }
.rw-backdrop { display: none; }
.rw-board-title { font-size: 26px; }
.rw-column { width: 270px; min-width: 270px; }
.rw-card-stack { scrollbar-width: thin; scrollbar-color: var(--card-border) transparent; }
.rw-card-stack::-webkit-scrollbar { width: 6px; }
.rw-card-stack::-webkit-scrollbar-track { background: transparent; }
.rw-card-stack::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 3px; }
.rw-card-stack::-webkit-scrollbar-thumb:hover { background: var(--text-faint); }
.rw-card {
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}
.rw-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(35,38,43,0.12);
}
.rw-card:active { cursor: grabbing; }
.rw-app button, .rw-app select, .rw-app input {
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
}
.rw-app button:hover:not(:disabled) { opacity: 0.85; }
.rw-app button:active:not(:disabled) { opacity: 0.7; }
.rw-app *:focus-visible {
  outline: 2px solid #3B82F6;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .rw-card, .rw-app button, .rw-app select, .rw-app input, .rw-sidebar { transition: none !important; }
  .rw-card:hover { transform: none; }
}
@media (max-width: 900px) {
  .rw-sidebar {
    position: fixed; top: 0; left: 0; height: 100vh; width: 82%; max-width: 300px;
    transform: translateX(-100%); transition: transform 0.25s ease; box-shadow: 2px 0 16px rgba(0,0,0,0.25);
  }
  .rw-sidebar.open { transform: translateX(0); }
  .rw-topbar { display: flex; }
  .rw-main { padding: 16px !important; padding-top: 68px !important; }
  .rw-backdrop.open { display: block; position: fixed; inset: 0; background: rgba(20,20,20,0.45); z-index: 25; }
  .rw-columns-row { scroll-snap-type: x mandatory; }
  .rw-column { width: 84vw; min-width: 84vw; scroll-snap-align: start; }
  .rw-board-title { font-size: 21px; }
}
@media (max-width: 480px) {
  .rw-column { width: 90vw; min-width: 90vw; }
  .rw-duration-row { flex-wrap: wrap; }
}
`;

// Looks up which column currently holds a card inside one month's board —
// used so calendar notes can toggle/locate the card they're linked to
// without needing to remember its column (which can change as it moves).
function findCardLocation(board, monthKey, cardId) {
  const monthBoard = getMonthBoard(board, monthKey);
  for (const col of monthBoard.columns) {
    if (col.cardIds.includes(cardId)) return { colId: col.id, card: monthBoard.cards[cardId] };
  }
  return null;
}

function LogoMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="112" fill="#111111" />
      <rect x="120" y="288" width="72" height="128" rx="20" fill="#3B82F6" />
      <rect x="220" y="216" width="72" height="200" rx="20" fill="#60A5FA" />
      <rect x="320" y="144" width="72" height="272" rx="20" fill="#10B981" />
      <path d="M337 258 L358 280 L400 232" stroke="#F4F2EC" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function RuangWorkspace() {
  // ---- Portal / auth state ----
  const [authReady, setAuthReady] = useState(false);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [newAccUsername, setNewAccUsername] = useState("");
  const [newAccPassword, setNewAccPassword] = useState("");
  const [newAccRole, setNewAccRole] = useState("member");
  const [accountError, setAccountError] = useState("");
  const [editingAccount, setEditingAccount] = useState(null); // username currently being edited
  const [editAccUsername, setEditAccUsername] = useState("");
  const [editAccPassword, setEditAccPassword] = useState("");
  const [editAccError, setEditAccError] = useState("");

  // ---- Workspace state ----
  const [workspaces, setWorkspaces] = useState(null);
  const [activeWsId, setActiveWsId] = useState(null);
  const [wsData, setWsData] = useState(null);
  const [ready, setReady] = useState(false);
  const [dragCard, setDragCard] = useState(null);
  const [showAddWs, setShowAddWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [newWsMode, setNewWsMode] = useState("personal");
  const [newWsRoster, setNewWsRoster] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [allUsernames, setAllUsernames] = useState([]);
  const [rosterPanelWsId, setRosterPanelWsId] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [, forceTick] = useState(0);

  const requestConfirm = (message, onConfirm, options) =>
    setConfirmDialog({ message, onConfirm, confirmLabel: options?.confirmLabel, onCancel: options?.onCancel });

  // Load the roster of registered usernames once logged in (used for tagging
  // "anggota terlibat" and for building/managing team workspace rosters).
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const res = await fetch("/api/auth/usernames", { credentials: "include" });
        const data = await res.json();
        if (res.ok) setAllUsernames(data.usernames || []);
      } catch (e) {}
    })();
  }, [currentUser?.username]);

  // Load saved theme preference once logged in, and persist changes
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const res = await window.storage.get("ruang-theme-pref", false);
        if (res && (res.value === "light" || res.value === "dark")) setTheme(res.value);
      } catch (e) {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.username]);

  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      window.storage.set("ruang-theme-pref", next, false).catch(() => {});
      return next;
    });
  };

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Check session + whether any account exists yet
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/bootstrap", { credentials: "include" });
        const data = await res.json();
        setHasAccounts(!!data.hasAccounts);
        setCurrentUser(data.user || null);
      } catch (e) {
        setHasAccounts(false);
        setCurrentUser(null);
      }
      setAuthReady(true);
    })();
  }, []);

  // Load workspace indices once logged in
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      let personal = [];
      let shared = [];
      try {
        const res = await window.storage.get(PERSONAL_INDEX_KEY, false);
        if (res && res.value) personal = JSON.parse(res.value);
      } catch (e) {}
      try {
        const res = await window.storage.get(SHARED_INDEX_KEY, true);
        if (res && res.value) shared = JSON.parse(res.value);
      } catch (e) {}

      let list = [...personal, ...shared.filter((ws) => currentUser.role === "admin" || (ws.allowedMembers || []).includes(currentUser.username))];
      if (list.length === 0) {
        const id = uid();
        const entry = { id, name: "Ruang Pertama", mode: "personal" };
        list = [entry];
        try {
          await window.storage.set(PERSONAL_INDEX_KEY, JSON.stringify([entry]), false);
          await window.storage.set(dataKey(id), JSON.stringify(sampleWorkspaceData()), false);
        } catch (e) {}
      }
      setWorkspaces(list);
      setActiveWsId(list[0].id);
      setReady(true);
    })();
  }, [currentUser]);

  useEffect(() => {
    if (!activeWsId || !workspaces) return;
    const ws = workspaces.find((w) => w.id === activeWsId);
    if (!ws) return;
    setWsData(null); // clear immediately so the debounced save below can't pair stale data with the new workspace's key
    (async () => {
      try {
        const res = await window.storage.get(dataKey(ws.id), ws.mode === "team");
        setWsData(normalizeWsData(res && res.value ? JSON.parse(res.value) : null));
      } catch (e) {
        setWsData(normalizeWsData(null));
      }
    })();
  }, [activeWsId, workspaces]);

  const activeWs = workspaces ? workspaces.find((w) => w.id === activeWsId) : null;
  useDebouncedSave(activeWs ? dataKey(activeWs.id) : null, wsData, activeWs?.mode === "team", ready && !!wsData);

  // ---- Auth actions ----
  const handleCreateFirstAdmin = async () => {
    const uname = loginUsername.trim();
    if (!uname || !loginPassword) {
      setLoginError("Isi username dan kata sandi.");
      return;
    }
    setAuthSubmitting(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: uname, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || "Gagal membuat akun.");
        return;
      }
      setCurrentUser(data.user);
      setHasAccounts(true);
      setLoginUsername("");
      setLoginPassword("");
      setLoginError("");
    } catch (e) {
      setLoginError("Tidak bisa terhubung ke server.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogin = async () => {
    const uname = loginUsername.trim();
    if (!uname || !loginPassword) {
      setLoginError("Isi username dan kata sandi.");
      return;
    }
    setAuthSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: uname, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || "Username atau kata sandi salah.");
        return;
      }
      setCurrentUser(data.user);
      setLoginUsername("");
      setLoginPassword("");
      setLoginError("");
    } catch (e) {
      setLoginError("Tidak bisa terhubung ke server.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (e) {}
    setCurrentUser(null);
    setWorkspaces(null);
    setActiveWsId(null);
    setWsData(null);
    setReady(false);
  };

  const loadAccounts = async () => {
    try {
      const res = await fetch("/api/auth/accounts", { credentials: "include" });
      const data = await res.json();
      if (res.ok) setAccounts(data.accounts || []);
    } catch (e) {}
  };

  const handleAddAccount = async () => {
    const uname = newAccUsername.trim();
    if (!uname || !newAccPassword) {
      setAccountError("Isi username dan kata sandi.");
      return;
    }
    try {
      const res = await fetch("/api/auth/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: uname, password: newAccPassword, role: newAccRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAccountError(data.error || "Gagal menambah akun.");
        return;
      }
      await loadAccounts();
      setNewAccUsername("");
      setNewAccPassword("");
      setNewAccRole("member");
      setAccountError("");
    } catch (e) {
      setAccountError("Tidak bisa terhubung ke server.");
    }
  };

  const performDeleteAccount = async (username) => {
    try {
      await fetch(`/api/auth/accounts/${encodeURIComponent(username)}`, { method: "DELETE", credentials: "include" });
    } catch (e) {}
    await loadAccounts();
    if (currentUser?.username === username) handleLogout();
  };

  const startEditAccount = (username) => {
    setEditingAccount(username);
    setEditAccUsername(username);
    setEditAccPassword("");
    setEditAccError("");
  };

  const cancelEditAccount = () => {
    setEditingAccount(null);
    setEditAccUsername("");
    setEditAccPassword("");
    setEditAccError("");
  };

  const handleSaveEditAccount = async () => {
    const oldUsername = editingAccount;
    const uname = editAccUsername.trim();
    if (!uname) {
      setEditAccError("Username tidak boleh kosong.");
      return;
    }
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(oldUsername)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newUsername: uname, newPassword: editAccPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditAccError(data.error || "Gagal menyimpan perubahan.");
        return;
      }
      if (currentUser?.username === oldUsername && uname !== oldUsername) {
        setCurrentUser((u) => ({ ...u, username: uname }));
      }
      await loadAccounts();
      cancelEditAccount();
    } catch (e) {
      setEditAccError("Tidak bisa terhubung ke server.");
    }
  };

  useEffect(() => {
    if (currentUser?.role === "admin" && showAccountPanel) loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAccountPanel, currentUser?.username]);

  // ---- Workspace CRUD ----
  const createWorkspace = async () => {
    const name = newWsName.trim() || "Ruang Baru";
    const id = uid();
    const mode = newWsMode;
    const allowedMembers = mode === "team" ? Array.from(new Set([...newWsRoster, currentUser.username])) : undefined;
    const entry = mode === "team" ? { id, name, mode, allowedMembers } : { id, name, mode };
    const empty = emptyWorkspaceData();
    try {
      await window.storage.set(dataKey(id), JSON.stringify(empty), mode === "team");
      if (mode === "team") {
        const res = await window.storage.get(SHARED_INDEX_KEY, true).catch(() => null);
        const current = res && res.value ? JSON.parse(res.value) : [];
        await window.storage.set(SHARED_INDEX_KEY, JSON.stringify([...current, entry]), true);
      } else {
        const res = await window.storage.get(PERSONAL_INDEX_KEY, false).catch(() => null);
        const current = res && res.value ? JSON.parse(res.value) : [];
        await window.storage.set(PERSONAL_INDEX_KEY, JSON.stringify([...current, entry]), false);
      }
    } catch (e) {
      console.error("Gagal membuat ruang:", e);
    }
    setWorkspaces((w) => [...w, entry]);
    setActiveWsId(id);
    setShowAddWs(false);
    setNewWsName("");
    setNewWsMode("personal");
    setNewWsRoster([]);
  };

  const updateWorkspaceRoster = async (ws, nextRoster) => {
    try {
      const res = await window.storage.get(SHARED_INDEX_KEY, true).catch(() => null);
      const current = res && res.value ? JSON.parse(res.value) : [];
      const updated = current.map((w) => (w.id === ws.id ? { ...w, allowedMembers: nextRoster } : w));
      await window.storage.set(SHARED_INDEX_KEY, JSON.stringify(updated), true);
    } catch (e) {
      console.error("Gagal memperbarui anggota ruang:", e);
    }
    setWorkspaces((list) => list.map((w) => (w.id === ws.id ? { ...w, allowedMembers: nextRoster } : w)));
  };

  const performDeleteWorkspace = async (ws) => {
    try {
      if (ws.mode === "team") {
        const res = await window.storage.get(SHARED_INDEX_KEY, true).catch(() => null);
        const current = res && res.value ? JSON.parse(res.value) : [];
        await window.storage.set(SHARED_INDEX_KEY, JSON.stringify(current.filter((w) => w.id !== ws.id)), true);
        await window.storage.delete(dataKey(ws.id), true).catch(() => {});
      } else {
        const res = await window.storage.get(PERSONAL_INDEX_KEY, false).catch(() => null);
        const current = res && res.value ? JSON.parse(res.value) : [];
        await window.storage.set(PERSONAL_INDEX_KEY, JSON.stringify(current.filter((w) => w.id !== ws.id)), false);
        await window.storage.delete(dataKey(ws.id), false).catch(() => {});
      }
    } catch (e) {
      console.error("Gagal menghapus ruang:", e);
    }
    setWorkspaces((list) => {
      const next = list.filter((w) => w.id !== ws.id);
      if (activeWsId === ws.id && next.length) setActiveWsId(next[0].id);
      return next;
    });
  };

  const requestDeleteWorkspace = (ws) => {
    requestConfirm(`Hapus ruang "${ws.name}"? Semua papan dan catatan di dalamnya akan ikut terhapus.`, () => performDeleteWorkspace(ws));
  };

  const exportWorkspaceById = async (ws) => {
    let data;
    if (ws.id === activeWsId && wsData) {
      data = wsData;
    } else {
      try {
        const res = await window.storage.get(dataKey(ws.id), ws.mode === "team");
        data = normalizeWsData(res && res.value ? JSON.parse(res.value) : null);
      } catch (e) {
        data = normalizeWsData(null);
      }
    }
    buildAndDownloadWorkbook(ws.name, data);
  };

  // ================= RENDER: loading / auth screens =================
  if (!authReady) {
    return (
      <div style={styles.loadingWrap}>
        <style>{RESPONSIVE_CSS}</style>
        <div style={styles.loadingText}>Memuat portal…</div>
      </div>
    );
  }

  if (!hasAccounts) {
    return (
      <AuthScreen
        mode="setup"
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        submitting={authSubmitting}
        setUsername={setLoginUsername}
        setPassword={setLoginPassword}
        onSubmit={handleCreateFirstAdmin}
      />
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        mode="login"
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        submitting={authSubmitting}
        setUsername={setLoginUsername}
        setPassword={setLoginPassword}
        onSubmit={handleLogin}
      />
    );
  }

  if (!workspaces || !wsData) {
    return (
      <div style={styles.loadingWrap}>
        <style>{RESPONSIVE_CSS}</style>
        <div style={styles.loadingText}>Memuat ruang kerja…</div>
      </div>
    );
  }

  // ================= RENDER: main portal app =================
  const isAdmin = currentUser.role === "admin";
  const activeBoard = wsData.active.type === "board" ? wsData.boards[wsData.active.id] : null;
  const activeNote = wsData.active.type === "note" ? wsData.notes[wsData.active.id] : null;
  const activeInsight = wsData.active.type === "insight";
  const activeCalendar = wsData.active.type === "calendar";
  const currentTitle = activeBoard ? activeBoard.name : activeNote ? activeNote.title || "Tanpa judul" : activeInsight ? "Insight" : activeCalendar ? "Kalender" : "Kanban YISS";
  const { overdue, dueSoon } = collectUrgentCards(wsData);
  const urgentCount = overdue.length + dueSoon.length;

  const setActive = (active) => setWsData((d) => ({ ...d, active }));
  const closeSidebar = () => setSidebarOpen(false);

  // "Tim terlibat" now draws from real portal accounts: the approved
  // roster for team workspaces, or every registered account for personal ones.
  const availableMembers = activeWs?.mode === "team" ? activeWs.allowedMembers || [] : allUsernames;

  const addCardType = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWsData((d) => (d.cardTypes.includes(trimmed) ? d : { ...d, cardTypes: [...d.cardTypes, trimmed] }));
  };

  // ---- Board actions (semua beroperasi pada bulan yang sedang dilihat) ----
  const addBoard = () => {
    const id = uid();
    setWsData((d) => ({
      ...d,
      boards: {
        ...d.boards,
        [id]: {
          id,
          name: "Papan Baru",
          monthly: { [currentMonthKey()]: { columns: defaultColumnsTemplate(), cards: {} } },
        },
      },
      boardOrder: [...d.boardOrder, id],
      active: { type: "board", id },
    }));
  };

  const deleteBoard = (id) => {
    setWsData((d) => {
      const boards = { ...d.boards };
      delete boards[id];
      const boardOrder = d.boardOrder.filter((b) => b !== id);
      const active =
        d.active.type === "board" && d.active.id === id
          ? boardOrder.length
            ? { type: "board", id: boardOrder[0] }
            : { type: "none" }
          : d.active;
      return { ...d, boards, boardOrder, active };
    });
  };

  const renameBoard = (id, name) => {
    setWsData((d) => ({ ...d, boards: { ...d.boards, [id]: { ...d.boards[id], name } } }));
  };

  // Small helper so every month-scoped mutation shares the same "read this
  // month's bucket (or a fresh one), patch it, write it back" shape.
  const patchMonthBoard = (boardId, monthKey, updater) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      if (!board) return d;
      const monthBoard = getMonthBoard(board, monthKey);
      const updatedMonthBoard = updater(monthBoard);
      if (updatedMonthBoard === null) return d;
      return { ...d, boards: { ...d.boards, [boardId]: { ...board, monthly: { ...(board.monthly || {}), [monthKey]: updatedMonthBoard } } } };
    });
  };

  const addColumn = (boardId, monthKey) => {
    patchMonthBoard(boardId, monthKey, (mb) => ({ ...mb, columns: [...mb.columns, { id: uid(), name: "Kolom Baru", cardIds: [] }] }));
  };

  const renameColumn = (boardId, monthKey, colId, name) => {
    patchMonthBoard(boardId, monthKey, (mb) => ({ ...mb, columns: mb.columns.map((c) => (c.id === colId ? { ...c, name } : c)) }));
  };

  const deleteColumn = (boardId, monthKey, colId) => {
    patchMonthBoard(boardId, monthKey, (mb) => {
      const col = mb.columns.find((c) => c.id === colId);
      const cards = { ...mb.cards };
      if (col) col.cardIds.forEach((cid) => delete cards[cid]);
      return { ...mb, columns: mb.columns.filter((c) => c.id !== colId), cards };
    });
  };

  // Returns the new card's id synchronously (the id is minted before the
  // state update, not inside it) so callers — like the calendar sync — can
  // immediately remember which card they just created.
  const addCard = (boardId, monthKey, colId, text, duration, involvedMembers, cardType, qty, createdAt) => {
    const finalText = (text && text.trim()) || cardType || "Kartu Baru";
    const finalQty = Number(qty) > 0 ? Number(qty) : 1;
    const finalCreatedAt = Number(createdAt) > 0 ? Number(createdAt) : Date.now();
    const newId = uid();
    const newCard = { id: newId, text: finalText, createdAt: finalCreatedAt, duration: duration || null, involvedMembers: involvedMembers || [], cardType: cardType || "", qty: finalQty, checked: false, priority: false };
    patchMonthBoard(boardId, monthKey, (mb) => {
      // Falls back to the first column if colId doesn't match anything in
      // this month's bucket (e.g. a calendar note aimed at a month that's
      // never been opened before) — so the card never silently disappears.
      const targetColId = mb.columns.some((c) => c.id === colId) ? colId : mb.columns[0] && mb.columns[0].id;
      return {
        ...mb,
        cards: { ...mb.cards, [newId]: newCard },
        // Kartu baru selalu ditaruh paling atas kolom — kartu lama otomatis turun.
        columns: mb.columns.map((c) => (c.id === targetColId ? { ...c, cardIds: [newId, ...c.cardIds] } : c)),
      };
    });
    return newId;
  };

  // Removes the card from whichever column currently holds it, so callers
  // (including calendar notes) don't need to track its column separately.
  const deleteCard = (boardId, monthKey, cardId) => {
    patchMonthBoard(boardId, monthKey, (mb) => {
      const cards = { ...mb.cards };
      delete cards[cardId];
      return { ...mb, cards, columns: mb.columns.map((c) => ({ ...c, cardIds: c.cardIds.filter((id) => id !== cardId) })) };
    });
  };

  const moveCard = (boardId, monthKey, fromCol, toCol, cardId) => {
    patchMonthBoard(boardId, monthKey, (mb) => {
      const columns = mb.columns.map((c) => (c.id === fromCol ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) } : c));
      const finalColumns = columns.map((c) => (c.id === toCol && !c.cardIds.includes(cardId) ? { ...c, cardIds: [...c.cardIds, cardId] } : c));
      const toIndex = mb.columns.findIndex((c) => c.id === toCol);
      const card = mb.cards[cardId];
      // Menyeret kartu langsung ke "Sedang Dikerjakan" juga mengaktifkan timer,
      // sama seperti mencentangnya — kalau belum pernah dimulai sebelumnya.
      const cards = toIndex === 1 && card && !card.startedAt ? { ...mb.cards, [cardId]: { ...card, startedAt: Date.now() } } : mb.cards;
      return { ...mb, columns: finalColumns, cards };
    });
  };

  const updateCard = (boardId, monthKey, cardId, patch) => {
    patchMonthBoard(boardId, monthKey, (mb) => {
      if (!mb.cards[cardId]) return null;
      return { ...mb, cards: { ...mb.cards, [cardId]: { ...mb.cards[cardId], ...patch } } };
    });
  };

  const toggleCheck = (boardId, monthKey, colId, cardId) => {
    patchMonthBoard(boardId, monthKey, (mb) => {
      const colIndex = mb.columns.findIndex((c) => c.id === colId);
      const card = mb.cards[cardId];
      if (!card) return null;
      const newChecked = !card.checked;
      let cards = { ...mb.cards, [cardId]: { ...card, checked: newChecked } };
      let columns = mb.columns;

      if (newChecked && colIndex >= 0 && colIndex <= 1 && colIndex < mb.columns.length - 1) {
        const targetIndex = colIndex + 1;
        columns = mb.columns.map((c, i) => {
          if (c.id === colId) return { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) };
          // Kartu yang baru dicentang selalu masuk ke urutan paling atas
          // kolom tujuan (Sedang Dikerjakan / Selesai) — kartu lama di
          // kolom itu otomatis turun, sama seperti kartu yang baru dibuat.
          if (i === targetIndex) return { ...c, cardIds: [cardId, ...c.cardIds] };
          return c;
        });
        const clearDuration = targetIndex === 2;
        const startingNow = targetIndex === 1 && !cards[cardId].startedAt;
        cards = {
          ...cards,
          [cardId]: {
            ...cards[cardId],
            checked: false,
            duration: clearDuration ? null : cards[cardId].duration,
            startedAt: startingNow ? Date.now() : cards[cardId].startedAt,
          },
        };
      }
      return { ...mb, columns, cards };
    });
  };

  // Menandai kartu sebagai prioritas tinggi. Saat dinyalakan, kartu langsung
  // dipindah ke urutan paling atas kolomnya (di-pin) — kartu lain otomatis
  // turun. Saat dimatikan, posisinya dibiarkan apa adanya.
  const togglePriority = (boardId, monthKey, colId, cardId) => {
    patchMonthBoard(boardId, monthKey, (mb) => {
      const card = mb.cards[cardId];
      if (!card) return null;
      const newPriority = !card.priority;
      const cards = { ...mb.cards, [cardId]: { ...card, priority: newPriority } };
      let columns = mb.columns;
      if (newPriority) {
        columns = mb.columns.map((c) => (c.id === colId ? { ...c, cardIds: [cardId, ...c.cardIds.filter((id) => id !== cardId)] } : c));
      }
      return { ...mb, columns, cards };
    });
  };


  // Menambahkan kartu dari kalender bekerja persis seperti menambah kartu
  // langsung dari papan (jenis, jumlah, tim terlibat, durasi, kolom tujuan) —
  // hanya saja tanggal & bulannya ditentukan oleh tanggal yang dipilih di
  // kalender, sehingga otomatis tersinkron ke papan yang sesuai.
  const addCalendarNote = (dateStr, boardId, colId, text, cardType, duration, involvedMembers, qty) => {
    const board = wsData.boards[boardId];
    if (!board || (!text.trim() && !cardType)) return;
    const monthKey = monthKeyFromTimestamp(dateInputToTimestamp(dateStr));
    const monthBoard = getMonthBoard(board, monthKey);
    const targetCol = monthBoard.columns.find((c) => c.id === colId) || monthBoard.columns[0];
    if (!targetCol) return;
    const finalMembers = involvedMembers && involvedMembers.length ? involvedMembers : currentUser ? [currentUser.username] : [];
    const cardId = addCard(boardId, monthKey, targetCol.id, text, duration || null, finalMembers, cardType || "", qty, dateInputToTimestamp(dateStr));
    const noteId = uid();
    setWsData((d) => {
      const list = d.calendarNotes[dateStr] || [];
      return { ...d, calendarNotes: { ...d.calendarNotes, [dateStr]: [...list, { id: noteId, boardId, monthKey, cardId }] } };
    });
  };

  const deleteCalendarNote = (dateStr, note) => {
    deleteCard(note.boardId, note.monthKey, note.cardId);
    setWsData((d) => {
      const list = (d.calendarNotes[dateStr] || []).filter((n) => n.id !== note.id);
      const calendarNotes = { ...d.calendarNotes };
      if (list.length) calendarNotes[dateStr] = list;
      else delete calendarNotes[dateStr];
      return { ...d, calendarNotes };
    });
  };

  const toggleCalendarNote = (note) => {
    const board = wsData.boards[note.boardId];
    if (!board) return;
    const loc = findCardLocation(board, note.monthKey, note.cardId);
    if (!loc) return;
    toggleCheck(note.boardId, note.monthKey, loc.colId, note.cardId);
  };

  // ---- Note actions ----
  const addNote = () => {
    const id = uid();
    setWsData((d) => ({
      ...d,
      notes: { ...d.notes, [id]: { id, title: "Catatan Baru", content: "", updatedAt: Date.now() } },
      noteOrder: [...d.noteOrder, id],
      active: { type: "note", id },
    }));
  };

  const updateNote = (id, patch) => {
    setWsData((d) => ({ ...d, notes: { ...d.notes, [id]: { ...d.notes[id], ...patch, updatedAt: Date.now() } } }));
  };

  const deleteNote = (id) => {
    setWsData((d) => {
      const notes = { ...d.notes };
      delete notes[id];
      const noteOrder = d.noteOrder.filter((n) => n !== id);
      const active =
        d.active.type === "note" && d.active.id === id
          ? noteOrder.length
            ? { type: "note", id: noteOrder[0] }
            : { type: "none" }
          : d.active;
      return { ...d, notes, noteOrder, active };
    });
  };

  const goToUrgentCard = (item) => {
    setActiveWsId((cur) => cur); // no-op, already in this workspace
    setActive({ type: "board", id: item.boardId });
    setShowNotifPanel(false);
    closeSidebar();
  };

  return (
    <div className="rw-app" data-theme={theme} style={styles.app}>
      <style>{RESPONSIVE_CSS}</style>

      <div className="rw-topbar" style={styles.topbar}>
        <button style={styles.hamburgerBtn} onClick={() => setSidebarOpen(true)} aria-label="Buka menu">
          ☰
        </button>
        <span style={styles.topbarTitle}>{currentTitle}</span>
      </div>
      <div className={`rw-backdrop ${sidebarOpen ? "open" : ""}`} onClick={closeSidebar} />

      <Sidebar
        sidebarOpen={sidebarOpen}
        onClose={closeSidebar}
        currentUser={currentUser}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={toggleTheme}
        isAdmin={isAdmin}
        accounts={accounts}
        showAccountPanel={showAccountPanel}
        setShowAccountPanel={setShowAccountPanel}
        newAccUsername={newAccUsername}
        setNewAccUsername={setNewAccUsername}
        newAccPassword={newAccPassword}
        setNewAccPassword={setNewAccPassword}
        newAccRole={newAccRole}
        setNewAccRole={setNewAccRole}
        accountError={accountError}
        onAddAccount={handleAddAccount}
        onRequestDeleteAccount={(u) => requestConfirm(`Hapus akun "${u}"?`, () => performDeleteAccount(u))}
        editingAccount={editingAccount}
        editAccUsername={editAccUsername}
        setEditAccUsername={setEditAccUsername}
        editAccPassword={editAccPassword}
        setEditAccPassword={setEditAccPassword}
        editAccError={editAccError}
        onStartEditAccount={startEditAccount}
        onCancelEditAccount={cancelEditAccount}
        onSaveEditAccount={handleSaveEditAccount}
        workspaces={workspaces}
        activeWsId={activeWsId}
        onSelectWs={(id) => {
          setActiveWsId(id);
          closeSidebar();
        }}
        onDeleteWs={requestDeleteWorkspace}
        onExportWs={exportWorkspaceById}
        onRequestConfirm={requestConfirm}
        showAddWs={showAddWs}
        setShowAddWs={setShowAddWs}
        newWsName={newWsName}
        setNewWsName={setNewWsName}
        newWsMode={newWsMode}
        setNewWsMode={setNewWsMode}
        newWsRoster={newWsRoster}
        setNewWsRoster={setNewWsRoster}
        allUsernames={allUsernames}
        rosterPanelWsId={rosterPanelWsId}
        onToggleRosterPanel={(id) => setRosterPanelWsId((cur) => (cur === id ? null : id))}
        onUpdateRoster={updateWorkspaceRoster}
        onCreateWs={createWorkspace}
        wsData={wsData}
        onSelectBoard={(id) => {
          setActive({ type: "board", id });
          closeSidebar();
        }}
        onSelectNote={(id) => {
          setActive({ type: "note", id });
          closeSidebar();
        }}
        onSelectInsight={() => {
          setActive({ type: "insight" });
          closeSidebar();
        }}
        onSelectCalendar={() => {
          setActive({ type: "calendar" });
          closeSidebar();
        }}
        onAddBoard={addBoard}
        onAddNote={addNote}
        onDeleteBoard={deleteBoard}
        onDeleteNote={deleteNote}
      />
      <main className="rw-main" style={styles.main}>
        {activeWs?.mode === "team" && (
          <div style={styles.teamBanner}>Ruang tim — hanya anggota yang disetujui admin yang bisa membuka dan mengedit ruang ini.</div>
        )}
        {activeBoard && (
          <BoardView
            board={activeBoard}
            members={availableMembers}
            cardTypes={wsData.cardTypes}
            onAddCardType={addCardType}
            isAdmin={isAdmin}
            currentUsername={currentUser.username}
            onRename={renameBoard}
            onAddColumn={addColumn}
            onRenameColumn={renameColumn}
            onDeleteColumn={deleteColumn}
            onAddCard={addCard}
            onDeleteCard={deleteCard}
            onMoveCard={moveCard}
            onUpdateCard={updateCard}
            onToggleCheck={toggleCheck}
            onTogglePriority={togglePriority}
            onRequestConfirm={requestConfirm}
            dragCard={dragCard}
            setDragCard={setDragCard}
          />
        )}
        {activeNote && <NoteView note={activeNote} onUpdate={updateNote} />}
        {activeInsight && <InsightView wsData={wsData} />}
        {activeCalendar && (
          <CalendarView
            wsData={wsData}
            currentUsername={currentUser.username}
            members={availableMembers}
            isAdmin={isAdmin}
            cardTypes={wsData.cardTypes}
            onAddCardType={addCardType}
            onAddNote={addCalendarNote}
            onDeleteNote={deleteCalendarNote}
            onToggleNote={toggleCalendarNote}
            onRequestConfirm={requestConfirm}
          />
        )}
        {!activeBoard && !activeNote && !activeInsight && !activeCalendar && (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>Belum ada yang dipilih</div>
            <div style={styles.emptyText}>Buat papan untuk melacak pekerjaan, atau catatan untuk menulis ide.</div>
          </div>
        )}
      </main>

      {/* Notification bell */}
      <button style={styles.bellBtn} onClick={() => setShowNotifPanel((v) => !v)} title="Notifikasi tenggat waktu" aria-label="Notifikasi">
        <Bell size={19} />
        {urgentCount > 0 && <span style={styles.bellBadge}>{urgentCount}</span>}
      </button>
      {showNotifPanel && (
        <div style={styles.notifPanel}>
          <div style={styles.notifTitle}>Notifikasi Tenggat</div>
          {urgentCount === 0 && <div style={styles.notifEmpty}>Tidak ada kartu yang mendekati atau melewati tenggat.</div>}
          {overdue.length > 0 && (
            <div style={styles.notifGroup}>
              <div style={styles.notifGroupLabelOverdue}>Terlambat</div>
              {overdue.map((it, i) => (
                <div key={i} style={styles.notifItem} onClick={() => goToUrgentCard(it)}>
                  <div style={styles.notifItemText}>{it.cardText}</div>
                  <div style={styles.notifItemMeta}>{it.boardName} · {it.columnName} · {it.text}</div>
                </div>
              ))}
            </div>
          )}
          {dueSoon.length > 0 && (
            <div style={styles.notifGroup}>
              <div style={styles.notifGroupLabelSoon}>Mendekati tenggat (&lt; 12 jam)</div>
              {dueSoon.map((it, i) => (
                <div key={i} style={styles.notifItem} onClick={() => goToUrgentCard(it)}>
                  <div style={styles.notifItemText}>{it.cardText}</div>
                  <div style={styles.notifItemMeta}>{it.boardName} · {it.columnName} · {it.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmDialog && (
        <div style={styles.modalBackdrop} onClick={() => setConfirmDialog(null)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalMessage}>{confirmDialog.message}</div>
            <div style={styles.modalActions}>
              <button
                style={styles.modalCancel}
                onClick={() => {
                  confirmDialog.onCancel?.();
                  setConfirmDialog(null);
                }}
              >
                Batal
              </button>
              <button
                style={styles.modalConfirm}
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                {confirmDialog.confirmLabel || "Hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthScreen({ mode, username, password, error, submitting, setUsername, setPassword, onSubmit }) {
  return (
    <div style={styles.authWrap}>
      <style>{RESPONSIVE_CSS}</style>
      <div style={styles.authCard}>
        <div style={styles.authBrand}>
          <LogoMark size={30} />
          <span style={styles.authBrandName}>Kanban YISS</span>
        </div>
        <div style={styles.authSubtitle}>Portal Kerja Tim</div>

        {mode === "setup" && (
          <div style={styles.authHint}>
            Belum ada akun. Buat akun admin pertama untuk mengelola portal ini.
          </div>
        )}

        <input style={styles.authInput} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} autoFocus />
        <input style={styles.authInput} type="password" placeholder="Kata sandi" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} />
        {error && <div style={styles.authError}>{error}</div>}
        <button style={styles.authSubmitBtn} onClick={onSubmit} disabled={submitting}>
          {submitting ? "Memproses…" : mode === "setup" ? "Buat Akun Admin" : "Masuk"}
        </button>
      </div>
    </div>
  );
}

function Sidebar({
  sidebarOpen,
  onClose,
  currentUser,
  onLogout,
  theme,
  onToggleTheme,
  isAdmin,
  accounts,
  showAccountPanel,
  setShowAccountPanel,
  newAccUsername,
  setNewAccUsername,
  newAccPassword,
  setNewAccPassword,
  newAccRole,
  setNewAccRole,
  accountError,
  onAddAccount,
  onRequestDeleteAccount,
  editingAccount,
  editAccUsername,
  setEditAccUsername,
  editAccPassword,
  setEditAccPassword,
  editAccError,
  onStartEditAccount,
  onCancelEditAccount,
  onSaveEditAccount,
  workspaces,
  activeWsId,
  onSelectWs,
  onDeleteWs,
  onExportWs,
  onRequestConfirm,
  showAddWs,
  setShowAddWs,
  newWsName,
  setNewWsName,
  newWsMode,
  setNewWsMode,
  newWsRoster,
  setNewWsRoster,
  allUsernames,
  rosterPanelWsId,
  onToggleRosterPanel,
  onUpdateRoster,
  onCreateWs,
  wsData,
  onSelectBoard,
  onSelectNote,
  onSelectInsight,
  onSelectCalendar,
  onAddBoard,
  onAddNote,
  onDeleteBoard,
  onDeleteNote,
}) {
  return (
    <aside className={`rw-sidebar ${sidebarOpen ? "open" : ""}`} style={styles.sidebar}>
      <div style={styles.brandRow}>
        <div style={styles.brand}>
          <LogoMark size={22} />
          <span style={styles.brandName}>Kanban YISS</span>
        </div>
        <button style={styles.sidebarCloseBtn} onClick={onClose} aria-label="Tutup menu">
          <X size={20} />
        </button>
      </div>

      <div style={styles.userRow}>
        <div style={styles.userInfo}>
          <span style={styles.userName}>{currentUser.username}</span>
          <span style={{ ...styles.userRoleBadge, ...(isAdmin ? styles.userRoleBadgeAdmin : {}) }}>{isAdmin ? "Admin" : "Anggota"}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={styles.logoutBtn} onClick={onToggleTheme} title={theme === "light" ? "Mode gelap" : "Mode terang"}>
            {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          <button style={styles.logoutBtn} onClick={onLogout} title="Keluar">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {isAdmin && (
        <div style={styles.wsGroup}>
          <div style={styles.wsHead}>
            <span style={styles.wsHeadLabel}>
              <ShieldCheck size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
              Kelola Akun
            </span>
            <button style={styles.tabAdd} onClick={() => setShowAccountPanel((v) => !v)} title="Kelola akun portal">
              <Plus size={13} />
            </button>
          </div>
          {showAccountPanel && (
            <div style={styles.addWsPanel}>
              <div style={styles.memberList}>
                {(accounts || []).map((a) =>
                  editingAccount === a.username ? (
                    <div key={a.username} style={styles.editAccountRow}>
                      <input
                        style={styles.addWsInput}
                        placeholder="Username…"
                        value={editAccUsername}
                        onChange={(e) => setEditAccUsername(e.target.value)}
                        autoFocus
                      />
                      <input
                        style={styles.addWsInput}
                        type="password"
                        placeholder="Kata sandi baru (kosongkan jika tidak diubah)"
                        value={editAccPassword}
                        onChange={(e) => setEditAccPassword(e.target.value)}
                      />
                      {editAccError && <div style={styles.authError}>{editAccError}</div>}
                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={{ ...styles.createWsBtn, flex: 1 }} onClick={onSaveEditAccount}>
                          Simpan
                        </button>
                        <button style={styles.addTypeCancelBtn} onClick={onCancelEditAccount} title="Batal">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={a.username} style={styles.memberRow}>
                      <span>
                        {a.username} <span style={{ opacity: 0.6, fontSize: 10.5 }}>({a.role === "admin" ? "Admin" : "Anggota"})</span>
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button style={styles.memberDelete} onClick={() => onStartEditAccount(a.username)} title="Edit akun">
                          <Pencil size={13} />
                        </button>
                        <button style={styles.memberDelete} onClick={() => onRequestDeleteAccount(a.username)} title="Hapus akun">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
              <input style={styles.addWsInput} placeholder="Username baru…" value={newAccUsername} onChange={(e) => setNewAccUsername(e.target.value)} />
              <input style={styles.addWsInput} type="password" placeholder="Kata sandi…" value={newAccPassword} onChange={(e) => setNewAccPassword(e.target.value)} />
              <div style={styles.modeToggle}>
                <button style={{ ...styles.modeBtn, ...(newAccRole === "member" ? styles.modeBtnActive : {}) }} onClick={() => setNewAccRole("member")}>
                  Anggota
                </button>
                <button style={{ ...styles.modeBtn, ...(newAccRole === "admin" ? styles.modeBtnActive : {}) }} onClick={() => setNewAccRole("admin")}>
                  Admin
                </button>
              </div>
              {accountError && <div style={styles.authError}>{accountError}</div>}
              <button style={styles.createWsBtn} onClick={onAddAccount}>
                Tambah Akun
              </button>
            </div>
          )}
        </div>
      )}

      <div style={styles.divider} />

      <div style={styles.wsGroup}>
        <div style={styles.wsHead}>
          <span style={styles.wsHeadLabel}>Ruang Kerja</span>
          <button style={styles.tabAdd} onClick={() => setShowAddWs((v) => !v)} title="Tambah ruang">
            <Plus size={13} />
          </button>
        </div>
        <div style={styles.list}>
          {workspaces.map((ws) => (
            <div key={ws.id} style={{ ...styles.wsItem, ...(ws.id === activeWsId ? styles.wsItemActive : {}) }} onClick={() => onSelectWs(ws.id)}>
              <span style={styles.listItemText}>{ws.name}</span>
              <span style={{ ...styles.wsBadge, ...(ws.mode === "team" ? styles.wsBadgeTeam : {}) }}>{ws.mode === "team" ? "Tim" : "Pribadi"}</span>
              {ws.mode === "team" && isAdmin && (
                <button
                  style={styles.iconBtnSmall}
                  title="Kelola anggota ruang tim"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleRosterPanel(ws.id);
                  }}
                >
                  <ShieldCheck size={13} />
                </button>
              )}
              <button
                style={styles.iconBtnSmall}
                title="Ekspor ke spreadsheet"
                onClick={(e) => {
                  e.stopPropagation();
                  onExportWs(ws);
                }}
              >
                <Download size={13} />
              </button>
              <button
                style={styles.listItemDelete}
                title="Hapus ruang"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteWs(ws);
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        {rosterPanelWsId &&
          (() => {
            const ws = workspaces.find((w) => w.id === rosterPanelWsId);
            if (!ws) return null;
            const roster = ws.allowedMembers || [];
            return (
              <div style={styles.addWsPanel}>
                <div style={styles.wsHeadLabel}>Anggota "{ws.name}"</div>
                <div style={styles.modeHint}>Hanya username yang dicentang yang bisa membuka & mengedit ruang tim ini.</div>
                <div style={styles.chipRow}>
                  {allUsernames.map((u) => {
                    const active = roster.includes(u);
                    return (
                      <button
                        key={u}
                        style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }}
                        onClick={() => onUpdateRoster(ws, active ? roster.filter((m) => m !== u) : [...roster, u])}
                      >
                        {u}
                      </button>
                    );
                  })}
                </div>
                <button style={styles.createWsBtn} onClick={() => onToggleRosterPanel(null)}>
                  Selesai
                </button>
              </div>
            );
          })()}

        {showAddWs && (
          <div style={styles.addWsPanel}>
            <input
              style={styles.addWsInput}
              placeholder="Nama ruang…"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onCreateWs()}
              autoFocus
            />
            <div style={styles.modeToggle}>
              <button style={{ ...styles.modeBtn, ...(newWsMode === "personal" ? styles.modeBtnActive : {}) }} onClick={() => setNewWsMode("personal")}>
                Pribadi
              </button>
              {isAdmin && (
                <button style={{ ...styles.modeBtn, ...(newWsMode === "team" ? styles.modeBtnActive : {}) }} onClick={() => setNewWsMode("team")}>
                  Tim
                </button>
              )}
            </div>
            {newWsMode === "team" && (
              <>
                <div style={styles.modeHint}>Pilih username yang boleh membuka & mengedit ruang tim ini (bisa diubah lagi nanti).</div>
                <div style={styles.chipRow}>
                  {allUsernames.map((u) => {
                    const active = newWsRoster.includes(u) || u === currentUser.username;
                    return (
                      <button
                        key={u}
                        disabled={u === currentUser.username}
                        style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }}
                        onClick={() => setNewWsRoster((r) => (r.includes(u) ? r.filter((m) => m !== u) : [...r, u]))}
                      >
                        {u}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <button style={styles.createWsBtn} onClick={onCreateWs}>
              Buat Ruang
            </button>
          </div>
        )}
      </div>

      <div style={styles.divider} />

      <div
        style={{ ...styles.insightNavItem, ...(wsData.active.type === "insight" ? styles.insightNavItemActive : {}) }}
        onClick={onSelectInsight}
      >
        <PieChart size={15} />
        <span>Insight</span>
      </div>

      <div
        style={{ ...styles.insightNavItem, ...(wsData.active.type === "calendar" ? styles.insightNavItemActive : {}) }}
        onClick={onSelectCalendar}
      >
        <Calendar size={15} />
        <span>Kalender</span>
      </div>

      <div style={styles.divider} />

      <div style={styles.tabGroup}>
        <div style={{ ...styles.tab, ...styles.tabGold }}>
          <span>Papan</span>
          <button style={styles.tabAdd} onClick={onAddBoard} title="Tambah papan">
            <Plus size={13} />
          </button>
        </div>
        <div style={styles.list}>
          {wsData.boardOrder.map((id) => {
            const b = wsData.boards[id];
            const isActive = wsData.active.type === "board" && wsData.active.id === id;
            return (
              <div key={id} style={{ ...styles.listItem, ...(isActive ? styles.listItemActiveGold : {}) }} onClick={() => onSelectBoard(id)}>
                <span style={styles.listItemText}>{b.name}</span>
                <button
                  style={styles.listItemDelete}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestConfirm(`Hapus papan "${b.name}"?`, () => onDeleteBoard(id));
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          {wsData.boardOrder.length === 0 && <div style={styles.listEmpty}>Belum ada papan</div>}
        </div>
      </div>

      <div style={styles.tabGroup}>
        <div style={{ ...styles.tab, ...styles.tabMoss }}>
          <span>Catatan</span>
          <button style={styles.tabAdd} onClick={onAddNote} title="Tambah catatan">
            <Plus size={13} />
          </button>
        </div>
        <div style={styles.list}>
          {wsData.noteOrder.map((id) => {
            const n = wsData.notes[id];
            const isActive = wsData.active.type === "note" && wsData.active.id === id;
            return (
              <div key={id} style={{ ...styles.listItem, ...(isActive ? styles.listItemActiveMoss : {}) }} onClick={() => onSelectNote(id)}>
                <span style={styles.listItemText}>{n.title || "Tanpa judul"}</span>
                <button
                  style={styles.listItemDelete}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestConfirm(`Hapus catatan "${n.title}"?`, () => onDeleteNote(id));
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          {wsData.noteOrder.length === 0 && <div style={styles.listEmpty}>Belum ada catatan</div>}
        </div>
      </div>
    </aside>
  );
}

function TypeSelect({ value, options, qty, onChange, onQtyChange, onAddOption, onRequestConfirm }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const committedQty = qty === undefined || qty === null || qty === "" ? 1 : qty;
  const [qtyDraft, setQtyDraft] = useState(committedQty);

  // Stay in sync whenever the committed value changes from outside (e.g.
  // after a confirmed save, or another surface updating the card).
  useEffect(() => {
    setQtyDraft(committedQty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQty]);

  const confirmAdd = () => {
    const trimmed = name.trim();
    if (trimmed) {
      onAddOption(trimmed);
      onChange(trimmed);
    }
    setName("");
    setAdding(false);
  };

  if (adding) {
    return (
      <div style={styles.typeAddRow}>
        <input
          style={styles.addTypeInput}
          placeholder="Nama jenis baru…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirmAdd()}
          autoFocus
        />
        <button style={styles.addTypeConfirmBtn} onClick={confirmAdd} title="Tambahkan">
          <Check size={13} />
        </button>
        <button
          style={styles.addTypeCancelBtn}
          onClick={() => {
            setName("");
            setAdding(false);
          }}
          title="Batal"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div style={styles.typeSelectRow}>
      <select
        style={styles.typeSelect}
        value={value || ""}
        onChange={(e) => {
          if (e.target.value === "__add_new__") {
            setAdding(true);
            return;
          }
          onChange(e.target.value);
        }}
      >
        <option value="">Pilih jenis kartu…</option>
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value="__add_new__">+ Tambah jenis baru…</option>
      </select>
      {onQtyChange && (
        <input
          type="number"
          min={1}
          style={styles.typeQtyInput}
          value={qtyDraft === "" ? "" : qtyDraft}
          placeholder="1"
          title="Jumlah (input manual, tidak terakumulasi dengan kartu lain)"
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              setQtyDraft("");
              return;
            }
            const n = parseInt(raw, 10);
            setQtyDraft(Number.isFinite(n) && n > 0 ? n : 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={() => {
            // Left blank -> silently default to 1, exactly as if the person had typed it.
            const finalVal = qtyDraft === "" ? 1 : qtyDraft;
            if (finalVal === committedQty) {
              setQtyDraft(finalVal);
              return;
            }
            // Editing an already-saved quantity needs an explicit
            // simpan/batal confirmation. New (not-yet-created) cards don't
            // get one — nothing's saved yet, so onRequestConfirm is omitted
            // for that draft row.
            if (onRequestConfirm) {
              onRequestConfirm(`Simpan jumlah baru "${finalVal}" untuk kartu ini?`, () => onQtyChange(finalVal), {
                confirmLabel: "Simpan",
                onCancel: () => setQtyDraft(committedQty),
              });
            } else {
              onQtyChange(finalVal);
            }
          }}
        />
      )}
    </div>
  );
}

function CreatedDateEditor({ createdAt, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(() => toDateInputValue(createdAt));

  useEffect(() => {
    setDraftDate(toDateInputValue(createdAt));
  }, [createdAt]);

  const save = () => {
    if (draftDate) {
      const newTs = resolveManualCreatedAt(draftDate);
      if (newTs !== createdAt) onChange(newTs);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraftDate(toDateInputValue(createdAt));
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={styles.startDateRow}>
        <input
          type="date"
          style={styles.startDateInput}
          value={draftDate}
          autoFocus
          onChange={(e) => setDraftDate(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button style={styles.addTypeConfirmBtn} onClick={save} title="Simpan tanggal">
          <Check size={12} />
        </button>
        <button style={styles.addTypeCancelBtn} onClick={cancel} title="Batal">
          <X size={12} />
        </button>
        <span style={styles.durationHint}>{startDateHint(draftDate)}</span>
      </div>
    );
  }

  return (
    <div style={styles.createdDateLabel}>
      <Calendar size={11} />
      <span>{formatCreatedDate(createdAt)}</span>
      <button style={styles.dateEditBtn} onClick={() => setEditing(true)} title="Ubah tanggal mulai (boleh tanggal lampau atau mendatang)">
        <Pencil size={11} />
      </button>
    </div>
  );
}

// Inline card-title editor: click the pencil to rename an existing card
// without losing its checked state, duration, or other fields. Enter/blur
// saves, Escape reverts.
function CardTitle({ text, checked, priority, onToggleCheck, onSave, onRequestDelete, onTogglePriority }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  const save = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== text) onSave(trimmed);
    else setDraft(text);
  };

  const cancel = () => {
    setDraft(text);
    setEditing(false);
  };

  return (
    <div style={styles.cardTop}>
      {editing ? (
        <input
          style={styles.cardTitleInput}
          value={draft}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") cancel();
          }}
          onBlur={save}
        />
      ) : (
        <label style={styles.checkLabel}>
          <input type="checkbox" checked={!!checked} onChange={onToggleCheck} style={styles.checkbox} />
          <span style={{ ...styles.cardText, ...(checked ? styles.cardTextDone : {}) }}>{text}</span>
        </label>
      )}
      <div style={styles.cardTopActions}>
        <button
          style={{ ...styles.cardPriorityBtn, ...(priority ? styles.cardPriorityBtnActive : {}) }}
          onClick={onTogglePriority}
          title={priority ? "Batalkan prioritas tinggi" : "Tandai prioritas tinggi — dipin ke atas"}
          aria-label={priority ? "Batalkan prioritas tinggi" : "Tandai prioritas tinggi"}
        >
          <Flag size={13} fill={priority ? "#EF4444" : "none"} />
        </button>
        {!editing && (
          <button style={styles.cardEditBtn} onClick={() => setEditing(true)} title="Ubah nama kartu" aria-label="Ubah nama kartu">
            <Pencil size={13} />
          </button>
        )}
        <button style={styles.cardDelete} onClick={onRequestDelete} title="Hapus kartu" aria-label="Hapus kartu">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function BoardView({ board, members, cardTypes, onAddCardType, isAdmin, currentUsername, onRename, onAddColumn, onRenameColumn, onDeleteColumn, onAddCard, onDeleteCard, onMoveCard, onUpdateCard, onToggleCheck, onTogglePriority, onRequestConfirm, dragCard, setDragCard }) {
  const [drafts, setDrafts] = useState({});
  const [dragOverCol, setDragOverCol] = useState(null);
  // Papan bulanan: setiap bulan punya kolom & kartunya sendiri. Dibuka
  // default ke bulan berjalan; berpindah bulan hanya mengganti tampilan,
  // bulan lain tetap tersimpan persis seperti terakhir ditinggalkan.
  const [viewMonth, setViewMonth] = useState(() => currentMonthKey());
  const monthBoard = getMonthBoard(board, viewMonth);
  const thisMonthKey = currentMonthKey();
  const { year: viewYear } = parseMonthKey(viewMonth);

  const draft = (colId) => drafts[colId] || { text: "", amount: "", unit: "hari", involvedMembers: [], cardType: "", qty: 1, startDate: "" };
  const setDraft = (colId, patch) => setDrafts((d) => ({ ...d, [colId]: { ...draft(colId), ...patch } }));
  // Kartu baru selalu masuk ke kolom pertama ("Belum Dikerjakan") — komposernya
  // sendiri sekarang berdiri di luar kolom, jadi perlu id kolom pertama secara eksplisit.
  const firstColId = monthBoard.columns[0] && monthBoard.columns[0].id;

  const toggleDraftMember = (colId, name) => {
    const dr = draft(colId);
    const has = dr.involvedMembers.includes(name);
    setDraft(colId, { involvedMembers: has ? dr.involvedMembers.filter((m) => m !== name) : [...dr.involvedMembers, name] });
  };

  const submit = (colId) => {
    const dr = draft(colId);
    if (!dr.text.trim() && !dr.cardType) return; // need at least a name or a chosen type to create something
    // Default duration is 1 day when the person doesn't set one explicitly.
    const duration = dr.amount ? { amount: Number(dr.amount), unit: dr.unit } : { amount: 1, unit: "hari" };
    // Only fall back to the creator's own username when nobody was
    // explicitly picked from the chip list — if members were chosen
    // (by an admin), that explicit choice is respected as-is.
    const involvedMembers = dr.involvedMembers.length > 0 ? dr.involvedMembers : currentUsername ? [currentUsername] : [];
    const createdAt = resolveManualCreatedAt(dr.startDate);
    onAddCard(board.id, viewMonth, colId, dr.text, duration, involvedMembers, dr.cardType, dr.qty, createdAt);
    setDrafts((d) => ({ ...d, [colId]: { text: "", amount: "", unit: "hari", involvedMembers: [], cardType: "", qty: 1, startDate: "" } }));
  };

  const toggleCardMember = (boardId, cid, currentList, name) => {
    const has = currentList.includes(name);
    onUpdateCard(boardId, viewMonth, cid, { involvedMembers: has ? currentList.filter((m) => m !== name) : [...currentList, name] });
  };

  return (
    <div style={styles.boardWrap}>
      <input className="rw-board-title" style={styles.boardTitle} value={board.name} onChange={(e) => onRename(board.id, e.target.value)} />

      <div style={styles.monthTabRow}>
        <button style={styles.monthNavBtn} onClick={() => setViewMonth((m) => shiftMonthKey(m, -1))} title="Bulan sebelumnya" aria-label="Bulan sebelumnya">
          ‹
        </button>
        <div className="rw-month-scroll" style={styles.monthTabScroll}>
          {MONTH_NAMES_ID.map((label, idx) => {
            const key = monthKeyOf(viewYear, idx);
            const isActive = key === viewMonth;
            const isRealCurrent = key === thisMonthKey;
            return (
              <button
                key={key}
                style={{ ...styles.monthTab, ...(isActive ? styles.monthTabActive : {}) }}
                onClick={() => setViewMonth(key)}
                title={isRealCurrent ? `${label} ${viewYear} · bulan berjalan` : `${label} ${viewYear}`}
              >
                {label.slice(0, 3)}
                {isRealCurrent && <span style={styles.monthTabDot} />}
              </button>
            );
          })}
        </div>
        <button style={styles.monthNavBtn} onClick={() => setViewMonth((m) => shiftMonthKey(m, 1))} title="Bulan berikutnya" aria-label="Bulan berikutnya">
          ›
        </button>
        <span style={styles.monthTabLabel}>{monthKeyLabel(viewMonth)}</span>
      </div>

      {firstColId && (
        <div style={styles.composerPanel}>
          <div style={styles.composerHead}>Tambah kartu ke "Belum Dikerjakan"</div>
          <input style={styles.addCardInput} placeholder="Tulis kartu baru…" value={draft(firstColId).text} onChange={(e) => setDraft(firstColId, { text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit(firstColId)} />

          <div style={styles.startDateRow}>
            <input
              type="date"
              style={styles.startDateInput}
              value={draft(firstColId).startDate}
              onChange={(e) => setDraft(firstColId, { startDate: e.target.value })}
              title="Tanggal mulai manual — boleh tanggal yang sudah lewat atau tanggal mendatang"
            />
            <span style={styles.durationHint}>{startDateHint(draft(firstColId).startDate)}</span>
          </div>

          <TypeSelect
            value={draft(firstColId).cardType}
            options={cardTypes}
            qty={draft(firstColId).qty}
            onChange={(v) => setDraft(firstColId, { cardType: v })}
            onQtyChange={(v) => setDraft(firstColId, { qty: v })}
            onAddOption={onAddCardType}
          />

          {isAdmin ? (
            <div>
              <div style={styles.involvedLabel}>Tim terlibat</div>
              <div style={styles.chipRow}>
                {members.map((m) => {
                  const active = draft(firstColId).involvedMembers.includes(m);
                  return (
                    <button key={m} style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }} onClick={() => toggleDraftMember(firstColId, m)}>
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={styles.assigneeReadonlyHint}>Kamu otomatis tercatat sebagai tim terlibat karena membuat kartu ini. Admin bisa menambah anggota lain.</div>
          )}

          <div className="rw-duration-row" style={styles.durationRow}>
            <input style={styles.durationInput} type="number" min="1" placeholder="1" value={draft(firstColId).amount} onChange={(e) => setDraft(firstColId, { amount: e.target.value })} />
            <select style={styles.durationSelect} value={draft(firstColId).unit} onChange={(e) => setDraft(firstColId, { unit: e.target.value })}>
              <option value="menit">Menit</option>
              <option value="jam">Jam</option>
              <option value="hari">Hari</option>
            </select>
            <span style={styles.durationHint}>kosongkan = 1 hari</span>
            <button style={styles.submitCardBtn} onClick={() => submit(firstColId)} title="Tambahkan kartu" aria-label="Tambahkan kartu">
              <Plus size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="rw-columns-row" style={styles.columnsRow}>
        {monthBoard.columns.map((col, colIndex) => (
          <div
            key={col.id}
            className="rw-column"
            style={{ ...styles.column, borderTop: `3px solid ${columnDotColor(colIndex)}`, ...(dragOverCol === col.id ? styles.columnDragOver : {}) }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col.id);
            }}
            onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCol(null);
              if (dragCard) {
                onMoveCard(board.id, viewMonth, dragCard.colId, col.id, dragCard.cardId);
                setDragCard(null);
              }
            }}
          >
            <div style={styles.columnHead}>
              <span style={{ ...styles.columnDot, background: columnDotColor(colIndex) }} />
              <input style={styles.columnTitle} value={col.name} onChange={(e) => onRenameColumn(board.id, viewMonth, col.id, e.target.value)} />
              <span style={{ ...styles.columnCountBadge, color: columnDotColor(colIndex) }}>{col.cardIds.length}</span>
              <button
                style={styles.columnDelete}
                onClick={() => {
                  onRequestConfirm(`Hapus kolom "${col.name}" beserta isinya?`, () => onDeleteColumn(board.id, viewMonth, col.id));
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="rw-card-stack" style={styles.cardStack}>
              {col.cardIds.map((cid) => {
                const card = monthBoard.cards[cid];
                if (!card) return null;
                const info = getDurationInfo(card);
                const involved = card.involvedMembers || [];
                const accentColor = info ? (info.status === "overdue" ? "#EF4444" : info.status === "due_soon" ? "#F59E0B" : "#10B981") : "transparent";
                return (
                  <div
                    key={cid}
                    draggable
                    onDragStart={() => setDragCard({ cardId: cid, colId: col.id })}
                    onDragEnd={() => setDragCard(null)}
                    className="rw-card"
                    style={{
                      ...styles.card,
                      borderLeft: `3px solid ${card.priority ? "#EF4444" : accentColor}`,
                      ...(card.priority ? styles.cardPriority : {}),
                    }}
                  >
                    <CardTitle
                      text={card.text}
                      checked={card.checked}
                      priority={card.priority}
                      onToggleCheck={() => onToggleCheck(board.id, viewMonth, col.id, cid)}
                      onTogglePriority={() => onTogglePriority(board.id, viewMonth, col.id, cid)}
                      onSave={(newText) => onUpdateCard(board.id, viewMonth, cid, { text: newText })}
                      onRequestDelete={() => onRequestConfirm("Hapus kartu ini?", () => onDeleteCard(board.id, viewMonth, cid))}
                    />

                    <CreatedDateEditor createdAt={card.createdAt} onChange={(ts) => onUpdateCard(board.id, viewMonth, cid, { createdAt: ts })} />

                    <TypeSelect
                      value={card.cardType}
                      options={cardTypes}
                      qty={card.qty}
                      onChange={(v) => onUpdateCard(board.id, viewMonth, cid, { cardType: v })}
                      onQtyChange={(v) => onUpdateCard(board.id, viewMonth, cid, { qty: v === "" ? "" : Number(v) })}
                      onAddOption={onAddCardType}
                      onRequestConfirm={onRequestConfirm}
                    />

                    <div style={styles.involvedLabel}>Tim terlibat</div>
                    {isAdmin ? (
                      <div style={styles.chipRow}>
                        {members.map((m) => {
                          const active = involved.includes(m);
                          return (
                            <button key={m} style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }} onClick={() => toggleCardMember(board.id, cid, involved, m)}>
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={styles.chipRow}>
                        {involved.length ? (
                          involved.map((m) => (
                            <span key={m} style={{ ...styles.chip, ...styles.chipActive, cursor: "default" }}>
                              {m}
                            </span>
                          ))
                        ) : (
                          <span style={styles.assigneeReadonly}>Belum ada yang terlibat</span>
                        )}
                      </div>
                    )}

                    {info && <span style={{ ...styles.durationPill, ...(info.status === "overdue" ? styles.durationOverdue : {}), ...(info.status === "due_soon" ? styles.durationDueSoon : {}) }}>⏱ {info.text}</span>}
                    {!info && card.duration && <span style={styles.durationPill}>⏱ Menunggu dimulai</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <button style={styles.addColumnBtn} onClick={() => onAddColumn(board.id, viewMonth)}>
          + Kolom
        </button>
      </div>
    </div>
  );
}

function NoteView({ note, onUpdate }) {
  return (
    <div style={styles.noteWrap}>
      <input style={styles.noteTitle} value={note.title} onChange={(e) => onUpdate(note.id, { title: e.target.value })} placeholder="Judul catatan" />
      <div style={styles.noteMeta}>Diperbarui {new Date(note.updatedAt).toLocaleString("id-ID")}</div>
      <textarea style={styles.noteBody} value={note.content} onChange={(e) => onUpdate(note.id, { content: e.target.value })} placeholder="Mulai menulis di sini…" />
    </div>
  );
}

// Aggregates one month's data across every board into: overall
// done/inProgress/todo counts, per-jenis-kartu totals, and per-anggota
// counts (kartu sedang dikerjakan & selesai, mengikuti filter jenis kartu).
function computeMonthInsight(wsData, monthKey, typeFilter) {
  let done = 0;
  let inProgress = 0;
  let todo = 0;
  const typeStats = {};
  const memberStats = {};

  wsData.boardOrder.forEach((bid) => {
    const board = wsData.boards[bid];
    const mb = board && board.monthly ? board.monthly[monthKey] : null;
    if (!mb) return;
    mb.columns.forEach((col, idx) => {
      col.cardIds.forEach((cid) => {
        const card = mb.cards[cid];
        if (!card) return;
        if (idx === 0) todo += 1;
        else if (idx === 1) inProgress += 1;
        else if (idx === 2) done += 1;

        const type = card.cardType || "Belum ditentukan";
        if (!typeStats[type]) typeStats[type] = { todo: 0, inProgress: 0, done: 0, total: 0 };
        typeStats[type].total += 1;
        if (idx === 0) typeStats[type].todo += 1;
        else if (idx === 1) typeStats[type].inProgress += 1;
        else if (idx === 2) typeStats[type].done += 1;

        if (idx === 1 || idx === 2) {
          if (typeFilter !== "__all__" && type !== typeFilter) return;
          const involved = card.involvedMembers && card.involvedMembers.length ? card.involvedMembers : [];
          involved.forEach((name) => {
            if (!memberStats[name]) memberStats[name] = { done: 0, inProgress: 0 };
            if (idx === 2) memberStats[name].done += 1;
            else memberStats[name].inProgress += 1;
          });
        }
      });
    });
  });

  return { done, inProgress, todo, typeStats, memberStats };
}

// Total kartu for one metric ("__all__" = seluruh jenis, or a specific jenis
// kartu) within one month, across every board — this is what the comparison
// chart plots per month.
function countMonthMetric(wsData, monthKey, metric) {
  let count = 0;
  wsData.boardOrder.forEach((bid) => {
    const board = wsData.boards[bid];
    const mb = board && board.monthly ? board.monthly[monthKey] : null;
    if (!mb) return;
    mb.columns.forEach((col) => {
      col.cardIds.forEach((cid) => {
        const card = mb.cards[cid];
        if (!card) return;
        const type = card.cardType || "Belum ditentukan";
        if (metric === "__all__" || type === metric) count += 1;
      });
    });
  });
  return count;
}

// Every month key with at least some data anywhere in this workspace,
// sorted chronologically, always including the current real month even
// when it's still empty (so the picker never starts out blank).
function listWorkspaceMonths(wsData) {
  const keys = new Set([currentMonthKey()]);
  wsData.boardOrder.forEach((bid) => {
    const board = wsData.boards[bid];
    if (!board || !board.monthly) return;
    Object.keys(board.monthly).forEach((mk) => keys.add(mk));
  });
  return Array.from(keys).sort();
}

// Simple vertical bar chart (plain divs, no chart library) comparing one
// metric across several months.
function MonthCompareChart({ months, values }) {
  const max = Math.max(1, ...values);
  return (
    <div style={styles.compareChart}>
      {months.map((mk, i) => {
        const v = values[i];
        const pct = Math.max(4, Math.round((v / max) * 100));
        return (
          <div key={mk} style={styles.compareBarCol}>
            <div style={styles.compareBarValue}>{v}</div>
            <div style={styles.compareBarTrack}>
              <div style={{ ...styles.compareBarFill, height: `${pct}%` }} />
            </div>
            <div style={styles.compareBarLabel}>{monthKeyLabel(mk)}</div>
          </div>
        );
      })}
    </div>
  );
}

function InsightView({ wsData }) {
  const monthsWithAny = listWorkspaceMonths(wsData);
  const [mode, setMode] = useState("bulan"); // "bulan" | "bandingkan"
  const [month, setMonth] = useState(() => currentMonthKey());
  const [typeFilter, setTypeFilter] = useState("__all__");
  const [compareMonths, setCompareMonths] = useState(() => {
    const idx = monthsWithAny.indexOf(currentMonthKey());
    const start = Math.max(0, idx - 2);
    return monthsWithAny.slice(start, idx + 1);
  });
  const [compareMetric, setCompareMetric] = useState("__all__");

  const { done, inProgress, todo, typeStats, memberStats } = computeMonthInsight(wsData, month, typeFilter);
  const total = done + inProgress;
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const inProgressPct = total ? 100 - donePct : 0;
  const boardCount = wsData.boardOrder.length;

  const typeOptions = Array.from(new Set([...(wsData.cardTypes || []), ...Object.keys(typeStats)]));
  const totalKartuKeseluruhan = Object.values(typeStats).reduce((s, v) => s + v.total, 0);
  const selectedTypeStats = typeFilter === "__all__" ? null : typeStats[typeFilter] || { todo: 0, inProgress: 0, done: 0, total: 0 };

  const memberRows = Object.entries(memberStats)
    .map(([name, v]) => ({ name, ...v, total: v.done + v.inProgress }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const summaryText = (() => {
    if (total === 0 && todo === 0) return null;
    if (total === 0) {
      return `Ada ${todo} pekerjaan yang belum mulai dikerjakan di ${boardCount} papan pada ${monthKeyLabel(month)}. Belum ada yang berjalan atau selesai.`;
    }
    let mood;
    if (donePct >= 75) mood = "Capaian kerja sangat baik — sebagian besar pekerjaan sudah tuntas.";
    else if (donePct >= 40) mood = "Progres berjalan cukup seimbang antara yang selesai dan yang masih berjalan.";
    else mood = "Sebagian besar pekerjaan masih dalam proses pengerjaan.";
    return `Dari total ${total} pekerjaan di ${boardCount} papan pada ${monthKeyLabel(month)}, tim telah menyelesaikan ${done} pekerjaan (${donePct}%), sementara ${inProgress} pekerjaan (${inProgressPct}%) masih dalam pengerjaan.${todo ? ` Ada juga ${todo} pekerjaan lain yang belum dimulai.` : ""} ${mood}`;
  })();

  const toggleCompareMonth = (mk) => {
    setCompareMonths((list) => (list.includes(mk) ? list.filter((m) => m !== mk) : [...list, mk].sort()));
  };

  return (
    <div style={styles.insightWrap}>
      <div style={styles.insightHeaderRow}>
        <h2 style={styles.insightTitle}>Insight</h2>
        <div style={styles.insightModeToggle}>
          <button style={{ ...styles.insightModeBtn, ...(mode === "bulan" ? styles.insightModeBtnActive : {}) }} onClick={() => setMode("bulan")}>
            Rekap bulanan
          </button>
          <button style={{ ...styles.insightModeBtn, ...(mode === "bandingkan" ? styles.insightModeBtnActive : {}) }} onClick={() => setMode("bandingkan")}>
            Bandingkan bulan
          </button>
        </div>
      </div>

      {mode === "bulan" ? (
        <>
          <div style={styles.insightSubtitle}>
            Rekap pekerjaan sedang dikerjakan dan selesai, dari seluruh papan di ruang ini, untuk bulan yang dipilih.
          </div>

          <div style={styles.monthPickerRow}>
            <button style={styles.monthNavBtn} onClick={() => setMonth((m) => shiftMonthKey(m, -1))} title="Bulan sebelumnya">
              ‹
            </button>
            <select style={styles.insightTypeSelect} value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthsWithAny.map((mk) => (
                <option key={mk} value={mk}>
                  {monthKeyLabel(mk)}
                </option>
              ))}
            </select>
            <button style={styles.monthNavBtn} onClick={() => setMonth((m) => shiftMonthKey(m, 1))} title="Bulan berikutnya">
              ›
            </button>
          </div>

          {total === 0 ? (
            <div style={styles.insightEmpty}>{summaryText || `Belum ada pekerjaan yang sedang dikerjakan atau selesai pada ${monthKeyLabel(month)}.`}</div>
          ) : (
            <>
              <div style={styles.insightBody}>
                <div
                  style={{
                    ...styles.donutOuter,
                    background: `conic-gradient(#10B981 0 ${donePct}%, #3B82F6 ${donePct}% 100%)`,
                  }}
                >
                  <div style={styles.donutInner}>
                    <div style={styles.donutTotal}>{total}</div>
                    <div style={styles.donutTotalLabel}>Total kartu</div>
                  </div>
                </div>

                <div style={styles.insightStats}>
                  <div style={styles.statCard}>
                    <div style={{ ...styles.statDot, background: "#10B981" }} />
                    <div>
                      <div style={styles.statNumber}>{done}</div>
                      <div style={styles.statLabel}>Selesai ({donePct}%)</div>
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={{ ...styles.statDot, background: "#3B82F6" }} />
                    <div>
                      <div style={styles.statNumber}>{inProgress}</div>
                      <div style={styles.statLabel}>Sedang Dikerjakan ({inProgressPct}%)</div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={styles.insightSummaryCard}>
                <div style={styles.insightSummaryLabel}>Resume Capaian Kerja</div>
                <div style={styles.insightSummaryText}>{summaryText}</div>
              </div>
            </>
          )}

          <div style={styles.insightSectionDivider} />

          <div style={styles.insightSectionHeader}>
            <h3 style={styles.insightSectionTitle}>
              <Tags size={16} /> Total kartu per jenis
            </h3>
            <select style={styles.insightTypeSelect} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="__all__">Semua jenis ({totalKartuKeseluruhan})</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t} ({typeStats[t] ? typeStats[t].total : 0})
                </option>
              ))}
            </select>
          </div>

          {typeOptions.length === 0 ? (
            <div style={styles.insightEmpty}>Belum ada kartu dengan jenis tertentu pada bulan ini.</div>
          ) : typeFilter === "__all__" ? (
            <div style={styles.insightTypeGrid}>
              {typeOptions.map((t) => (
                <div key={t} style={styles.insightTypeCard}>
                  <div style={styles.insightTypeCardCount}>{typeStats[t] ? typeStats[t].total : 0}</div>
                  <div style={styles.insightTypeCardName}>{t}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.insightTypeGrid}>
              <div style={{ ...styles.insightTypeCard, ...styles.insightTypeCardHighlight }}>
                <div style={styles.insightTypeCardCount}>{selectedTypeStats.total}</div>
                <div style={styles.insightTypeCardName}>Total “{typeFilter}”</div>
              </div>
              <div style={styles.insightTypeCard}>
                <div style={styles.insightTypeCardCount}>{selectedTypeStats.done}</div>
                <div style={styles.insightTypeCardName}>Selesai</div>
              </div>
              <div style={styles.insightTypeCard}>
                <div style={styles.insightTypeCardCount}>{selectedTypeStats.inProgress}</div>
                <div style={styles.insightTypeCardName}>Sedang dikerjakan</div>
              </div>
              <div style={styles.insightTypeCard}>
                <div style={styles.insightTypeCardCount}>{selectedTypeStats.todo}</div>
                <div style={styles.insightTypeCardName}>Belum dikerjakan</div>
              </div>
            </div>
          )}

          <div style={styles.insightSectionDivider} />

          <div style={styles.insightSectionHeader}>
            <h3 style={styles.insightSectionTitle}>
              <Users size={16} /> Progres per tim/anggota
            </h3>
          </div>
          <div style={styles.insightSubtitleSmall}>
            {typeFilter === "__all__" ? "Seluruh jenis kartu" : `Jenis kartu: ${typeFilter}`} · {monthKeyLabel(month)} · kartu sedang dikerjakan & selesai
          </div>

          {memberRows.length === 0 ? (
            <div style={styles.insightEmpty}>Belum ada anggota yang tercatat pada kartu berjalan atau selesai bulan ini.</div>
          ) : (
            <div style={styles.memberStatsTable}>
              {memberRows.map((m) => {
                const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
                return (
                  <div key={m.name} style={styles.memberStatsRow}>
                    <div style={styles.memberStatsName}>{m.name}</div>
                    <div style={styles.memberStatsBarTrack}>
                      <div style={{ ...styles.memberStatsBarFill, width: `${pct}%` }} />
                    </div>
                    <div style={styles.memberStatsNums}>
                      <span style={styles.memberStatsDone}>{m.done} selesai</span>
                      <span style={styles.memberStatsProgress}>{m.inProgress} dikerjakan</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={styles.insightSubtitle}>Bandingkan jumlah kartu antar bulan — pilih dua bulan atau lebih, lalu pilih apa yang ingin dilihat (total kartu, atau satu jenis kartu tertentu).</div>

          <div style={styles.compareControls}>
            <div style={styles.compareMonthPicker}>
              {monthsWithAny.map((mk) => {
                const active = compareMonths.includes(mk);
                return (
                  <button key={mk} style={{ ...styles.compareMonthChip, ...(active ? styles.compareMonthChipActive : {}) }} onClick={() => toggleCompareMonth(mk)}>
                    {monthKeyLabel(mk)}
                  </button>
                );
              })}
            </div>
            <select style={styles.insightTypeSelect} value={compareMetric} onChange={(e) => setCompareMetric(e.target.value)}>
              <option value="__all__">Total kartu (semua jenis)</option>
              {(wsData.cardTypes || []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {compareMonths.length < 2 ? (
            <div style={styles.insightEmpty}>Pilih minimal 2 bulan untuk dibandingkan.</div>
          ) : (
            <>
              <MonthCompareChart months={compareMonths} values={compareMonths.map((mk) => countMonthMetric(wsData, mk, compareMetric))} />
              <div style={styles.compareSummaryText}>
                {compareMetric === "__all__" ? "Total kartu" : `Jenis kartu “${compareMetric}”`} per bulan:{" "}
                {compareMonths.map((mk) => `${monthKeyLabel(mk)} (${countMonthMetric(wsData, mk, compareMetric)})`).join(", ")}.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}


const WEEKDAY_LABELS_ID = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

// Kalender Annual Plan: satu bulan besar per layar, dengan pemilih bulan dan
// tahun sehingga rencana bisa dibuat untuk tahun-tahun mendatang. Klik
// tanggal untuk menambah kartu — bentuknya sama seperti menambah kartu di
// papan (jenis, jumlah, tim terlibat, durasi, kolom tujuan), dan otomatis
// tersinkron ke papan yang dipilih pada bulan sesuai tanggalnya.
function CalendarView({ wsData, currentUsername, members, isAdmin, cardTypes, onAddCardType, onAddNote, onDeleteNote, onToggleNote, onRequestConfirm }) {
  const boardOrder = wsData.boardOrder || [];
  const [viewMonth, setViewMonth] = useState(() => currentMonthKey());
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(Date.now()));
  const [selectedBoardId, setSelectedBoardId] = useState(boardOrder[0] || "");
  const [draft, setDraft] = useState({ text: "", cardType: "", qty: 1, colId: "", involvedMembers: [], amount: "", unit: "hari" });

  useEffect(() => {
    if ((!selectedBoardId || !wsData.boards[selectedBoardId]) && boardOrder.length) setSelectedBoardId(boardOrder[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardOrder.join(",")]);

  const { year, monthIndex0 } = parseMonthKey(viewMonth);
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  const firstWeekdayMon0 = (new Date(year, monthIndex0, 1).getDay() + 6) % 7; // Senin = 0
  const nowYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 8 }, (_, i) => nowYear - 1 + i); // tahun lalu s/d 6 tahun ke depan

  const dateStrFor = (d) => `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const notesByDate = wsData.calendarNotes || {};

  const cells = [];
  for (let i = 0; i < firstWeekdayMon0; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedNotes = notesByDate[selectedDate] || [];
  const todayStr = toDateInputValue(Date.now());

  // Kolom tujuan mengikuti bulan dari tanggal yang dipilih (bukan bulan yang
  // sedang dilihat) — inilah bulan tempat kartu akan benar-benar dibuat.
  const selectedMonthKey = monthKeyFromTimestamp(dateInputToTimestamp(selectedDate));
  const selectedBoard = selectedBoardId ? wsData.boards[selectedBoardId] : null;
  const formMonthBoard = selectedBoard ? getMonthBoard(selectedBoard, selectedMonthKey) : null;
  const formColumns = formMonthBoard ? formMonthBoard.columns : [];
  const formColumnIds = formColumns.map((c) => c.id).join(",");

  useEffect(() => {
    setDraft((d) => {
      if (formColumns.some((c) => c.id === d.colId)) return d;
      return { ...d, colId: formColumns[0] ? formColumns[0].id : "" };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoardId, selectedMonthKey, formColumnIds]);

  const resolveNote = (note) => {
    const board = wsData.boards[note.boardId];
    if (!board) return null;
    const loc = findCardLocation(board, note.monthKey, note.cardId);
    return loc ? { board, colId: loc.colId, card: loc.card } : null;
  };

  const toggleDraftMember = (name) => {
    setDraft((d) => {
      const has = d.involvedMembers.includes(name);
      return { ...d, involvedMembers: has ? d.involvedMembers.filter((m) => m !== name) : [...d.involvedMembers, name] };
    });
  };

  const submitCard = () => {
    if (!selectedBoardId || !draft.colId) return;
    if (!draft.text.trim() && !draft.cardType) return;
    const duration = draft.amount ? { amount: Number(draft.amount), unit: draft.unit } : { amount: 1, unit: "hari" };
    const involvedMembers = draft.involvedMembers.length > 0 ? draft.involvedMembers : currentUsername ? [currentUsername] : [];
    onAddNote(selectedDate, selectedBoardId, draft.colId, draft.text, draft.cardType, duration, involvedMembers, draft.qty);
    setDraft((d) => ({ ...d, text: "", cardType: "", qty: 1, involvedMembers: [], amount: "", unit: "hari" }));
  };

  return (
    <div style={styles.calendarWrap}>
      <h2 style={styles.insightTitle}>Kalender</h2>
      <div style={styles.insightSubtitle}>Rencana tahunan — pilih bulan dan tahun, lalu klik tanggal untuk menambahkan kartu. Kartu otomatis tersinkron dengan papan yang dipilih, di bulan sesuai tanggalnya.</div>

      <div style={styles.calendarNavRow}>
        <button style={styles.monthNavBtn} onClick={() => setViewMonth((m) => shiftMonthKey(m, -1))} title="Bulan sebelumnya" aria-label="Bulan sebelumnya">
          ‹
        </button>
        <select style={styles.insightTypeSelect} value={monthIndex0} onChange={(e) => setViewMonth(monthKeyOf(year, Number(e.target.value)))}>
          {MONTH_NAMES_ID.map((label, idx) => (
            <option key={idx} value={idx}>
              {label}
            </option>
          ))}
        </select>
        <select style={styles.insightTypeSelect} value={year} onChange={(e) => setViewMonth(monthKeyOf(Number(e.target.value), monthIndex0))}>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button style={styles.monthNavBtn} onClick={() => setViewMonth((m) => shiftMonthKey(m, 1))} title="Bulan berikutnya" aria-label="Bulan berikutnya">
          ›
        </button>
      </div>

      <div style={styles.calendarGrid}>
        {WEEKDAY_LABELS_ID.map((w) => (
          <div key={w} style={styles.calendarWeekdayCell}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`blank${i}`} style={styles.calendarEmptyCell} />;
          const dateStr = dateStrFor(d);
          const notes = notesByDate[dateStr] || [];
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === todayStr;
          return (
            <div
              key={dateStr}
              style={{ ...styles.calendarDayCell, ...(isToday ? styles.calendarDayCellToday : {}), ...(isSelected ? styles.calendarDayCellSelected : {}) }}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span style={styles.calendarDayNum}>{d}</span>
              {notes.length > 0 && <span style={styles.calendarDayBadge}>{notes.length}</span>}
            </div>
          );
        })}
      </div>

      <div style={styles.calendarPanel}>
        <div style={styles.calendarPanelTitle}>{formatCreatedDate(dateInputToTimestamp(selectedDate))}</div>

        {selectedNotes.length === 0 ? (
          <div style={styles.insightEmpty}>Belum ada kartu pada tanggal ini.</div>
        ) : (
          <div style={styles.calendarNoteList}>
            {selectedNotes.map((note) => {
              const resolved = resolveNote(note);
              if (!resolved) return null;
              return (
                <div key={note.id} style={styles.calendarNoteItem}>
                  <label style={styles.checkLabel}>
                    <input type="checkbox" checked={!!resolved.card.checked} onChange={() => onToggleNote(note)} style={styles.checkbox} />
                    <span style={{ ...styles.cardText, ...(resolved.card.checked ? styles.cardTextDone : {}) }}>{resolved.card.text}</span>
                  </label>
                  <div style={styles.calendarNoteMeta}>
                    {resolved.board.name}
                    {resolved.card.cardType ? ` · ${resolved.card.cardType}` : ""}
                  </div>
                  <button style={styles.cardDelete} onClick={() => onRequestConfirm("Hapus kartu ini?", () => onDeleteNote(selectedDate, note))} title="Hapus kartu" aria-label="Hapus kartu">
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {boardOrder.length === 0 ? (
          <div style={styles.insightSubtitleSmall}>Buat papan terlebih dulu untuk bisa menambahkan kartu dari kalender.</div>
        ) : (
          <div style={styles.calendarAddRow}>
            <div style={styles.calendarAddSelectRow}>
              <select style={styles.insightTypeSelect} value={selectedBoardId} onChange={(e) => setSelectedBoardId(e.target.value)}>
                {boardOrder.map((bid) => (
                  <option key={bid} value={bid}>
                    {wsData.boards[bid]?.name}
                  </option>
                ))}
              </select>
              <select style={styles.insightTypeSelect} value={draft.colId} onChange={(e) => setDraft((d) => ({ ...d, colId: e.target.value }))}>
                {formColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <input
              style={styles.addCardInput}
              placeholder="Tulis kartu baru…"
              value={draft.text}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && submitCard()}
            />

            <TypeSelect
              value={draft.cardType}
              options={cardTypes}
              qty={draft.qty}
              onChange={(v) => setDraft((d) => ({ ...d, cardType: v }))}
              onQtyChange={(v) => setDraft((d) => ({ ...d, qty: v === "" ? "" : Number(v) }))}
              onAddOption={onAddCardType}
            />

            {isAdmin ? (
              <div>
                <div style={styles.involvedLabel}>Tim terlibat</div>
                <div style={styles.chipRow}>
                  {members.map((m) => {
                    const active = draft.involvedMembers.includes(m);
                    return (
                      <button key={m} style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }} onClick={() => toggleDraftMember(m)}>
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={styles.assigneeReadonlyHint}>Kamu otomatis tercatat sebagai tim terlibat karena membuat kartu ini. Admin bisa menambah anggota lain.</div>
            )}

            <div className="rw-duration-row" style={styles.durationRow}>
              <input style={styles.durationInput} type="number" min="1" placeholder="1" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} />
              <select style={styles.durationSelect} value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}>
                <option value="menit">Menit</option>
                <option value="jam">Jam</option>
                <option value="hari">Hari</option>
              </select>
              <span style={styles.durationHint}>kosongkan = 1 hari</span>
              <button style={styles.submitCardBtn} onClick={submitCard} title="Tambahkan kartu" aria-label="Tambahkan kartu">
                <Plus size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


const styles = {
  app: { display: "flex", height: "100vh", minHeight: 640, fontFamily: "'Inter', system-ui, sans-serif", background: "var(--app-bg)", color: "var(--text-primary)", position: "relative" },
  topbar: { position: "fixed", top: 0, left: 0, right: 0, height: 56, background: "#111111", color: "#fff", alignItems: "center", gap: 12, padding: "0 14px", zIndex: 10 },
  hamburgerBtn: { background: "transparent", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", padding: 4 },
  topbarTitle: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  loadingWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--app-bg)", fontFamily: "'Inter', system-ui, sans-serif", color: "var(--text-faint)" },
  loadingText: { fontSize: 14 },

  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#111111", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 },
  authCard: { width: "100%", maxWidth: 340, background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" },
  authBrand: { display: "flex", alignItems: "baseline", gap: 8, justifyContent: "center" },
  authBrandName: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 22, fontWeight: 700, color: "#fff" },
  authSubtitle: { textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: "#9CA0A8", marginBottom: 6 },
  authHint: { fontSize: 12, lineHeight: 1.5, color: "#B7B5AD", background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, padding: "10px 12px" },
  authInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "10px 12px", color: "#fff", fontSize: 14, outline: "none" },
  authError: { color: "#F87171", fontSize: 12.5 },
  authSubmitBtn: { background: "#3B82F6", color: "#fff", border: "none", borderRadius: 7, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 4 },

  sidebar: { width: 250, minWidth: 250, background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)", color: "#D4D4D4", display: "flex", flexDirection: "column", padding: "20px 14px", gap: 16, overflowY: "auto" },
  brandRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  brand: { display: "flex", alignItems: "baseline", gap: 8, padding: "0 6px 6px 6px" },
  brandMark: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 20, color: "#3B82F6" },
  brandName: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 16.5, fontWeight: 700 },
  sidebarCloseBtn: { display: "none", background: "transparent", border: "none", color: "#fff", cursor: "pointer", alignItems: "center" },

  userRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8 },
  userInfo: { display: "flex", flexDirection: "column", gap: 3 },
  userName: { fontSize: 13.5, fontWeight: 500 },
  userRoleBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, padding: "2px 6px", borderRadius: 10, background: "rgba(139,141,147,0.25)", color: "#B7B5AD", width: "fit-content" },
  userRoleBadgeAdmin: { background: "rgba(59,130,246,0.28)", color: "#60A5FA" },
  logoutBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#C9C7BF", borderRadius: 6, padding: 6, cursor: "pointer", display: "flex", alignItems: "center" },

  wsGroup: { display: "flex", flexDirection: "column", gap: 6 },
  wsHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#7D818C", padding: "0 4px" },
  wsHeadLabel: {},
  wsItem: { display: "flex", alignItems: "center", gap: 5, padding: "8px 10px", borderRadius: 5, fontSize: 13.5, cursor: "pointer", color: "#C9C7BF" },
  wsItemActive: { background: "rgba(255,255,255,0.08)", color: "#fff", boxShadow: "inset 3px 0 0 #3B82F6" },
  wsBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, padding: "2px 6px", borderRadius: 10, background: "rgba(139,141,147,0.25)", color: "#B7B5AD", flexShrink: 0 },
  wsBadgeTeam: { background: "rgba(59,130,246,0.28)", color: "#60A5FA" },
  iconBtnSmall: { background: "transparent", border: "none", color: "#34D399", cursor: "pointer", display: "flex", alignItems: "center", padding: 2, flexShrink: 0 },
  addWsPanel: { display: "flex", flexDirection: "column", gap: 8, padding: 10, background: "rgba(255,255,255,0.04)", borderRadius: 8, marginTop: 4 },
  addWsInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "6px 8px", color: "#fff", fontSize: 13, outline: "none" },
  modeToggle: { display: "flex", gap: 6 },
  modeBtn: { flex: 1, padding: "5px 0", fontSize: 11.5, borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#B7B5AD", cursor: "pointer" },
  modeBtnActive: { background: "#3B82F6", color: "#fff", border: "1px solid #3B82F6", fontWeight: 600 },
  modeHint: { fontSize: 10.5, color: "#9CA0A8", lineHeight: 1.4 },
  createWsBtn: { background: "#10B981", color: "#fff", border: "none", borderRadius: 5, padding: "7px 0", fontSize: 12.5, cursor: "pointer", fontWeight: 500 },
  divider: { height: 1, background: "rgba(255,255,255,0.08)", margin: "2px 0" },
  insightNavItem: { display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 6, fontSize: 13.5, cursor: "pointer", color: "#C9C7BF" },
  insightNavItemActive: { background: "rgba(255,255,255,0.08)", color: "#fff", boxShadow: "inset 3px 0 0 #3B82F6" },
  tabGroup: { display: "flex", flexDirection: "column", gap: 6 },
  tab: { display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", padding: "6px 10px", borderRadius: "6px 6px 0 0", fontWeight: 500 },
  tabGold: { background: "rgba(59,130,246,0.18)", color: "#60A5FA" },
  tabMoss: { background: "rgba(16,185,129,0.22)", color: "#34D399" },
  tabAdd: { background: "transparent", border: "1px solid currentColor", color: "inherit", borderRadius: 4, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 },
  list: { display: "flex", flexDirection: "column", gap: 2 },
  listItem: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 5, fontSize: 13.5, cursor: "pointer", color: "#C9C7BF" },
  listItemActiveGold: { background: "rgba(59,130,246,0.28)", color: "#fff", boxShadow: "inset 3px 0 0 #60A5FA" },
  listItemActiveMoss: { background: "rgba(16,185,129,0.32)", color: "#fff", boxShadow: "inset 3px 0 0 #34D399" },
  listItemText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  listItemDelete: { background: "transparent", border: "none", color: "inherit", opacity: 0.7, cursor: "pointer", padding: "0 2px", flexShrink: 0, display: "flex", alignItems: "center" },
  listEmpty: { fontSize: 12, color: "var(--text-muted)", padding: "6px 10px", fontStyle: "italic" },
  main: { flex: 1, overflow: "auto", padding: "28px 32px" },
  teamBanner: { fontSize: 12, color: "#2563EB", background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 6, padding: "8px 12px", marginBottom: 18, display: "inline-block" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "var(--text-faint)", textAlign: "center" },
  emptyTitle: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 22, color: "var(--text-primary)" },
  emptyText: { fontSize: 14, maxWidth: 340 },
  boardWrap: { display: "flex", flexDirection: "column", gap: 14, height: "100%" },
  boardTitle: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontWeight: 600, border: "none", background: "transparent", outline: "none", color: "var(--text-primary)", padding: "2px 0", width: "100%", boxSizing: "border-box" },
  monthTabRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  monthNavBtn: { border: "1px solid var(--card-border)", background: "var(--surface-solid)", color: "var(--text-muted)", borderRadius: 6, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, flexShrink: 0 },
  monthTabScroll: { display: "flex", gap: 4, overflowX: "auto", flex: 1, minWidth: 0 },
  monthTab: { position: "relative", flexShrink: 0, border: "1px solid var(--card-border)", background: "var(--surface-solid)", color: "var(--text-muted)", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer", textTransform: "uppercase" },
  monthTabActive: { background: "#3B82F6", borderColor: "#3B82F6", color: "#fff", fontWeight: 600 },
  monthTabDot: { position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: "#10B981" },
  monthTabLabel: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 14, color: "var(--text-primary)", marginLeft: 4, whiteSpace: "nowrap" },
  columnsRow: { display: "flex", gap: 16, alignItems: "stretch", overflowX: "auto", overflowY: "hidden", paddingBottom: 20, flex: 1, minHeight: 0 },
  column: { background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "10px", padding: 12, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 4px 18px rgba(0,0,0,0.06)", flexShrink: 0, minHeight: 0 },
  columnDragOver: { boxShadow: "0 0 0 2px #3B82F6 inset" },
  columnHead: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  columnDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  columnTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, letterSpacing: 0.8, textTransform: "uppercase", border: "none", background: "transparent", outline: "none", color: "var(--text-muted)", flex: 1, minWidth: 0 },
  columnCountBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  columnDelete: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", display: "flex", alignItems: "center" },
  cardStack: { display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: 2 },
  card: { background: "var(--surface-strong)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 2px 8px rgba(35,38,43,0.06)", cursor: "grab", border: "1px solid var(--card-border)", flexShrink: 0 },
  cardPriority: { background: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.35)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  cardTopActions: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 },
  checkLabel: { display: "flex", alignItems: "flex-start", gap: 7, cursor: "pointer", flex: 1, minWidth: 0 },
  checkbox: { marginTop: 3, cursor: "pointer", flexShrink: 0 },
  cardText: { fontSize: 13.5, lineHeight: 1.4, color: "var(--text-primary)", fontWeight: 700, wordBreak: "break-word" },
  cardTextDone: { textDecoration: "line-through", color: "var(--text-faint)" },
  cardTitleInput: { flex: 1, fontSize: 13.5, lineHeight: 1.4, fontWeight: 700, fontFamily: "'Inter', system-ui, sans-serif", color: "var(--text-primary)", background: "var(--input-bg)", border: "1px solid #3B82F6", borderRadius: 6, padding: "4px 7px", outline: "none", minWidth: 0, boxSizing: "border-box" },
  cardEditBtn: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" },
  cardPriorityBtn: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" },
  cardPriorityBtnActive: { color: "#EF4444" },
  cardDelete: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" },
  typeSelectRow: { display: "flex", alignItems: "center", gap: 6 },
  typeSelect: { border: "1px solid var(--card-border)", borderRadius: 5, background: "transparent", fontSize: 11.5, color: "var(--text-muted)", outline: "none", padding: "4px 6px", fontFamily: "'Inter', system-ui, sans-serif", flex: 1, minWidth: 0, boxSizing: "border-box" },
  typeCountBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: "#fff", background: "#3B82F6", borderRadius: 10, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 },
  typeQtyInput: { width: 40, border: "1px solid var(--card-border)", borderRadius: 5, background: "var(--input-bg)", fontSize: 11.5, color: "var(--text-primary)", outline: "none", padding: "4px 4px", textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0, boxSizing: "border-box" },
  assigneeReadonly: { fontSize: 11.5, color: "var(--text-muted)", padding: "4px 2px", fontStyle: "italic" },
  assigneeReadonlyHint: { fontSize: 10.5, color: "var(--text-faint)", fontStyle: "italic", lineHeight: 1.4 },
  createdDateLabel: { display: "flex", alignItems: "center", gap: 5, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--text-faint)" },
  dateEditBtn: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", display: "flex", alignItems: "center", padding: 0, marginLeft: 2 },
  involvedLabel: { fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 5 },
  chip: { border: "1px solid var(--card-border)", background: "var(--surface-strong)", color: "var(--text-muted)", borderRadius: 12, padding: "3px 9px", fontSize: 10.5, cursor: "pointer" },
  chipActive: { background: "#3B82F6", borderColor: "#3B82F6", color: "#fff" },
  typeAddRow: { display: "flex", gap: 6 },
  addTypeInput: { flex: 1, border: "1px dashed var(--input-border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, outline: "none", boxSizing: "border-box", color: "var(--text-primary)", background: "var(--input-bg)" },
  addTypeConfirmBtn: { border: "none", borderRadius: 6, background: "#10B981", color: "#fff", padding: "0 8px", cursor: "pointer", display: "flex", alignItems: "center" },
  addTypeCancelBtn: { border: "1px solid var(--input-border)", borderRadius: 6, background: "transparent", color: "var(--text-faint)", padding: "0 8px", cursor: "pointer", display: "flex", alignItems: "center" },
  durationPill: { alignSelf: "flex-start", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, padding: "3px 7px", borderRadius: 10, background: "var(--surface-solid)", color: "var(--text-muted)" },
  durationOverdue: { background: "rgba(239,68,68,0.16)", color: "#EF4444" },
  durationDueSoon: { background: "rgba(245,158,11,0.16)", color: "#F59E0B" },
  addCardRow: { marginTop: 2, display: "flex", flexDirection: "column", gap: 6 },
  composerPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "var(--surface-strong)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: "1px solid var(--card-border)",
    borderRadius: 12,
    padding: 14,
    maxWidth: 360,
    marginBottom: 18,
  },
  composerHead: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-muted)" },
  addCardInput: { width: "100%", border: "1px dashed var(--input-border)", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "transparent", outline: "none", fontFamily: "'Inter', system-ui, sans-serif", boxSizing: "border-box", color: "var(--text-primary)" },
  durationRow: { display: "flex", gap: 6 },
  durationInput: { width: 60, border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, outline: "none", boxSizing: "border-box", color: "var(--text-primary)", background: "var(--input-bg)" },
  startDateRow: { display: "flex", alignItems: "center", gap: 6 },
  startDateInput: { border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, outline: "none", boxSizing: "border-box", color: "var(--text-primary)", background: "var(--input-bg)", fontFamily: "'IBM Plex Mono', monospace" },
  durationSelect: { border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 4px", fontSize: 12, outline: "none", background: "var(--input-bg)", color: "var(--text-primary)" },
  durationAddBtn: { flex: 1, border: "none", borderRadius: 6, background: "#3B82F6", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 500 },
  durationHint: { fontSize: 10, color: "var(--text-faint)", alignSelf: "center", fontStyle: "italic" },
  submitCardBtn: { border: "none", borderRadius: 6, background: "#3B82F6", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 10px" },
  addColumnBtn: { minWidth: 140, height: 44, border: "1px dashed #C7C3B6", background: "transparent", borderRadius: 8, color: "var(--text-faint)", fontSize: 13, cursor: "pointer", alignSelf: "flex-start", flexShrink: 0 },
  noteWrap: { display: "flex", flexDirection: "column", gap: 6, height: "100%", maxWidth: 720 },
  noteTitle: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 26, fontWeight: 600, border: "none", background: "transparent", outline: "none", color: "var(--text-primary)" },
  noteMeta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--text-faint)", marginBottom: 10 },
  noteBody: { flex: 1, border: "none", outline: "none", background: "transparent", resize: "none", fontSize: 15.5, lineHeight: 1.7, color: "var(--text-primary)", fontFamily: "'Inter', system-ui, sans-serif" },

  insightWrap: { display: "flex", flexDirection: "column", gap: 6, maxWidth: 780 },
  insightHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
  insightTitle: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 26, fontWeight: 600, color: "var(--text-primary)", margin: 0 },
  insightModeToggle: { display: "flex", gap: 6, background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 9, padding: 3 },
  insightModeBtn: { border: "none", background: "transparent", color: "var(--text-muted)", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  insightModeBtnActive: { background: "#3B82F6", color: "#fff", fontWeight: 600 },
  monthPickerRow: { display: "flex", alignItems: "center", gap: 6, margin: "4px 0 10px" },
  insightSubtitle: { fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 6 },
  insightSubtitleSmall: { fontSize: 12, color: "var(--text-faint)", marginBottom: 6 },
  compareControls: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: "6px 0 18px" },
  compareMonthPicker: { display: "flex", flexWrap: "wrap", gap: 6 },
  compareMonthChip: { border: "1px solid var(--card-border)", background: "var(--surface-solid)", color: "var(--text-muted)", borderRadius: 12, padding: "5px 12px", fontSize: 12, cursor: "pointer" },
  compareMonthChipActive: { background: "#10B981", borderColor: "#10B981", color: "#fff" },
  compareChart: { display: "flex", alignItems: "flex-end", gap: 18, height: 220, padding: "18px 10px 0", borderBottom: "1px solid var(--card-border)", overflowX: "auto" },
  compareBarCol: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 64, height: "100%", justifyContent: "flex-end" },
  compareBarValue: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" },
  compareBarTrack: { width: 34, flex: 1, display: "flex", alignItems: "flex-end", background: "var(--surface-solid)", borderRadius: 6, overflow: "hidden" },
  compareBarFill: { width: "100%", background: "linear-gradient(180deg, #60A5FA, #3B82F6)", borderRadius: "6px 6px 0 0", transition: "height 0.3s ease" },
  compareBarLabel: { fontSize: 11, color: "var(--text-muted)", textAlign: "center", whiteSpace: "nowrap" },
  compareSummaryText: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 14 },
  insightSectionDivider: { height: 1, background: "var(--card-border)", margin: "26px 0 18px" },
  insightSectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  insightSectionTitle: { display: "flex", alignItems: "center", gap: 8, fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: 0 },
  insightTypeSelect: { border: "1px solid var(--card-border)", borderRadius: 8, background: "var(--surface-solid)", color: "var(--text-primary)", fontSize: 12.5, padding: "7px 10px", outline: "none", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  insightTypeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 12 },
  insightTypeCard: { background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 },
  insightTypeCardHighlight: { borderColor: "#3B82F6", boxShadow: "0 0 0 1px #3B82F6 inset" },
  insightTypeCardCount: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 26, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 },
  insightTypeCardName: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.35 },
  memberStatsTable: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 },
  memberStatsRow: { display: "flex", alignItems: "center", gap: 14, background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "10px 16px" },
  memberStatsName: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", width: 140, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  memberStatsBarTrack: { flex: 1, height: 8, borderRadius: 4, background: "var(--card-border)", overflow: "hidden", minWidth: 60 },
  memberStatsBarFill: { height: "100%", background: "linear-gradient(90deg, #10B981, #34D399)", borderRadius: 4, transition: "width 0.3s ease" },
  memberStatsNums: { display: "flex", gap: 10, flexShrink: 0, fontSize: 11.5 },
  memberStatsDone: { color: "#10B981", fontWeight: 600, whiteSpace: "nowrap" },
  memberStatsProgress: { color: "#F59E0B", fontWeight: 600, whiteSpace: "nowrap" },
  insightEmpty: { fontSize: 14, color: "var(--text-faint)", fontStyle: "italic", padding: "24px 0" },
  insightBody: { display: "flex", alignItems: "center", gap: 40, flexWrap: "wrap" },
  donutOuter: { width: 220, height: 220, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 10px 26px rgba(35,38,43,0.14)" },
  donutInner: { width: 150, height: 150, borderRadius: "50%", background: "var(--surface-solid)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.04)" },
  donutTotal: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 34, fontWeight: 700, color: "var(--text-primary)" },
  donutTotalLabel: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-faint)", marginTop: 2 },
  insightStats: { display: "flex", flexDirection: "column", gap: 14 },
  statCard: { display: "flex", alignItems: "center", gap: 12, background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "12px 18px", minWidth: 220 },
  statDot: { width: 14, height: 14, borderRadius: "50%", flexShrink: 0 },
  statNumber: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 22, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 },
  statLabel: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 },
  insightSummaryCard: { marginTop: 26, background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "16px 20px", maxWidth: 560 },
  insightSummaryLabel: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 8 },
  insightSummaryText: { fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" },

  fab: { position: "fixed", bottom: 22, right: 22, width: 52, height: 52, borderRadius: "50%", background: "#3B82F6", color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(59,130,246,0.45)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 40 },
  memberPanel: { position: "fixed", bottom: 86, right: 22, width: 230, background: "var(--modal-bg)", border: "1px solid var(--card-border)", color: "var(--text-primary)", borderRadius: 12, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 40, display: "flex", flexDirection: "column", gap: 10 },
  memberPanelTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)" },
  memberList: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" },
  memberRow: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, padding: "4px 6px", borderRadius: 5, background: "rgba(255,255,255,0.04)" },
  editAccountRow: { display: "flex", flexDirection: "column", gap: 6, padding: "6px", borderRadius: 5, background: "rgba(255,255,255,0.04)" },
  memberDelete: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", display: "flex", alignItems: "center" },
  memberAddRow: { display: "flex", flexDirection: "column", gap: 6 },
  memberInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "6px 8px", color: "#fff", fontSize: 13, outline: "none" },
  memberAddBtn: { background: "#10B981", color: "#fff", border: "none", borderRadius: 5, padding: "7px 0", fontSize: 12.5, cursor: "pointer", fontWeight: 500 },

  bellBtn: { position: "fixed", top: 14, right: 14, width: 42, height: 42, borderRadius: "50%", background: "#111111", color: "#fff", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 50 },
  bellBadge: { position: "absolute", top: -3, right: -3, background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" },
  notifPanel: { position: "fixed", top: 62, right: 14, width: 290, maxHeight: 380, overflowY: "auto", background: "var(--modal-bg)", border: "1px solid var(--card-border)", color: "var(--text-primary)", borderRadius: 12, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 50, display: "flex", flexDirection: "column", gap: 10 },
  notifTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)" },
  notifEmpty: { fontSize: 12.5, color: "var(--text-faint)", fontStyle: "italic" },
  notifGroup: { display: "flex", flexDirection: "column", gap: 5 },
  notifGroupLabelOverdue: { fontSize: 11, fontWeight: 600, color: "#F87171" },
  notifGroupLabelSoon: { fontSize: 11, fontWeight: 600, color: "#60A5FA" },
  notifItem: { background: "rgba(255,255,255,0.05)", borderRadius: 7, padding: "8px 10px", cursor: "pointer" },
  notifItemText: { fontSize: 12.5, marginBottom: 2 },
  notifItemMeta: { fontSize: 10.5, color: "var(--text-muted)" },

  modalBackdrop: { position: "fixed", inset: 0, background: "var(--modal-overlay)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  modalBox: { background: "var(--modal-bg)", border: "1px solid var(--card-border)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 340, boxShadow: "0 12px 32px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", gap: 16 },
  modalMessage: { fontSize: 14.5, lineHeight: 1.5, color: "var(--text-primary)" },
  modalActions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  modalCancel: { background: "transparent", border: "1px solid var(--input-border)", color: "var(--text-muted)", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  modalConfirm: { background: "#EF4444", border: "none", color: "#fff", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontWeight: 500 },

  calendarWrap: { display: "flex", flexDirection: "column", gap: 4, maxWidth: 620 },
  calendarNavRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, margin: "6px 0 14px" },
  calendarGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  calendarWeekdayCell: { textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-faint)", padding: "4px 0" },
  calendarEmptyCell: { aspectRatio: "1 / 1" },
  calendarDayCell: {
    position: "relative",
    aspectRatio: "1 / 1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "var(--surface-solid)",
    border: "1px solid var(--card-border)",
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-primary)",
  },
  calendarDayCellToday: { borderColor: "#10B981", boxShadow: "0 0 0 1px #10B981 inset" },
  calendarDayCellSelected: { background: "#3B82F6", borderColor: "#3B82F6", color: "#fff" },
  calendarDayNum: { fontWeight: 600 },
  calendarDayBadge: { position: "absolute", top: 3, right: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 700, color: "#fff", background: "#EF4444", borderRadius: 8, minWidth: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" },
  calendarPanel: { marginTop: 20, background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 },
  calendarPanelTitle: { fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em", fontSize: 16, fontWeight: 600, color: "var(--text-primary)" },
  calendarNoteList: { display: "flex", flexDirection: "column", gap: 8 },
  calendarNoteItem: { display: "flex", alignItems: "center", gap: 10, background: "var(--surface-strong)", border: "1px solid var(--card-border)", borderRadius: 8, padding: "8px 10px" },
  calendarNoteMeta: { fontSize: 10.5, color: "var(--text-faint)", flexShrink: 0, whiteSpace: "nowrap" },
  calendarAddRow: { marginTop: 2, display: "flex", flexDirection: "column", gap: 6 },
  calendarAddSelectRow: { display: "flex", gap: 6, flexWrap: "wrap" },
};
