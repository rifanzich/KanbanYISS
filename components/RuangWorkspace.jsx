"use client";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { Plus, X, Download, Bell, LogOut, ShieldCheck, PieChart, Calendar, Check, Sun, Moon } from "lucide-react";

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

const uid = () => Math.random().toString(36).slice(2, 10);

const UNIT_MS = { menit: 60000, jam: 3600000, hari: 86400000 };
const UNIT_LABEL = { menit: "menit", jam: "jam", hari: "hari" };
const DUE_SOON_MS = 12 * UNIT_MS.jam;

const emptyWorkspaceData = () => ({
  boards: {},
  boardOrder: [],
  notes: {},
  noteOrder: [],
  cardTypes: [...DEFAULT_CARD_TYPES],
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
        columns: [
          { id: col1, name: "Belum Dikerjakan", cardIds: [card1] },
          { id: col2, name: "Sedang Dikerjakan", cardIds: [card2] },
          { id: col3, name: "Selesai", cardIds: [] },
        ],
        cards: {
          [card1]: { id: card1, text: "Centang kartu ini untuk pindah otomatis", createdAt: now, duration: null, involvedMembers: [], cardType: "Video Semenit", checked: false },
          [card2]: { id: card2, text: "Centang di sini untuk tandai selesai", createdAt: now, duration: { amount: 10, unit: "jam" }, involvedMembers: [], cardType: "Poster Dakwah", checked: false },
        },
      },
    },
    boardOrder: [boardId],
    notes: {},
    noteOrder: [],
    cardTypes: [...DEFAULT_CARD_TYPES],
    active: { type: "board", id: boardId },
  };
};

function normalizeWsData(raw) {
  const base = raw ? raw : emptyWorkspaceData();
  const cardTypes = base.cardTypes && base.cardTypes.length ? base.cardTypes : [...DEFAULT_CARD_TYPES];
  const boards = { ...(base.boards || {}) };
  Object.keys(boards).forEach((bid) => {
    const board = boards[bid];
    const cards = { ...board.cards };
    Object.keys(cards).forEach((cid) => {
      const card = cards[cid];
      const involvedMembers = card.involvedMembers ? card.involvedMembers : card.assignee ? [card.assignee] : [];
      cards[cid] = { ...card, involvedMembers, cardType: card.cardType || "" };
    });
    boards[bid] = { ...board, cards };
  });
  return { ...base, cardTypes, boards };
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
  const { amount, unit } = card.duration;
  const due = card.createdAt + amount * UNIT_MS[unit];
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
  wsData.boardOrder.forEach((bid) => {
    const board = wsData.boards[bid];
    if (!board) return;
    board.columns.forEach((col) => {
      col.cardIds.forEach((cid) => {
        const card = board.cards[cid];
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
    if (!board) return;
    const rows = [];
    board.columns.forEach((col) => {
      col.cardIds.forEach((cid) => {
        const card = board.cards[cid];
        if (!card) return;
        const info = getDurationInfo(card);
        rows.push({
          Kolom: col.name,
          "Jenis Kartu": card.cardType || "",
          Kartu: card.text,
          "Anggota Terlibat": (card.involvedMembers || []).join(", "),
          "Durasi Target": card.duration ? `${card.duration.amount} ${UNIT_LABEL[card.duration.unit]}` : "",
          Status: info ? (info.status === "overdue" ? "Terlambat" : info.status === "due_soon" ? "Mendekati tenggat" : "Tepat waktu") : "",
          "Dibuat pada": formatCreatedDate(card.createdAt),
        });
      });
    });
    let sheetName = sanitizeSheetName(board.name);
    let i = 2;
    while (usedNames.has(sheetName)) {
      sheetName = sanitizeSheetName(`${board.name}${i}`);
      i++;
    }
    usedNames.add(sheetName);
    const ws = XLSX.utils.json_to_sheet(
      rows.length ? rows : [{ Kolom: "", "Jenis Kartu": "", Kartu: "(belum ada kartu)", "Anggota Terlibat": "", "Durasi Target": "", Status: "", "Dibuat pada": "" }]
    );
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
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
  --app-bg: linear-gradient(135deg, #EFEDE6 0%, #F3E8D6 45%, #E7ECE3 100%);
  --sidebar-bg: rgba(27,36,48,0.72);
  --sidebar-border: rgba(255,255,255,0.08);
  --surface: rgba(255,255,255,0.5);
  --surface-solid: #F7F5F0;
  --surface-strong: rgba(255,255,255,0.72);
  --card-border: rgba(228,225,215,0.9);
  --text-primary: #23262B;
  --text-muted: #6B6E76;
  --text-faint: #A8A59B;
  --modal-bg: rgba(255,255,255,0.8);
  --modal-overlay: rgba(20,20,20,0.4);
  --input-bg: rgba(255,255,255,0.55);
  --input-border: #D4D0C3;
}
.rw-app[data-theme="dark"] {
  --app-bg: linear-gradient(135deg, #11151c 0%, #171c25 50%, #12161d 100%);
  --sidebar-bg: rgba(9,12,17,0.65);
  --sidebar-border: rgba(255,255,255,0.06);
  --surface: rgba(255,255,255,0.045);
  --surface-solid: #1b2028;
  --surface-strong: rgba(255,255,255,0.065);
  --card-border: rgba(255,255,255,0.09);
  --text-primary: #ECEAE3;
  --text-muted: #9A9DA5;
  --text-faint: #6E727C;
  --modal-bg: rgba(22,26,33,0.82);
  --modal-overlay: rgba(0,0,0,0.6);
  --input-bg: rgba(255,255,255,0.06);
  --input-border: rgba(255,255,255,0.16);
}
.rw-glass { backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.rw-sidebar { position: relative; transform: none; z-index: 30; }
.rw-topbar { display: none; }
.rw-backdrop { display: none; }
.rw-board-title { font-size: 26px; }
.rw-column { width: 270px; min-width: 270px; }
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

function LogoMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="112" fill="#1B2430" />
      <rect x="120" y="288" width="72" height="128" rx="20" fill="#C48A2E" />
      <rect x="220" y="216" width="72" height="200" rx="20" fill="#DDBB79" />
      <rect x="320" y="144" width="72" height="272" rx="20" fill="#5B7553" />
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
  const [theme, setTheme] = useState("light");
  const [, forceTick] = useState(0);

  const requestConfirm = (message, onConfirm) => setConfirmDialog({ message, onConfirm });

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
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap";
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
  const currentTitle = activeBoard ? activeBoard.name : activeNote ? activeNote.title || "Tanpa judul" : activeInsight ? "Insight" : "Kanban YISS";
  const { overdue, dueSoon } = collectUrgentCards(wsData);
  const urgentCount = overdue.length + dueSoon.length;

  const setActive = (active) => setWsData((d) => ({ ...d, active }));
  const closeSidebar = () => setSidebarOpen(false);

  // "Anggota terlibat" now draws from real portal accounts: the approved
  // roster for team workspaces, or every registered account for personal ones.
  const availableMembers = activeWs?.mode === "team" ? activeWs.allowedMembers || [] : allUsernames;

  const addCardType = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWsData((d) => (d.cardTypes.includes(trimmed) ? d : { ...d, cardTypes: [...d.cardTypes, trimmed] }));
  };

  // ---- Board actions ----
  const addBoard = () => {
    const id = uid();
    const c1 = uid(), c2 = uid(), c3 = uid();
    setWsData((d) => ({
      ...d,
      boards: {
        ...d.boards,
        [id]: {
          id,
          name: "Papan Baru",
          columns: [
            { id: c1, name: "Belum Dikerjakan", cardIds: [] },
            { id: c2, name: "Sedang Dikerjakan", cardIds: [] },
            { id: c3, name: "Selesai", cardIds: [] },
          ],
          cards: {},
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

  const addColumn = (boardId) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      const id = uid();
      return {
        ...d,
        boards: { ...d.boards, [boardId]: { ...board, columns: [...board.columns, { id, name: "Kolom Baru", cardIds: [] }] } },
      };
    });
  };

  const renameColumn = (boardId, colId, name) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      return {
        ...d,
        boards: { ...d.boards, [boardId]: { ...board, columns: board.columns.map((c) => (c.id === colId ? { ...c, name } : c)) } },
      };
    });
  };

  const deleteColumn = (boardId, colId) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      const col = board.columns.find((c) => c.id === colId);
      const cards = { ...board.cards };
      col.cardIds.forEach((cid) => delete cards[cid]);
      return {
        ...d,
        boards: { ...d.boards, [boardId]: { ...board, columns: board.columns.filter((c) => c.id !== colId), cards } },
      };
    });
  };

  const addCard = (boardId, colId, text, duration, involvedMembers, cardType) => {
    const finalText = (text && text.trim()) || cardType || "Kartu Baru";
    setWsData((d) => {
      const board = d.boards[boardId];
      const id = uid();
      return {
        ...d,
        boards: {
          ...d.boards,
          [boardId]: {
            ...board,
            cards: {
              ...board.cards,
              [id]: { id, text: finalText, createdAt: Date.now(), duration: duration || null, involvedMembers: involvedMembers || [], cardType: cardType || "", checked: false },
            },
            columns: board.columns.map((c) => (c.id === colId ? { ...c, cardIds: [...c.cardIds, id] } : c)),
          },
        },
      };
    });
  };

  const deleteCard = (boardId, colId, cardId) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      const cards = { ...board.cards };
      delete cards[cardId];
      return {
        ...d,
        boards: {
          ...d.boards,
          [boardId]: { ...board, cards, columns: board.columns.map((c) => (c.id === colId ? { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) } : c)) },
        },
      };
    });
  };

  const moveCard = (boardId, fromCol, toCol, cardId) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      const columns = board.columns.map((c) => {
        if (c.id === fromCol) return { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) };
        return c;
      });
      const finalColumns = columns.map((c) => {
        if (c.id === toCol && !c.cardIds.includes(cardId)) return { ...c, cardIds: [...c.cardIds, cardId] };
        return c;
      });
      return { ...d, boards: { ...d.boards, [boardId]: { ...board, columns: finalColumns } } };
    });
  };

  const updateCard = (boardId, cardId, patch) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      return { ...d, boards: { ...d.boards, [boardId]: { ...board, cards: { ...board.cards, [cardId]: { ...board.cards[cardId], ...patch } } } } };
    });
  };

  const toggleCheck = (boardId, colId, cardId) => {
    setWsData((d) => {
      const board = d.boards[boardId];
      const colIndex = board.columns.findIndex((c) => c.id === colId);
      const card = board.cards[cardId];
      if (!card) return d;
      const newChecked = !card.checked;
      let cards = { ...board.cards, [cardId]: { ...card, checked: newChecked } };
      let columns = board.columns;

      if (newChecked && colIndex >= 0 && colIndex <= 1 && colIndex < board.columns.length - 1) {
        const targetIndex = colIndex + 1;
        columns = board.columns.map((c, i) => {
          if (c.id === colId) return { ...c, cardIds: c.cardIds.filter((id) => id !== cardId) };
          if (i === targetIndex) return { ...c, cardIds: [...c.cardIds, cardId] };
          return c;
        });
        const clearDuration = targetIndex === 2;
        cards = { ...cards, [cardId]: { ...cards[cardId], checked: false, duration: clearDuration ? null : cards[cardId].duration } };
      }
      return { ...d, boards: { ...d.boards, [boardId]: { ...board, columns, cards } } };
    });
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
            onRename={renameBoard}
            onAddColumn={addColumn}
            onRenameColumn={renameColumn}
            onDeleteColumn={deleteColumn}
            onAddCard={addCard}
            onDeleteCard={deleteCard}
            onMoveCard={moveCard}
            onUpdateCard={updateCard}
            onToggleCheck={toggleCheck}
            onRequestConfirm={requestConfirm}
            dragCard={dragCard}
            setDragCard={setDragCard}
          />
        )}
        {activeNote && <NoteView note={activeNote} onUpdate={updateNote} />}
        {activeInsight && <InsightView wsData={wsData} />}
        {!activeBoard && !activeNote && !activeInsight && (
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
              <button style={styles.modalCancel} onClick={() => setConfirmDialog(null)}>
                Batal
              </button>
              <button
                style={styles.modalConfirm}
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                Hapus
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
                {(accounts || []).map((a) => (
                  <div key={a.username} style={styles.memberRow}>
                    <span>
                      {a.username} <span style={{ opacity: 0.6, fontSize: 10.5 }}>({a.role === "admin" ? "Admin" : "Anggota"})</span>
                    </span>
                    <button style={styles.memberDelete} onClick={() => onRequestDeleteAccount(a.username)}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
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

function TypeSelect({ value, options, counts, onChange, onAddOption }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

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
            {counts && counts[t] ? `${t} (${counts[t]})` : t}
        </option>
      ))}
      <option value="__add_new__">+ Tambah jenis baru…</option>
      </select>
      {value && counts && counts[value] ? <span style={styles.typeCountBadge}>{counts[value]}</span> : null}
    </div>
  );
}

function BoardView({ board, members, cardTypes, onAddCardType, isAdmin, onRename, onAddColumn, onRenameColumn, onDeleteColumn, onAddCard, onDeleteCard, onMoveCard, onUpdateCard, onToggleCheck, onRequestConfirm, dragCard, setDragCard }) {
  const [drafts, setDrafts] = useState({});
  const [dragOverCol, setDragOverCol] = useState(null);

  const draft = (colId) => drafts[colId] || { text: "", amount: "", unit: "hari", involvedMembers: [], cardType: "" };
  const setDraft = (colId, patch) => setDrafts((d) => ({ ...d, [colId]: { ...draft(colId), ...patch } }));

  const typeCounts = {};
  Object.values(board.cards).forEach((c) => {
    if (c.cardType) typeCounts[c.cardType] = (typeCounts[c.cardType] || 0) + 1;
  });

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
    onAddCard(board.id, colId, dr.text, duration, dr.involvedMembers, dr.cardType);
    setDrafts((d) => ({ ...d, [colId]: { text: "", amount: "", unit: "hari", involvedMembers: [], cardType: "" } }));
  };

  const toggleCardMember = (boardId, cid, currentList, name) => {
    const has = currentList.includes(name);
    onUpdateCard(boardId, cid, { involvedMembers: has ? currentList.filter((m) => m !== name) : [...currentList, name] });
  };

  return (
    <div style={styles.boardWrap}>
      <input className="rw-board-title" style={styles.boardTitle} value={board.name} onChange={(e) => onRename(board.id, e.target.value)} />
      <div className="rw-columns-row" style={styles.columnsRow}>
        {board.columns.map((col, colIndex) => (
          <div
            key={col.id}
            className="rw-column"
            style={{ ...styles.column, ...(dragOverCol === col.id ? styles.columnDragOver : {}) }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col.id);
            }}
            onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCol(null);
              if (dragCard) {
                onMoveCard(board.id, dragCard.colId, col.id, dragCard.cardId);
                setDragCard(null);
              }
            }}
          >
            <div style={styles.columnHead}>
              <input style={styles.columnTitle} value={col.name} onChange={(e) => onRenameColumn(board.id, col.id, e.target.value)} />
              <button
                style={styles.columnDelete}
                onClick={() => {
                  onRequestConfirm(`Hapus kolom "${col.name}" beserta isinya?`, () => onDeleteColumn(board.id, col.id));
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={styles.cardStack}>
              {col.cardIds.map((cid) => {
                const card = board.cards[cid];
                if (!card) return null;
                const info = getDurationInfo(card);
                const involved = card.involvedMembers || [];
                return (
                  <div key={cid} draggable onDragStart={() => setDragCard({ cardId: cid, colId: col.id })} onDragEnd={() => setDragCard(null)} style={styles.card}>
                    <div style={styles.cardTop}>
                      <label style={styles.checkLabel}>
                        <input type="checkbox" checked={!!card.checked} onChange={() => onToggleCheck(board.id, col.id, cid)} style={styles.checkbox} />
                        <span style={{ ...styles.cardText, ...(card.checked ? styles.cardTextDone : {}) }}>{card.text}</span>
                      </label>
                      <button
                        style={styles.cardDelete}
                        onClick={() => {
                          onRequestConfirm("Hapus kartu ini?", () => onDeleteCard(board.id, col.id, cid));
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div style={styles.createdDateLabel}>
                      <Calendar size={11} />
                      <span>{formatCreatedDate(card.createdAt)}</span>
                    </div>

                    <TypeSelect
                      value={card.cardType}
                      options={cardTypes}
                      counts={typeCounts}
                      onChange={(v) => onUpdateCard(board.id, cid, { cardType: v })}
                      onAddOption={onAddCardType}
                    />

                    <div style={styles.involvedLabel}>Anggota terlibat</div>
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
                  </div>
                );
              })}
            </div>

            {colIndex === 0 && (
              <div style={styles.addCardRow}>
                <input style={styles.addCardInput} placeholder="Tulis kartu baru…" value={draft(col.id).text} onChange={(e) => setDraft(col.id, { text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit(col.id)} />

                <TypeSelect
                  value={draft(col.id).cardType}
                  options={cardTypes}
                  counts={typeCounts}
                  onChange={(v) => setDraft(col.id, { cardType: v })}
                  onAddOption={onAddCardType}
                />

                {isAdmin ? (
                  <div>
                    <div style={styles.involvedLabel}>Anggota terlibat</div>
                    <div style={styles.chipRow}>
                      {members.map((m) => {
                        const active = draft(col.id).involvedMembers.includes(m);
                        return (
                          <button key={m} style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }} onClick={() => toggleDraftMember(col.id, m)}>
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={styles.assigneeReadonlyHint}>Penugasan anggota hanya bisa diatur oleh admin</div>
                )}

                <div className="rw-duration-row" style={styles.durationRow}>
                  <input style={styles.durationInput} type="number" min="1" placeholder="1" value={draft(col.id).amount} onChange={(e) => setDraft(col.id, { amount: e.target.value })} />
                  <select style={styles.durationSelect} value={draft(col.id).unit} onChange={(e) => setDraft(col.id, { unit: e.target.value })}>
                    <option value="menit">Menit</option>
                    <option value="jam">Jam</option>
                    <option value="hari">Hari</option>
                  </select>
                  <span style={styles.durationHint}>kosongkan = 1 hari</span>
                  <button style={styles.submitCardBtn} onClick={() => submit(col.id)} title="Tambahkan kartu" aria-label="Tambahkan kartu">
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <button style={styles.addColumnBtn} onClick={() => onAddColumn(board.id)}>
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

function InsightView({ wsData }) {
  let done = 0;
  let inProgress = 0;
  let todo = 0;
  wsData.boardOrder.forEach((bid) => {
    const board = wsData.boards[bid];
    if (!board) return;
    if (board.columns[0]) todo += board.columns[0].cardIds.length;
    if (board.columns[1]) inProgress += board.columns[1].cardIds.length;
    if (board.columns[2]) done += board.columns[2].cardIds.length;
  });
  const total = done + inProgress;
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const inProgressPct = total ? 100 - donePct : 0;
  const boardCount = wsData.boardOrder.length;

  const summaryText = (() => {
    if (total === 0 && todo === 0) return null;
    if (total === 0) {
      return `Ada ${todo} pekerjaan yang belum mulai dikerjakan di ${boardCount} papan. Belum ada yang berjalan atau selesai.`;
    }
    let mood;
    if (donePct >= 75) mood = "Capaian kerja sangat baik — sebagian besar pekerjaan sudah tuntas.";
    else if (donePct >= 40) mood = "Progres berjalan cukup seimbang antara yang selesai dan yang masih berjalan.";
    else mood = "Sebagian besar pekerjaan masih dalam proses pengerjaan.";
    return `Dari total ${total} pekerjaan di ${boardCount} papan, tim telah menyelesaikan ${done} pekerjaan (${donePct}%), sementara ${inProgress} pekerjaan (${inProgressPct}%) masih dalam pengerjaan.${todo ? ` Ada juga ${todo} pekerjaan lain yang belum dimulai.` : ""} ${mood}`;
  })();

  return (
    <div style={styles.insightWrap}>
      <h2 style={styles.insightTitle}>Insight</h2>
      <div style={styles.insightSubtitle}>Perbandingan pekerjaan sedang dikerjakan dan yang sudah selesai, dari seluruh papan di ruang ini.</div>

      {total === 0 ? (
        <div style={styles.insightEmpty}>{summaryText || "Belum ada pekerjaan yang sedang dikerjakan atau selesai."}</div>
      ) : (
        <>
          <div style={styles.insightBody}>
            <div
              style={{
                ...styles.donutOuter,
                background: `conic-gradient(#5B7553 0 ${donePct}%, #C48A2E ${donePct}% 100%)`,
              }}
            >
              <div style={styles.donutInner}>
                <div style={styles.donutTotal}>{total}</div>
                <div style={styles.donutTotalLabel}>Total kartu</div>
              </div>
            </div>

            <div style={styles.insightStats}>
              <div style={styles.statCard}>
                <div style={{ ...styles.statDot, background: "#5B7553" }} />
                <div>
                  <div style={styles.statNumber}>{done}</div>
                  <div style={styles.statLabel}>Selesai ({donePct}%)</div>
                </div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statDot, background: "#C48A2E" }} />
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
    </div>
  );
}

const styles = {
  app: { display: "flex", height: "100vh", minHeight: 640, fontFamily: "'Inter', system-ui, sans-serif", background: "var(--app-bg)", color: "var(--text-primary)", position: "relative" },
  topbar: { position: "fixed", top: 0, left: 0, right: 0, height: 56, background: "#1B2430", color: "#fff", alignItems: "center", gap: 12, padding: "0 14px", zIndex: 10 },
  hamburgerBtn: { background: "transparent", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", padding: 4 },
  topbarTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  loadingWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--app-bg)", fontFamily: "'Inter', system-ui, sans-serif", color: "var(--text-faint)" },
  loadingText: { fontSize: 14 },

  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "linear-gradient(135deg, #1B2430 0%, #2A3B2E 55%, #3A2C18 100%)", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 },
  authCard: { width: "100%", maxWidth: 340, background: "rgba(35,45,59,0.55)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.35)" },
  authBrand: { display: "flex", alignItems: "baseline", gap: 8, justifyContent: "center" },
  authBrandName: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700, color: "#fff" },
  authSubtitle: { textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: "#9CA0A8", marginBottom: 6 },
  authHint: { fontSize: 12, lineHeight: 1.5, color: "#B7B5AD", background: "rgba(196,138,46,0.12)", border: "1px solid rgba(196,138,46,0.3)", borderRadius: 8, padding: "10px 12px" },
  authInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "10px 12px", color: "#fff", fontSize: 14, outline: "none" },
  authError: { color: "#E38585", fontSize: 12.5 },
  authSubmitBtn: { background: "#C48A2E", color: "#1B2430", border: "none", borderRadius: 7, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 4 },

  sidebar: { width: 250, minWidth: 250, background: "var(--sidebar-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRight: "1px solid var(--sidebar-border)", color: "#E7E5DE", display: "flex", flexDirection: "column", padding: "20px 14px", gap: 16, overflowY: "auto" },
  brandRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  brand: { display: "flex", alignItems: "baseline", gap: 8, padding: "0 6px 6px 6px" },
  brandMark: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, color: "#C48A2E" },
  brandName: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 16.5, fontWeight: 600, letterSpacing: 0.1 },
  sidebarCloseBtn: { display: "none", background: "transparent", border: "none", color: "#fff", cursor: "pointer", alignItems: "center" },

  userRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8 },
  userInfo: { display: "flex", flexDirection: "column", gap: 3 },
  userName: { fontSize: 13.5, fontWeight: 500 },
  userRoleBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, padding: "2px 6px", borderRadius: 10, background: "rgba(139,141,147,0.25)", color: "#B7B5AD", width: "fit-content" },
  userRoleBadgeAdmin: { background: "rgba(196,138,46,0.28)", color: "#E3B570" },
  logoutBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#C9C7BF", borderRadius: 6, padding: 6, cursor: "pointer", display: "flex", alignItems: "center" },

  wsGroup: { display: "flex", flexDirection: "column", gap: 6 },
  wsHead: { display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#7D818C", padding: "0 4px" },
  wsHeadLabel: {},
  wsItem: { display: "flex", alignItems: "center", gap: 5, padding: "8px 10px", borderRadius: 5, fontSize: 13.5, cursor: "pointer", color: "#C9C7BF" },
  wsItemActive: { background: "rgba(255,255,255,0.08)", color: "#fff" },
  wsBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, padding: "2px 6px", borderRadius: 10, background: "rgba(139,141,147,0.25)", color: "#B7B5AD", flexShrink: 0 },
  wsBadgeTeam: { background: "rgba(196,138,46,0.28)", color: "#E3B570" },
  iconBtnSmall: { background: "transparent", border: "none", color: "#9CB394", cursor: "pointer", display: "flex", alignItems: "center", padding: 2, flexShrink: 0 },
  addWsPanel: { display: "flex", flexDirection: "column", gap: 8, padding: 10, background: "rgba(255,255,255,0.04)", borderRadius: 8, marginTop: 4 },
  addWsInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "6px 8px", color: "#fff", fontSize: 13, outline: "none" },
  modeToggle: { display: "flex", gap: 6 },
  modeBtn: { flex: 1, padding: "5px 0", fontSize: 11.5, borderRadius: 5, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#B7B5AD", cursor: "pointer" },
  modeBtnActive: { background: "#C48A2E", color: "#1B2430", border: "1px solid #C48A2E", fontWeight: 600 },
  modeHint: { fontSize: 10.5, color: "#9CA0A8", lineHeight: 1.4 },
  createWsBtn: { background: "#5B7553", color: "#fff", border: "none", borderRadius: 5, padding: "7px 0", fontSize: 12.5, cursor: "pointer", fontWeight: 500 },
  divider: { height: 1, background: "rgba(255,255,255,0.08)", margin: "2px 0" },
  insightNavItem: { display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 6, fontSize: 13.5, cursor: "pointer", color: "#C9C7BF" },
  insightNavItemActive: { background: "rgba(255,255,255,0.08)", color: "#fff" },
  tabGroup: { display: "flex", flexDirection: "column", gap: 6 },
  tab: { display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", padding: "6px 10px", borderRadius: "6px 6px 0 0", fontWeight: 500 },
  tabGold: { background: "rgba(196,138,46,0.18)", color: "#E3B570" },
  tabMoss: { background: "rgba(91,117,83,0.22)", color: "#9CB394" },
  tabAdd: { background: "transparent", border: "1px solid currentColor", color: "inherit", borderRadius: 4, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 },
  list: { display: "flex", flexDirection: "column", gap: 2 },
  listItem: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 5, fontSize: 13.5, cursor: "pointer", color: "#C9C7BF" },
  listItemActiveGold: { background: "rgba(196,138,46,0.28)", color: "#fff" },
  listItemActiveMoss: { background: "rgba(91,117,83,0.32)", color: "#fff" },
  listItemText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  listItemDelete: { background: "transparent", border: "none", color: "inherit", opacity: 0.7, cursor: "pointer", padding: "0 2px", flexShrink: 0, display: "flex", alignItems: "center" },
  listEmpty: { fontSize: 12, color: "var(--text-muted)", padding: "6px 10px", fontStyle: "italic" },
  main: { flex: 1, overflow: "auto", padding: "28px 32px" },
  teamBanner: { fontSize: 12, color: "#8A6A28", background: "rgba(196,138,46,0.12)", border: "1px solid rgba(196,138,46,0.3)", borderRadius: 6, padding: "8px 12px", marginBottom: 18, display: "inline-block" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "var(--text-faint)", textAlign: "center" },
  emptyTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, color: "var(--text-primary)" },
  emptyText: { fontSize: 14, maxWidth: 340 },
  boardWrap: { display: "flex", flexDirection: "column", gap: 20, height: "100%" },
  boardTitle: { fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, border: "none", background: "transparent", outline: "none", color: "var(--text-primary)", padding: "2px 0", width: "100%", boxSizing: "border-box" },
  columnsRow: { display: "flex", gap: 16, alignItems: "flex-start", overflowX: "auto", paddingBottom: 20, flex: 1 },
  column: { background: "var(--surface)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", border: "1px solid var(--card-border)", borderTop: "3px solid #C48A2E", borderRadius: "10px", padding: 12, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 4px 18px rgba(0,0,0,0.06)", flexShrink: 0 },
  columnDragOver: { boxShadow: "0 0 0 2px #C48A2E inset" },
  columnHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  columnTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, letterSpacing: 0.8, textTransform: "uppercase", border: "none", background: "transparent", outline: "none", color: "var(--text-muted)", width: "85%" },
  columnDelete: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", display: "flex", alignItems: "center" },
  cardStack: { display: "flex", flexDirection: "column", gap: 8 },
  card: { background: "var(--surface-strong)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 2px 8px rgba(35,38,43,0.06)", cursor: "grab", border: "1px solid var(--card-border)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  checkLabel: { display: "flex", alignItems: "flex-start", gap: 7, cursor: "pointer", flex: 1 },
  checkbox: { marginTop: 3, cursor: "pointer", flexShrink: 0 },
  cardText: { fontSize: 13.5, lineHeight: 1.4, color: "var(--text-primary)", fontWeight: 700 },
  cardTextDone: { textDecoration: "line-through", color: "var(--text-faint)" },
  cardDelete: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" },
  typeSelectRow: { display: "flex", alignItems: "center", gap: 6 },
  typeSelect: { border: "1px solid var(--card-border)", borderRadius: 5, background: "transparent", fontSize: 11.5, color: "var(--text-muted)", outline: "none", padding: "4px 6px", fontFamily: "'Inter', system-ui, sans-serif", flex: 1, minWidth: 0, boxSizing: "border-box" },
  typeCountBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: "#fff", background: "#C48A2E", borderRadius: 10, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 },
  assigneeReadonly: { fontSize: 11.5, color: "var(--text-muted)", padding: "4px 2px", fontStyle: "italic" },
  assigneeReadonlyHint: { fontSize: 10.5, color: "var(--text-faint)", fontStyle: "italic", lineHeight: 1.4 },
  createdDateLabel: { display: "flex", alignItems: "center", gap: 5, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--text-faint)" },
  involvedLabel: { fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 5 },
  chip: { border: "1px solid var(--card-border)", background: "var(--surface-strong)", color: "var(--text-muted)", borderRadius: 12, padding: "3px 9px", fontSize: 10.5, cursor: "pointer" },
  chipActive: { background: "#C48A2E", borderColor: "#C48A2E", color: "#fff" },
  typeAddRow: { display: "flex", gap: 6 },
  addTypeInput: { flex: 1, border: "1px dashed var(--input-border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, outline: "none", boxSizing: "border-box", color: "var(--text-primary)", background: "var(--input-bg)" },
  addTypeConfirmBtn: { border: "none", borderRadius: 6, background: "#5B7553", color: "#fff", padding: "0 8px", cursor: "pointer", display: "flex", alignItems: "center" },
  addTypeCancelBtn: { border: "1px solid var(--input-border)", borderRadius: 6, background: "transparent", color: "var(--text-faint)", padding: "0 8px", cursor: "pointer", display: "flex", alignItems: "center" },
  durationPill: { alignSelf: "flex-start", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, padding: "3px 7px", borderRadius: 10, background: "var(--surface-solid)", color: "var(--text-muted)" },
  durationOverdue: { background: "#FBE7E4", color: "#B4402C" },
  durationDueSoon: { background: "#FCF0DA", color: "#9A6A15" },
  addCardRow: { marginTop: 2, display: "flex", flexDirection: "column", gap: 6 },
  addCardInput: { width: "100%", border: "1px dashed var(--input-border)", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "transparent", outline: "none", fontFamily: "'Inter', system-ui, sans-serif", boxSizing: "border-box", color: "var(--text-primary)" },
  durationRow: { display: "flex", gap: 6 },
  durationInput: { width: 60, border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, outline: "none", boxSizing: "border-box", color: "var(--text-primary)", background: "var(--input-bg)" },
  durationSelect: { border: "1px solid var(--input-border)", borderRadius: 6, padding: "6px 4px", fontSize: 12, outline: "none", background: "var(--input-bg)", color: "var(--text-primary)" },
  durationAddBtn: { flex: 1, border: "none", borderRadius: 6, background: "#C48A2E", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 500 },
  durationHint: { fontSize: 10, color: "var(--text-faint)", alignSelf: "center", fontStyle: "italic" },
  submitCardBtn: { border: "none", borderRadius: 6, background: "#C48A2E", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 10px" },
  addColumnBtn: { minWidth: 140, height: 44, border: "1px dashed #C7C3B6", background: "transparent", borderRadius: 8, color: "var(--text-faint)", fontSize: 13, cursor: "pointer", alignSelf: "flex-start", flexShrink: 0 },
  noteWrap: { display: "flex", flexDirection: "column", gap: 6, height: "100%", maxWidth: 720 },
  noteTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 600, border: "none", background: "transparent", outline: "none", color: "var(--text-primary)" },
  noteMeta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "var(--text-faint)", marginBottom: 10 },
  noteBody: { flex: 1, border: "none", outline: "none", background: "transparent", resize: "none", fontSize: 15.5, lineHeight: 1.7, color: "var(--text-primary)", fontFamily: "'Inter', system-ui, sans-serif" },

  insightWrap: { display: "flex", flexDirection: "column", gap: 6, maxWidth: 640 },
  insightTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 600, color: "var(--text-primary)", margin: 0 },
  insightSubtitle: { fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 14 },
  insightEmpty: { fontSize: 14, color: "var(--text-faint)", fontStyle: "italic", padding: "24px 0" },
  insightBody: { display: "flex", alignItems: "center", gap: 40, flexWrap: "wrap" },
  donutOuter: { width: 220, height: 220, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  donutInner: { width: 150, height: 150, borderRadius: "50%", background: "var(--surface-solid)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.03)" },
  donutTotal: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, fontWeight: 700, color: "var(--text-primary)" },
  donutTotalLabel: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-faint)", marginTop: 2 },
  insightStats: { display: "flex", flexDirection: "column", gap: 14 },
  statCard: { display: "flex", alignItems: "center", gap: 12, background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "12px 18px", minWidth: 220 },
  statDot: { width: 14, height: 14, borderRadius: "50%", flexShrink: 0 },
  statNumber: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 },
  statLabel: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 },
  insightSummaryCard: { marginTop: 26, background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "16px 20px", maxWidth: 560 },
  insightSummaryLabel: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 8 },
  insightSummaryText: { fontSize: 14, lineHeight: 1.7, color: "var(--text-primary)" },

  fab: { position: "fixed", bottom: 22, right: 22, width: 52, height: 52, borderRadius: "50%", background: "#C48A2E", color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(196,138,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 40 },
  memberPanel: { position: "fixed", bottom: 86, right: 22, width: 230, background: "var(--modal-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--card-border)", color: "var(--text-primary)", borderRadius: 12, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 40, display: "flex", flexDirection: "column", gap: 10 },
  memberPanelTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)" },
  memberList: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" },
  memberRow: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, padding: "4px 6px", borderRadius: 5, background: "rgba(255,255,255,0.04)" },
  memberDelete: { background: "transparent", border: "none", color: "var(--text-faint)", cursor: "pointer", display: "flex", alignItems: "center" },
  memberAddRow: { display: "flex", flexDirection: "column", gap: 6 },
  memberInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "6px 8px", color: "#fff", fontSize: 13, outline: "none" },
  memberAddBtn: { background: "#5B7553", color: "#fff", border: "none", borderRadius: 5, padding: "7px 0", fontSize: 12.5, cursor: "pointer", fontWeight: 500 },

  bellBtn: { position: "fixed", top: 14, right: 14, width: 42, height: 42, borderRadius: "50%", background: "#1B2430", color: "#fff", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 50 },
  bellBadge: { position: "absolute", top: -3, right: -3, background: "#B4402C", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" },
  notifPanel: { position: "fixed", top: 62, right: 14, width: 290, maxHeight: 380, overflowY: "auto", background: "var(--modal-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--card-border)", color: "var(--text-primary)", borderRadius: 12, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 50, display: "flex", flexDirection: "column", gap: 10 },
  notifTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)" },
  notifEmpty: { fontSize: 12.5, color: "var(--text-faint)", fontStyle: "italic" },
  notifGroup: { display: "flex", flexDirection: "column", gap: 5 },
  notifGroupLabelOverdue: { fontSize: 11, fontWeight: 600, color: "#E38585" },
  notifGroupLabelSoon: { fontSize: 11, fontWeight: 600, color: "#E3B570" },
  notifItem: { background: "rgba(255,255,255,0.05)", borderRadius: 7, padding: "8px 10px", cursor: "pointer" },
  notifItemText: { fontSize: 12.5, marginBottom: 2 },
  notifItemMeta: { fontSize: 10.5, color: "var(--text-muted)" },

  modalBackdrop: { position: "fixed", inset: 0, background: "var(--modal-overlay)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  modalBox: { background: "var(--modal-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--card-border)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 340, boxShadow: "0 12px 32px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", gap: 16 },
  modalMessage: { fontSize: 14.5, lineHeight: 1.5, color: "var(--text-primary)" },
  modalActions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  modalCancel: { background: "transparent", border: "1px solid var(--input-border)", color: "var(--text-muted)", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  modalConfirm: { background: "#B4402C", border: "none", color: "#fff", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontWeight: 500 },
};
