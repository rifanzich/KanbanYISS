"use client";
import { useState } from "react";
import { RefreshCw, Inbox, Check } from "lucide-react";
import { deriveProgress, progressGroup } from "../lib/requestProgress";
import { StatusPill, ProgressTrack, formatDateID, formatDateInput, formatQueueNo, safeHref, rq } from "./requestUi";

const FILTERS = [
  { key: "waiting", label: "Belum diterima" },
  { key: "active", label: "Berjalan" },
  { key: "done", label: "Selesai" },
  { key: "all", label: "Semua" },
];

// Daftar pekerjaan yang diajukan orang di luar tim media. Setiap operator
// bisa menerima pekerjaan; siapa pun yang menerima otomatis tercatat di
// "Tim terlibat" pada kartunya di papan.
export default function RequestsInbox({ requests, intakeConfig, isAdmin, currentUsername, wsData, localIsIntake, refreshing, onRefresh, onToggleAccept, onOpenIntakeWs }) {
  const [filter, setFilter] = useState("waiting");

  // Bila ruang penerima sedang dibuka, pakai data lokal (lebih baru daripada
  // hasil server yang baru menyusul setelah penyimpanan).
  // Pengajuan yang kartunya sudah dihapus tim langsung disembunyikan (server ikut menghapusnya).
  const rows = requests
    .map((r) => ({
      r,
      p: localIsIntake && intakeConfig ? deriveProgress(r, wsData, intakeConfig.boardId) : r.progress,
    }))
    .filter((x) => x.p.stage !== "removed");
  const groupOf = (row) => progressGroup(row.p);
  const counts = {
    waiting: rows.filter((x) => groupOf(x) === "waiting").length,
    active: rows.filter((x) => groupOf(x) === "active").length,
    done: rows.filter((x) => groupOf(x) === "done").length,
    all: rows.length,
  };
  const visible = rows.filter((x) => filter === "all" || groupOf(x) === filter);

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <h1 style={s.title}>Pengajuan Masuk</h1>
          <p style={s.sub}>Pekerjaan yang diajukan dari luar tim media. Terima pekerjaan untuk ikut mengerjakannya — kartunya sudah otomatis ada di papan to-do.</p>
        </div>
        <button style={s.ghostBtn} onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={13} style={refreshing ? { animation: "rq-spin 0.8s linear infinite" } : undefined} /> Segarkan
        </button>
      </div>

      {intakeConfig ? (
        <div style={s.infoBar}>
          Pengajuan masuk ke papan <strong>{intakeConfig.boardName || "—"}</strong> di ruang <strong>{intakeConfig.workspaceName || "—"}</strong>.
        </div>
      ) : (
        <div style={s.warnBar}>
          {isAdmin
            ? "Papan penerima pengajuan belum diatur. Buka sebuah papan di ruang kerja Tim, lalu klik “Jadikan papan penerima pengajuan”. Selama belum diatur, pengajuan hanya tersimpan dan belum muncul di papan."
            : "Admin belum menentukan papan penerima pengajuan. Pengajuan tetap tersimpan dan akan masuk ke papan setelah diatur."}
        </div>
      )}

      <div style={s.filterRow}>
        {FILTERS.map((f) => (
          <button key={f.key} style={{ ...s.filterBtn, ...(filter === f.key ? s.filterBtnActive : {}) }} onClick={() => setFilter(f.key)}>
            {f.label} <span style={s.filterCount}>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={s.emptyCard}>
          <Inbox size={26} style={{ color: "var(--text-faint)" }} />
          <div style={s.emptyTitle}>{rows.length === 0 ? "Belum ada pengajuan" : "Tidak ada pengajuan di kategori ini"}</div>
        </div>
      ) : (
        <div style={s.list}>
          {visible.map(({ r, p }) => {
            const href = safeHref(r.link);
            const mine = (p.team || []).includes(currentUsername);
            return (
              <article key={r.id} style={{ ...s.item, ...(r.urgent && p.stage !== "done" ? s.itemUrgent : {}) }}>
                <div style={s.itemTop}>
                  <div style={{ minWidth: 0 }}>
                    <div style={s.itemTitleRow}>
                      {r.queueNo ? <span style={rq.queueBadge} title="Nomor antrian">#{formatQueueNo(r.queueNo)}</span> : null}
                      <h3 style={s.itemTitle}>{r.title}</h3>
                      {r.urgent && <span style={rq.urgentBadge}>MENDESAK</span>}
                    </div>
                    <div style={rq.metaText}>
                      Dari <strong>{r.submitter}</strong> · {formatDateID(r.createdAt)}
                      {r.cardType ? ` · ${r.cardType}${r.qty > 1 ? ` × ${r.qty}` : ""}` : r.qty > 1 ? ` · ${r.qty} item` : ""}
                      {r.neededBy ? ` · Dibutuhkan ${formatDateInput(r.neededBy)}` : ""}
                    </div>
                  </div>
                  <StatusPill progress={p} />
                </div>

                {(r.description || href) && (
                  <details style={s.details}>
                    <summary style={s.summary}>Detail permintaan</summary>
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

                <ProgressTrack progress={p} compact />

                <div style={s.footer}>
                  <div style={s.teamRow}>
                    {p.team && p.team.length > 0 ? (
                      <>
                        <span style={rq.metaText}>Tim terlibat</span>
                        {p.team.map((m) => (
                          <span key={m} style={rq.chip}>
                            {m}
                          </span>
                        ))}
                      </>
                    ) : (
                      <span style={rq.metaText}>{p.stage === "cancelled" ? "Dibatalkan oleh pengaju." : "Belum ada yang menerima"}</span>
                    )}
                  </div>
                  <AcceptControl p={p} mine={mine} intakeConfig={intakeConfig} localIsIntake={localIsIntake} onToggle={() => onToggleAccept(r)} onOpenIntakeWs={onOpenIntakeWs} />
                </div>
              </article>
            );
          })}
        </div>
      )}
      <style>{`@keyframes rq-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AcceptControl({ p, mine, intakeConfig, localIsIntake, onToggle, onOpenIntakeWs }) {
  if (p.stage === "removed" || p.stage === "cancelled") return null;
  if (!intakeConfig) return <span style={rq.metaText}>Papan penerima belum diatur</span>;
  if (!localIsIntake) {
    return (
      <button style={s.secondaryBtn} onClick={onOpenIntakeWs} title="Menerima pekerjaan dilakukan di ruang penerima pengajuan. Membukanya juga memasukkan pengajuan baru ke papan.">
        Buka ruang penerima untuk menerima
      </button>
    );
  }
  if (!p.inBoard) return <span style={rq.metaText}>Sedang dimasukkan ke papan…</span>;
  return mine ? (
    <button style={s.acceptedBtn} onClick={onToggle} title="Klik untuk membatalkan penerimaan">
      <Check size={14} /> Kamu menerima ini · Batalkan
    </button>
  ) : (
    <button style={s.acceptBtn} onClick={onToggle}>
      Terima pekerjaan
    </button>
  );
}

const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 },
  head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-primary)" },
  sub: { margin: "6px 0 0", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 560 },
  ghostBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid var(--card-border)", color: "var(--text-muted)", borderRadius: 8, padding: "6px 11px", fontSize: 12, cursor: "pointer" },
  infoBar: { fontSize: 12.5, color: "#2563EB", background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 8, padding: "9px 12px", lineHeight: 1.5 },
  warnBar: { fontSize: 12.5, color: "#B45309", background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, padding: "9px 12px", lineHeight: 1.5 },
  filterRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  filterBtn: { background: "var(--surface-solid)", border: "1px solid var(--card-border)", color: "var(--text-muted)", borderRadius: 999, padding: "6px 13px", fontSize: 12.5, cursor: "pointer" },
  filterBtnActive: { background: "#3B82F6", borderColor: "#3B82F6", color: "#fff", fontWeight: 600 },
  filterCount: { opacity: 0.75, marginLeft: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  item: { background: "var(--surface-solid)", border: "1px solid var(--card-border)", borderRadius: 14, padding: "15px 18px" },
  itemUrgent: { borderColor: "rgba(239,68,68,0.4)" },
  itemTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  itemTitleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 },
  itemTitle: { margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)", wordBreak: "break-word" },
  details: { marginTop: 10 },
  summary: { fontSize: 12.5, color: "#3B82F6", cursor: "pointer", fontWeight: 500 },
  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 14 },
  teamRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  acceptBtn: { background: "#10B981", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  acceptedBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(16,185,129,0.14)", color: "#10B981", border: "1px solid rgba(16,185,129,0.4)", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  secondaryBtn: { background: "transparent", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.5)", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  emptyCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", background: "var(--surface-solid)", border: "1px dashed var(--input-border)", borderRadius: 14, padding: "40px 20px" },
  emptyTitle: { fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" },
};
