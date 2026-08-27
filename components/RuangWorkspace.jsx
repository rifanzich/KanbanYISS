"use client";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { Plus, X, Download, Bell, LogOut, ShieldCheck } from "lucide-react";

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
const DEFAULT_MEMBERS = ["Rifan", "Mohammad"];

const uid = () => Math.random().toString(36).slice(2, 10);

const UNIT_MS = { menit: 60000, jam: 3600000, hari: 86400000 };
const UNIT_LABEL = { menit: "menit", jam: "jam", hari: "hari" };
const DUE_SOON_MS = 12 * UNIT_MS.jam;

const emptyWorkspaceData = () => ({
  boards: {},
  boardOrder: [],
  notes: {},
  noteOrder: [],
  members: [...DEFAULT_MEMBERS],
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
          [card1]: { id: card1, text: "Centang kartu ini untuk pindah otomatis", createdAt: now, duration: null, assignee: "Rifan", checked: false },
          [card2]: { id: card2, text: "Centang di sini untuk tandai selesai", createdAt: now, duration: { amount: 10, unit: "jam" }, assignee: "Mohammad", checked: false },
        },
      },
    },
    boardOrder: [boardId],
    notes: {},
    noteOrder: [],
    members: [...DEFAULT_MEMBERS],
    active: { type: "board", id: boardId },
  };
};

function normalizeWsData(raw) {
  const base = raw ? raw : emptyWorkspaceData();
  return { ...base, members: base.members && base.members.length ? base.members : [...DEFAULT_MEMBERS] };
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

function getDurationInfo(card) {
  if (!card.duration) return null;
  const { amount, unit } = card.duration;
  const due = card.createdAt + amount * UNIT_MS[unit];
  const remaining = due - Date.now();
  const label = `${amount} ${UNIT_LABEL[unit]}`;
  if (remaining <= 0) return { text: `Terlambat · target ${label}`, status: "overdue" };
  const abs = Math.abs(remaining);
  let remText;
  if (abs >= UNIT_MS.hari) remText = `${Math.ceil(abs / UNIT_MS.hari)} hari lagi`;
  else if (abs >= UNIT_MS.jam) remText = `${Math.ceil(abs / UNIT_MS.jam)} jam lagi`;
  else remText = `${Math.ceil(abs / UNIT_MS.menit)} menit lagi`;
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
          Kartu: card.text,
          "Ditugaskan ke": card.assignee || "",
          "Durasi Target": card.duration ? `${card.duration.amount} ${UNIT_LABEL[card.duration.unit]}` : "",
          Status: info ? (info.status === "overdue" ? "Terlambat" : info.status === "due_soon" ? "Mendekati tenggat" : "Tepat waktu") : "",
          "Dibuat pada": new Date(card.createdAt).toLocaleString("id-ID"),
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
      rows.length ? rows : [{ Kolom: "", Kartu: "(belum ada kartu)", "Ditugaskan ke": "", "Durasi Target": "", Status: "", "Dibuat pada": "" }]
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showMemberPanel, setShowMemberPanel] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [, forceTick] = useState(0);

  const requestConfirm = (message, onConfirm) => setConfirmDialog({ message, onConfirm });

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

      let list = [...personal, ...shared];
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
    const entry = { id, name, mode };
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
  const currentTitle = activeBoard ? activeBoard.name : activeNote ? activeNote.title || "Tanpa judul" : "Ruang";
  const { overdue, dueSoon } = collectUrgentCards(wsData);
  const urgentCount = overdue.length + dueSoon.length;

  const setActive = (active) => setWsData((d) => ({ ...d, active }));
  const closeSidebar = () => setSidebarOpen(false);

  const addMember = () => {
    const name = newMemberName.trim();
    if (!name) return;
    setWsData((d) => (d.members.includes(name) ? d : { ...d, members: [...d.members, name] }));
    setNewMemberName("");
  };

  const performDeleteMember = (name) => {
    setWsData((d) => ({ ...d, members: d.members.filter((m) => m !== name) }));
  };

  const requestDeleteMember = (name) => {
    requestConfirm(`Hapus anggota "${name}" dari daftar?`, () => performDeleteMember(name));
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

  const addCard = (boardId, colId, text, duration, assignee) => {
    if (!text.trim()) return;
    setWsData((d) => {
      const board = d.boards[boardId];
      const id = uid();
      return {
        ...d,
        boards: {
          ...d.boards,
          [boardId]: {
            ...board,
            cards: { ...board.cards, [id]: { id, text, createdAt: Date.now(), duration: duration || null, assignee: assignee || "", checked: false } },
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
    <div style={styles.app}>
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
        onAddBoard={addBoard}
        onAddNote={addNote}
        onDeleteBoard={deleteBoard}
        onDeleteNote={deleteNote}
      />
      <main className="rw-main" style={styles.main}>
        {activeWs?.mode === "team" && (
          <div style={styles.teamBanner}>Ruang tim — dapat dilihat dan diedit oleh siapa pun yang membuka aplikasi ini.</div>
        )}
        {activeBoard && (
          <BoardView
            board={activeBoard}
            members={wsData.members}
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
        {!activeBoard && !activeNote && (
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

      {/* Floating action button: manage team members */}
      <button style={styles.fab} onClick={() => setShowMemberPanel((v) => !v)} title="Kelola anggota" aria-label="Tambah anggota">
        <Plus size={22} strokeWidth={2.4} />
      </button>
      {showMemberPanel && (
        <div style={styles.memberPanel}>
          <div style={styles.memberPanelTitle}>Anggota Tim</div>
          <div style={styles.memberList}>
            {wsData.members.map((m) => (
              <div key={m} style={styles.memberRow}>
                <span>{m}</span>
                <button style={styles.memberDelete} onClick={() => requestDeleteMember(m)} aria-label={`Hapus ${m}`}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div style={styles.memberAddRow}>
            <input
              style={styles.memberInput}
              placeholder="Nama anggota baru…"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
            />
            <button style={styles.memberAddBtn} onClick={addMember}>
              Tambahkan
            </button>
          </div>
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
          <span style={styles.brandMark}>擦</span>
          <span style={styles.authBrandName}>Ruang</span>
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
  onCreateWs,
  wsData,
  onSelectBoard,
  onSelectNote,
  onAddBoard,
  onAddNote,
  onDeleteBoard,
  onDeleteNote,
}) {
  return (
    <aside className={`rw-sidebar ${sidebarOpen ? "open" : ""}`} style={styles.sidebar}>
      <div style={styles.brandRow}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>擦</span>
          <span style={styles.brandName}>Ruang</span>
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
        <button style={styles.logoutBtn} onClick={onLogout} title="Keluar">
          <LogOut size={15} />
        </button>
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
              <button style={{ ...styles.modeBtn, ...(newWsMode === "team" ? styles.modeBtnActive : {}) }} onClick={() => setNewWsMode("team")}>
                Tim
              </button>
            </div>
            {newWsMode === "team" && <div style={styles.modeHint}>Ruang tim bisa dilihat & diedit siapa pun yang membuka aplikasi ini.</div>}
            <button style={styles.createWsBtn} onClick={onCreateWs}>
              Buat Ruang
            </button>
          </div>
        )}
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

function BoardView({ board, members, isAdmin, onRename, onAddColumn, onRenameColumn, onDeleteColumn, onAddCard, onDeleteCard, onMoveCard, onUpdateCard, onToggleCheck, onRequestConfirm, dragCard, setDragCard }) {
  const [drafts, setDrafts] = useState({});
  const [dragOverCol, setDragOverCol] = useState(null);

  const draft = (colId) => drafts[colId] || { text: "", amount: "", unit: "hari", assignee: "" };
  const setDraft = (colId, patch) => setDrafts((d) => ({ ...d, [colId]: { ...draft(colId), ...patch } }));

  const submit = (colId) => {
    const dr = draft(colId);
    const duration = dr.amount ? { amount: Number(dr.amount), unit: dr.unit } : null;
    onAddCard(board.id, colId, dr.text, duration, dr.assignee);
    setDrafts((d) => ({ ...d, [colId]: { text: "", amount: "", unit: dr.unit, assignee: "" } }));
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
                    {isAdmin ? (
                      <select style={styles.assigneeSelect} value={card.assignee || ""} onChange={(e) => onUpdateCard(board.id, cid, { assignee: e.target.value })}>
                        <option value="">Belum ditugaskan</option>
                        {members.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={styles.assigneeReadonly}>{card.assignee || "Belum ditugaskan"}</div>
                    )}
                    {info && <span style={{ ...styles.durationPill, ...(info.status === "overdue" ? styles.durationOverdue : {}), ...(info.status === "due_soon" ? styles.durationDueSoon : {}) }}>⏱ {info.text}</span>}
                  </div>
                );
              })}
            </div>

            {colIndex === 0 && (
              <div style={styles.addCardRow}>
                <input style={styles.addCardInput} placeholder="Tambah kartu…" value={draft(col.id).text} onChange={(e) => setDraft(col.id, { text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit(col.id)} />
                {isAdmin ? (
                  <select style={styles.assigneeSelect} value={draft(col.id).assignee} onChange={(e) => setDraft(col.id, { assignee: e.target.value })}>
                    <option value="">Belum ditugaskan</option>
                    {members.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={styles.assigneeReadonlyHint}>Penugasan pelaksana hanya bisa diatur oleh admin</div>
                )}
                <div className="rw-duration-row" style={styles.durationRow}>
                  <input style={styles.durationInput} type="number" min="1" placeholder="Durasi" value={draft(col.id).amount} onChange={(e) => setDraft(col.id, { amount: e.target.value })} />
                  <select style={styles.durationSelect} value={draft(col.id).unit} onChange={(e) => setDraft(col.id, { unit: e.target.value })}>
                    <option value="menit">Menit</option>
                    <option value="jam">Jam</option>
                    <option value="hari">Hari</option>
                  </select>
                  <button style={styles.durationAddBtn} onClick={() => submit(col.id)}>
                    Tambah
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

const styles = {
  app: { display: "flex", height: "100vh", minHeight: 640, fontFamily: "'Inter', system-ui, sans-serif", background: "#EFEDE6", color: "#23262B", position: "relative" },
  topbar: { position: "fixed", top: 0, left: 0, right: 0, height: 56, background: "#1B2430", color: "#fff", alignItems: "center", gap: 12, padding: "0 14px", zIndex: 10 },
  hamburgerBtn: { background: "transparent", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", padding: 4 },
  topbarTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  loadingWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#EFEDE6", fontFamily: "'Inter', system-ui, sans-serif", color: "#8B8D93" },
  loadingText: { fontSize: 14 },

  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#1B2430", fontFamily: "'Inter', system-ui, sans-serif", padding: 20 },
  authCard: { width: "100%", maxWidth: 340, background: "#232D3B", borderRadius: 14, padding: 28, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.35)" },
  authBrand: { display: "flex", alignItems: "baseline", gap: 8, justifyContent: "center" },
  authBrandName: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 700, color: "#fff" },
  authSubtitle: { textAlign: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: "#9CA0A8", marginBottom: 6 },
  authHint: { fontSize: 12, lineHeight: 1.5, color: "#B7B5AD", background: "rgba(196,138,46,0.12)", border: "1px solid rgba(196,138,46,0.3)", borderRadius: 8, padding: "10px 12px" },
  authInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "10px 12px", color: "#fff", fontSize: 14, outline: "none" },
  authError: { color: "#E38585", fontSize: 12.5 },
  authSubmitBtn: { background: "#C48A2E", color: "#1B2430", border: "none", borderRadius: 7, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 4 },

  sidebar: { width: 250, minWidth: 250, background: "#1B2430", color: "#E7E5DE", display: "flex", flexDirection: "column", padding: "20px 14px", gap: 16, overflowY: "auto" },
  brandRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  brand: { display: "flex", alignItems: "baseline", gap: 8, padding: "0 6px 6px 6px" },
  brandMark: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, color: "#C48A2E" },
  brandName: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 600, letterSpacing: 0.2 },
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
  listEmpty: { fontSize: 12, color: "#6B6E76", padding: "6px 10px", fontStyle: "italic" },
  main: { flex: 1, overflow: "auto", padding: "28px 32px" },
  teamBanner: { fontSize: 12, color: "#8A6A28", background: "rgba(196,138,46,0.12)", border: "1px solid rgba(196,138,46,0.3)", borderRadius: 6, padding: "8px 12px", marginBottom: 18, display: "inline-block" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, color: "#8B8D93", textAlign: "center" },
  emptyTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, color: "#23262B" },
  emptyText: { fontSize: 14, maxWidth: 340 },
  boardWrap: { display: "flex", flexDirection: "column", gap: 20, height: "100%" },
  boardTitle: { fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, border: "none", background: "transparent", outline: "none", color: "#23262B", padding: "2px 0", width: "100%", boxSizing: "border-box" },
  columnsRow: { display: "flex", gap: 16, alignItems: "flex-start", overflowX: "auto", paddingBottom: 20, flex: 1 },
  column: { background: "#F7F5F0", borderTop: "3px solid #C48A2E", borderRadius: "4px 4px 8px 8px", padding: 12, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", flexShrink: 0 },
  columnDragOver: { boxShadow: "0 0 0 2px #C48A2E inset" },
  columnHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  columnTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, letterSpacing: 0.8, textTransform: "uppercase", border: "none", background: "transparent", outline: "none", color: "#6B6E76", width: "85%" },
  columnDelete: { background: "transparent", border: "none", color: "#B0AEA5", cursor: "pointer", display: "flex", alignItems: "center" },
  cardStack: { display: "flex", flexDirection: "column", gap: 8 },
  card: { background: "#fff", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 1px 3px rgba(35,38,43,0.08)", cursor: "grab", border: "1px solid #E4E1D7" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  checkLabel: { display: "flex", alignItems: "flex-start", gap: 7, cursor: "pointer", flex: 1 },
  checkbox: { marginTop: 3, cursor: "pointer", flexShrink: 0 },
  cardText: { fontSize: 13.5, lineHeight: 1.4, color: "#23262B" },
  cardTextDone: { textDecoration: "line-through", color: "#A8A59B" },
  cardDelete: { background: "transparent", border: "none", color: "#C4C1B6", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" },
  assigneeSelect: { border: "1px solid #E4E1D7", borderRadius: 5, background: "transparent", fontSize: 11.5, color: "#6B6E76", outline: "none", padding: "4px 6px", fontFamily: "'Inter', system-ui, sans-serif", width: "100%", boxSizing: "border-box" },
  assigneeReadonly: { fontSize: 11.5, color: "#6B6E76", padding: "4px 2px", fontStyle: "italic" },
  assigneeReadonlyHint: { fontSize: 10.5, color: "#A8A59B", fontStyle: "italic", lineHeight: 1.4 },
  durationPill: { alignSelf: "flex-start", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, padding: "3px 7px", borderRadius: 10, background: "#EFEDE6", color: "#6B6E76" },
  durationOverdue: { background: "#FBE7E4", color: "#B4402C" },
  durationDueSoon: { background: "#FCF0DA", color: "#9A6A15" },
  addCardRow: { marginTop: 2, display: "flex", flexDirection: "column", gap: 6 },
  addCardInput: { width: "100%", border: "1px dashed #D4D0C3", borderRadius: 6, padding: "8px 10px", fontSize: 13, background: "transparent", outline: "none", fontFamily: "'Inter', system-ui, sans-serif", boxSizing: "border-box" },
  durationRow: { display: "flex", gap: 6 },
  durationInput: { width: 60, border: "1px solid #D4D0C3", borderRadius: 6, padding: "6px 8px", fontSize: 12, outline: "none", boxSizing: "border-box" },
  durationSelect: { border: "1px solid #D4D0C3", borderRadius: 6, padding: "6px 4px", fontSize: 12, outline: "none", background: "#fff", color: "#23262B" },
  durationAddBtn: { flex: 1, border: "none", borderRadius: 6, background: "#C48A2E", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 500 },
  addColumnBtn: { minWidth: 140, height: 44, border: "1px dashed #C7C3B6", background: "transparent", borderRadius: 8, color: "#8B8D93", fontSize: 13, cursor: "pointer", alignSelf: "flex-start", flexShrink: 0 },
  noteWrap: { display: "flex", flexDirection: "column", gap: 6, height: "100%", maxWidth: 720 },
  noteTitle: { fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 600, border: "none", background: "transparent", outline: "none", color: "#23262B" },
  noteMeta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#A8A59B", marginBottom: 10 },
  noteBody: { flex: 1, border: "none", outline: "none", background: "transparent", resize: "none", fontSize: 15.5, lineHeight: 1.7, color: "#23262B", fontFamily: "'Inter', system-ui, sans-serif" },

  fab: { position: "fixed", bottom: 22, right: 22, width: 52, height: 52, borderRadius: "50%", background: "#C48A2E", color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(196,138,46,0.45)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 40 },
  memberPanel: { position: "fixed", bottom: 86, right: 22, width: 230, background: "#1B2430", color: "#E7E5DE", borderRadius: 10, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 40, display: "flex", flexDirection: "column", gap: 10 },
  memberPanelTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#9CA0A8" },
  memberList: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" },
  memberRow: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, padding: "4px 6px", borderRadius: 5, background: "rgba(255,255,255,0.04)" },
  memberDelete: { background: "transparent", border: "none", color: "#8B8D93", cursor: "pointer", display: "flex", alignItems: "center" },
  memberAddRow: { display: "flex", flexDirection: "column", gap: 6 },
  memberInput: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "6px 8px", color: "#fff", fontSize: 13, outline: "none" },
  memberAddBtn: { background: "#5B7553", color: "#fff", border: "none", borderRadius: 5, padding: "7px 0", fontSize: 12.5, cursor: "pointer", fontWeight: 500 },

  bellBtn: { position: "fixed", top: 14, right: 14, width: 42, height: 42, borderRadius: "50%", background: "#1B2430", color: "#fff", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 50 },
  bellBadge: { position: "absolute", top: -3, right: -3, background: "#B4402C", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" },
  notifPanel: { position: "fixed", top: 62, right: 14, width: 290, maxHeight: 380, overflowY: "auto", background: "#1B2430", color: "#E7E5DE", borderRadius: 10, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 50, display: "flex", flexDirection: "column", gap: 10 },
  notifTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#9CA0A8" },
  notifEmpty: { fontSize: 12.5, color: "#8B8D93", fontStyle: "italic" },
  notifGroup: { display: "flex", flexDirection: "column", gap: 5 },
  notifGroupLabelOverdue: { fontSize: 11, fontWeight: 600, color: "#E38585" },
  notifGroupLabelSoon: { fontSize: 11, fontWeight: 600, color: "#E3B570" },
  notifItem: { background: "rgba(255,255,255,0.05)", borderRadius: 7, padding: "8px 10px", cursor: "pointer" },
  notifItemText: { fontSize: 12.5, marginBottom: 2 },
  notifItemMeta: { fontSize: 10.5, color: "#9CA0A8" },

  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(20,20,20,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  modalBox: { background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 340, boxShadow: "0 12px 32px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", gap: 16 },
  modalMessage: { fontSize: 14.5, lineHeight: 1.5, color: "#23262B" },
  modalActions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  modalCancel: { background: "transparent", border: "1px solid #D4D0C3", color: "#6B6E76", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  modalConfirm: { background: "#B4402C", border: "none", color: "#fff", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontWeight: 500 },
};
