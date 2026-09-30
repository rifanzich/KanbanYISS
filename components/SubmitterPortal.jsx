"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, X, LogOut, Sun, Moon, RefreshCw, Send, Inbox, Trash2 } from "lucide-react";
import { progressGroup } from "../lib/requestProgress";
import { LogoMark, StatusPill, ProgressTrack, formatDateID, formatDateInput, formatQueueNo, safeHref, durationLabel, rq } from "./requestUi";

const FILTERS = [
  { key: "all", label: "Semua" },
  { key: "waiting", label: "Menunggu" },
  { key: "active", label: "Diproses" },
  { key: "done", label: "Selesai" },
  { key: "cancelled", label: "Dibatalkan" },
];

const EMPTY_FORM = { title: "", cardType: "", otherType: "", qty: 1, neededBy: "", urgent: false, description: "", link: "" };

function todayInputValue() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Dashboard khusus akun "submitter": mengajukan pekerjaan ke tim media dan
// memantau progresnya. Tidak menampilkan ruang kerja/papan tim sama sekali.
export default function SubmitterPortal({ user, theme, onToggleTheme, onLogout, fallbackCardTypes }) {
  const [requests, setRequests] = useState([]);
  const [cardTypes, setCardTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [confirm, setConfirm] = useState(null); // { kind: "cancel" | "delete", r }
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async (manual) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/requests", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error || "Gagal memuat pengajuan.");
      } else {
        setRequests(data.requests || []);
        setCardTypes(data.cardTypes || []);
        setLoadError("");
      }
    } catch (e) {
      setLoadError("Tidak bisa terhubung ke server.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => load(false), 30000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const typeOptions = cardTypes.length ? cardTypes : fallbackCardTypes || [];
  const setField = (patch) => setForm((f) => ({ ...f, ...patch }));

  const openForm = () => {
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  };

  const submit = async () => {
    const title = form.title.trim();
    if (!title) {
      setFormError("Judul pekerjaan wajib diisi.");
      return;
    }
    const cardType = form.cardType === "__other" ? form.otherType.trim() : form.cardType;
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title, cardType, qty: form.qty, neededBy: form.neededBy, urgent: form.urgent, description: form.description, link: form.link }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Gagal mengirim pengajuan.");
        return;
      }
      setShowForm(false);
      setToast("Pengajuan terkirim. Tim media akan menerimanya segera.");
      setFilter("all");
      await load(false);
    } catch (e) {
      setFormError("Tidak bisa terhubung ke server.");
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async () => {
    if (!confirm) return;
    const { kind, r } = confirm;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/requests/${r.id}`, {
        method: kind === "cancel" ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: kind === "cancel" ? JSON.stringify({ action: "cancel" }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(data.error || "Aksi gagal dijalankan.");
      } else {
        setToast(kind === "cancel" ? "Pengajuan dibatalkan. Kartunya akan dihapus dari papan tim." : "Pengajuan dihapus.");
      }
      await load(false);
    } catch (e) {
      setToast("Tidak bisa terhubung ke server.");
    } finally {
      setBusyId("");
      setConfirm(null);
    }
  };

  const groups = requests.map((r) => progressGroup(r.progress));
  const counts = {
    all: requests.length,
    waiting: groups.filter((g) => g === "waiting").length,
    active: groups.filter((g) => g === "active").length,
    done: groups.filter((g) => g === "done").length,
    cancelled: groups.filter((g) => g === "cancelled").length,
  };
  const visible = requests.filter((r) => filter === "all" || progressGroup(r.progress) === filter);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brand}>
            <LogoMark size={24} />
            <div>
              <div style={s.brandName}>Kanban YISS</div>
              <div style={s.brandSub}>Portal Pengajuan</div>
            </div>
          </div>
          <div style={s.headerRight}>
            <div style={s.userBox}>
              <span style={s.userName}>{user.username}</span>
              <span style={s.roleBadge}>Submitter</span>
            </div>
            <button style={s.iconBtn} onClick={onToggleTheme} title={theme === "light" ? "Mode gelap" : "Mode terang"} aria-label="Ganti tema">
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <button style={s.iconBtn} onClick={onLogout} title="Keluar" aria-label="Keluar">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <main style={s.content}>
        <div style={s.hero}>
          <div>
            <h1 style={s.h1}>Pengajuan ke Tim Media</h1>
            <p style={s.lead}>Ajukan kebutuhan desain, video, atau konten. Tim media akan menerima pengajuanmu, dan progresnya bisa dipantau di sini.</p>
          </div>
          <button style={s.primaryBtn} onClick={openForm}>
            <Plus size={16} /> Ajukan Pekerjaan
          </button>
        </div>

        {toast && <div style={s.toast}>{toast}</div>}

        <div style={s.statGrid}>
          <StatCard label="Total diajukan" value={counts.all} color="#3B82F6" />
          <StatCard label="Menunggu diterima" value={counts.waiting} color="#F59E0B" />
          <StatCard label="Sedang diproses" value={counts.active} color="#8B5CF6" />
          <StatCard label="Selesai" value={counts.done} color="#10B981" />
        </div>

        <div style={s.listHead}>
          <div style={s.filterRow}>
            {FILTERS.map((f) => (
              <button key={f.key} style={{ ...s.filterBtn, ...(filter === f.key ? s.filterBtnActive : {}) }} onClick={() => setFilter(f.key)}>
                {f.label} <span style={s.filterCount}>{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <button style={s.ghostBtn} onClick={() => load(true)} disabled={refreshing} title="Muat ulang">
            <RefreshCw size={13} style={refreshing ? { animation: "rq-spin 0.8s linear infinite" } : undefined} /> Segarkan
          </button>
        </div>

        {loadError && <div style={s.errorBox}>{loadError}</div>}

        {loading ? (
          <div style={s.empty}>Memuat pengajuan…</div>
        ) : visible.length === 0 ? (
          <div style={s.emptyCard}>
            <Inbox size={28} style={{ color: "var(--text-faint)" }} />
            <div style={s.emptyTitle}>{requests.length === 0 ? "Belum ada pengajuan" : "Tidak ada pengajuan di kategori ini"}</div>
            {requests.length === 0 && <div style={s.emptyText}>Klik “Ajukan Pekerjaan” untuk mengirim permintaan pertamamu ke tim media.</div>}
          </div>
        ) : (
          <div style={s.list}>
            {visible.map((r) => (
              <RequestItem key={r.id} r={r} busy={busyId === r.id} onCancel={() => setConfirm({ kind: "cancel", r })} onDelete={() => setConfirm({ kind: "delete", r })} />
            ))}
          </div>
        )}
      </main>

      {showForm && (
        <div style={s.overlay} onClick={() => !submitting && setShowForm(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Form pengajuan">
            <div style={s.modalHead}>
              <div style={s.modalTitle}>Ajukan Pekerjaan</div>
              <button style={s.iconBtnPlain} onClick={() => setShowForm(false)} aria-label="Tutup">
                <X size={18} />
              </button>
            </div>

            <label style={s.label}>
              Judul pekerjaan <span style={s.req}>*</span>
              <input style={s.input} value={form.title} maxLength={140} placeholder="Contoh: Poster Kajian Ahad Pagi" onChange={(e) => setField({ title: e.target.value })} autoFocus />
            </label>

            <div style={s.row2}>
              <label style={{ ...s.label, flex: 1 }}>
                Jenis pekerjaan
                <select style={s.input} value={form.cardType} onChange={(e) => setField({ cardType: e.target.value })}>
                  <option value="">— Pilih jenis —</option>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value="__other">Lainnya…</option>
                </select>
              </label>
              <label style={{ ...s.label, width: 90 }}>
                Jumlah
                <input style={s.input} type="number" min="1" max="999" value={form.qty} onChange={(e) => setField({ qty: e.target.value })} />
              </label>
            </div>

            {form.cardType === "__other" && (
              <label style={s.label}>
                Sebutkan jenis pekerjaan
                <input style={s.input} value={form.otherType} maxLength={80} placeholder="Jenis pekerjaan yang dibutuhkan" onChange={(e) => setField({ otherType: e.target.value })} />
              </label>
            )}

            <label style={s.label}>
              Dibutuhkan paling lambat
              <input style={s.input} type="date" min={todayInputValue()} value={form.neededBy} onChange={(e) => setField({ neededBy: e.target.value })} />
            </label>

            <label style={s.checkRow}>
              <input type="checkbox" checked={form.urgent} onChange={(e) => setField({ urgent: e.target.checked })} />
              <span>
                <strong>Mendesak</strong> — kartu akan ditandai prioritas di papan tim
              </span>
            </label>

            <label style={s.label}>
              Detail / brief
              <textarea style={{ ...s.input, minHeight: 96, resize: "vertical", fontFamily: "inherit" }} value={form.description} maxLength={2000} placeholder="Jelaskan kebutuhan, ukuran, teks yang dipakai, referensi gaya, dll." onChange={(e) => setField({ description: e.target.value })} />
            </label>

            <label style={s.label}>
              Link referensi / materi (opsional)
              <input style={s.input} type="url" value={form.link} maxLength={300} placeholder="https://drive.google.com/…" onChange={(e) => setField({ link: e.target.value })} />
            </label>

            {formError && <div style={s.errorBox}>{formError}</div>}

            <div style={s.modalActions}>
              <button style={s.cancelBtn} onClick={() => setShowForm(false)} disabled={submitting}>
                Batal
              </button>
              <button style={{ ...s.primaryBtn, opacity: submitting ? 0.7 : 1 }} onClick={submit} disabled={submitting}>
                <Send size={14} /> {submitting ? "Mengirim…" : "Kirim Pengajuan"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <div style={s.overlay} onClick={() => !busyId && setConfirm(null)}>
          <div style={{ ...s.modal, maxWidth: 400 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={s.modalTitle}>{confirm.kind === "cancel" ? "Batalkan pengajuan?" : "Hapus pengajuan?"}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-muted)" }}>
              <strong style={{ color: "var(--text-primary)" }}>{confirm.r.title}</strong>
              <br />
              {confirm.kind === "cancel"
                ? "Kartunya akan dihapus dari papan tim media dan pengajuan ini ditandai dibatalkan."
                : "Pengajuan ini akan dihapus permanen dari dashboardmu."}
            </div>
            <div style={s.modalActions}>
              <button style={s.cancelBtn} onClick={() => setConfirm(null)} disabled={!!busyId}>
                Kembali
              </button>
              <button style={{ ...s.primaryBtn, background: "#EF4444", opacity: busyId ? 0.7 : 1 }} onClick={runAction} disabled={!!busyId}>
                {busyId ? "Memproses…" : confirm.kind === "cancel" ? "Ya, batalkan" : "Ya, hapus"}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes rq-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={s.stat}>
      <div style={{ ...s.statValue, color }}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

function RequestItem({ r, busy, onCancel, onDelete }) {
  const p = r.progress;
  const canCancel = p.stage !== "done" && p.stage !== "cancelled";
  // Yang masih punya kartu di papan harus dibatalkan dulu; sisanya boleh langsung dihapus.
  const canDelete = !canCancel || !r.ingested;
  const href = safeHref(r.link);
  const target = durationLabel(p.duration);
  return (
    <article style={s.item}>
      <div style={s.itemTop}>
        <div style={{ minWidth: 0 }}>
          <div style={s.itemTitleRow}>
            {r.queueNo ? <span style={rq.queueBadge} title="Nomor antrian">#{formatQueueNo(r.queueNo)}</span> : null}
            <h3 style={s.itemTitle}>{r.title}</h3>
            {r.urgent && <span style={rq.urgentBadge}>MENDESAK</span>}
          </div>
          <div style={rq.metaText}>
            Diajukan {formatDateID(r.createdAt)}
            {r.cardType ? ` · ${r.cardType}${r.qty > 1 ? ` × ${r.qty}` : ""}` : r.qty > 1 ? ` · ${r.qty} item` : ""}
            {r.neededBy ? ` · Dibutuhkan ${formatDateInput(r.neededBy)}` : ""}
          </div>
        </div>
        <StatusPill progress={p} />
      </div>

      <ProgressTrack progress={p} />

      <div style={s.teamRow}>
        {p.team && p.team.length > 0 ? (
          <>
            <span style={rq.metaText}>Dikerjakan oleh</span>
            {p.team.map((m) => (
              <span key={m} style={rq.chip}>
                {m}
              </span>
            ))}
          </>
        ) : p.stage === "cancelled" ? (
          <span style={rq.metaText}>Pengajuan ini kamu batalkan.</span>
        ) : (
          <span style={rq.metaText}>Belum ada operator yang menerima pengajuan ini.</span>
        )}
        {r.queueAhead != null && (
          <span style={{ ...rq.metaText, marginLeft: "auto" }}>{r.queueAhead === 0 ? "Antrian terdepan" : `${r.queueAhead} pekerjaan di depan`}</span>
        )}
        {target && p.stage !== "done" && p.stage !== "cancelled" && <span style={{ ...rq.metaText, marginLeft: "auto" }}>Target pengerjaan: {target}</span>}
      </div>

      {(canCancel || canDelete) && (
        <div style={s.actionRow}>
          {canCancel && (
            <button style={s.dangerGhost} onClick={onCancel} disabled={busy}>
              Batalkan
            </button>
          )}
          {canDelete && (
            <button style={s.dangerGhost} onClick={onDelete} disabled={busy}>
              <Trash2 size={12} /> Hapus
            </button>
          )}
        </div>
      )}

      {(r.description || href) && (
        <details style={s.details}>
          <summary style={s.summary}>Lihat detail pengajuan</summary>
          {r.description && <div style={{ ...rq.desc, marginTop: 8 }}>{r.description}</div>}
          {href && (
            <div style={{ marginTop: 8 }}>
              <a href={href} target="_blank" rel="noopener noreferrer" style={rq.link}>
                {r.link}
              </a>
            </div>
          )}
        </details>
      )}
    </article>
  );
}

const s = {
  page: { minHeight: "100vh", background: "var(--app-bg)", color: "var(--text-primary)", fontFamily: "'Inter', system-ui, sans-serif" },
  header: { background: "var(--sidebar-bg)", borderBottom: "1px solid var(--sidebar-border)", position: "sticky", top: 0, zIndex: 20 },
  headerInner: { maxWidth: 960, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  brandName: { fontSize: 15.5, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.1 },
  brandSub: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: "#9CA0A8", marginTop: 2 },
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  userBox: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, marginRight: 4 },
  userName: { fontSize: 13, fontWeight: 500, color: "#EDEDED" },
  roleBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, padding: "2px 7px", borderRadius: 10, background: "rgba(16,185,129,0.22)", color: "#34D399" },
  iconBtn: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#C9C7BF", borderRadius: 6, padding: 7, cursor: "pointer", display: "flex", alignItems: "center" },
  iconBtnPlain: { background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 },

  content: { maxWidth: 960, margin: "0 auto", padding: "28px 20px 60px" },
  hero: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap", marginBottom: 22 },
  h1: { margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" },
  lead: { margin: "6px 0 0", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 520 },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: "#3B82F6", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  cancelBtn: { background: "transparent", border: "1px solid var(--input-border)", color: "var(--text-muted)", borderRadius: 9, padding: "10px 16px", fontSize: 13.5, cursor: "pointer" },
  ghostBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid var(--card-border)", color: "var(--text-muted)", borderRadius: 8, padding: "6px 11px", fontSize: 12, cursor: "pointer" },

  toast: { background: "rgba(16,185,129,0.14)", border: "1px solid rgba(16,185,129,0.4)", color: "#10B981", borderRadius: 9, padding: "10px 14px", fontSize: 13, marginBottom: 16 },
  errorBox: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", color: "#EF4444", borderRadius: 9, padding: "9px 12px", fontSize: 13, marginBottom: 12 },

  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 26 },
  stat: { background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "14px 16px" },
  statValue: { fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 },
  statLabel: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },

  listHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  filterRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  filterBtn: { background: "var(--surface-solid)", border: "1px solid var(--card-border)", color: "var(--text-muted)", borderRadius: 999, padding: "6px 13px", fontSize: 12.5, cursor: "pointer" },
  filterBtnActive: { background: "#3B82F6", borderColor: "#3B82F6", color: "#fff", fontWeight: 600 },
  filterCount: { opacity: 0.75, marginLeft: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 },

  list: { display: "flex", flexDirection: "column", gap: 12 },
  item: { background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 14, padding: "16px 18px" },
  itemTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  itemTitleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 },
  itemTitle: { margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em", wordBreak: "break-word" },
  teamRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 14 },
  actionRow: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  dangerGhost: { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "1px solid rgba(239,68,68,0.4)", color: "#EF4444", borderRadius: 8, padding: "5px 11px", fontSize: 12, cursor: "pointer" },
  details: { marginTop: 12, borderTop: "1px solid var(--card-border)", paddingTop: 10 },
  summary: { fontSize: 12.5, color: "#3B82F6", cursor: "pointer", fontWeight: 500 },

  empty: { textAlign: "center", color: "var(--text-faint)", fontSize: 14, padding: "40px 0" },
  emptyCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", background: "var(--surface-solid)", border: "1px dashed var(--input-border)", borderRadius: 14, padding: "44px 20px" },
  emptyTitle: { fontSize: 15, fontWeight: 600 },
  emptyText: { fontSize: 13, color: "var(--text-muted)", maxWidth: 340, lineHeight: 1.6 },

  overlay: { position: "fixed", inset: 0, background: "var(--modal-overlay)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" },
  modal: { background: "var(--modal-bg)", border: "1px solid var(--card-border)", borderRadius: 16, padding: 22, width: "100%", maxWidth: 520, boxShadow: "0 16px 44px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", gap: 14, margin: "auto 0" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500, color: "var(--text-muted)" },
  req: { color: "#EF4444" },
  input: { background: "var(--input-bg)", border: "1px solid var(--input-border)", borderRadius: 8, padding: "9px 11px", fontSize: 14, color: "var(--text-primary)", outline: "none", width: "100%", boxSizing: "border-box" },
  row2: { display: "flex", gap: 10 },
  checkRow: { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, cursor: "pointer" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 },
};
