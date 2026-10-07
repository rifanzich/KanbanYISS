"use client";
import { useState } from "react";
import { PROGRESS_STEPS } from "../lib/requestProgress";

// Potongan UI yang dipakai bersama oleh portal pengaju (SubmitterPortal) dan
// daftar Pengajuan Masuk milik tim media (RequestsInbox).

export function LogoMark({ size = 22 }) {
  return <img src="/logo-mark.png" width={size} height={size} alt="Kanban" style={{ objectFit: "contain", flexShrink: 0, display: "block" }} />;
}

export const STAGE_COLOR = {
  waiting: "#F59E0B",
  accepted: "#3B82F6",
  doing: "#8B5CF6",
  done: "#10B981",
  removed: "#9CA3AF",
  cancelled: "#EF4444",
  unknown: "#9CA3AF",
};

export function formatDateID(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// "YYYY-MM-DD" -> "12 Okt 2026" (dibaca sebagai tanggal lokal, bukan UTC).
export function formatDateInput(str) {
  if (!str) return "";
  const [y, m, d] = str.split("-").map(Number);
  return formatDateID(new Date(y, m - 1, d).getTime());
}

export function safeHref(url) {
  return typeof url === "string" && /^https?:\/\/\S+$/i.test(url) ? url : null;
}

export function durationLabel(duration) {
  if (!duration || !duration.amount) return "";
  return `${duration.amount} ${duration.unit}`;
}

// Nomor antrian tetap milik pengajuan (mis. "A-012").
export function formatQueueNo(n) {
  return n ? `A-${String(n).padStart(3, "0")}` : "";
}

export function StatusPill({ progress }) {
  const color = STAGE_COLOR[progress.stage] || STAGE_COLOR.unknown;
  return (
    <span style={{ ...rq.pill, color, background: `${color}22`, borderColor: `${color}55` }}>
      <span style={{ ...rq.pillDot, background: color }} />
      {progress.label}
    </span>
  );
}

export function ProgressTrack({ progress, compact }) {
  const color = STAGE_COLOR[progress.stage] || STAGE_COLOR.unknown;
  const dead = progress.stage === "removed" || progress.stage === "unknown" || progress.stage === "cancelled";
  return (
    <div style={{ ...rq.track, marginTop: compact ? 8 : 14 }} aria-label={`Progres: ${progress.label}`}>
      {PROGRESS_STEPS.map((label, i) => {
        const reached = !dead && i <= progress.step;
        const isCurrent = !dead && i === progress.step;
        return (
          <div key={label} style={rq.trackStep}>
            <div style={rq.trackRail}>
              <div style={{ ...rq.trackBar, opacity: i === 0 ? 0 : 1, background: reached ? color : "var(--card-border)" }} />
              <div
                style={{
                  ...rq.trackDot,
                  background: reached ? color : "var(--surface-strong)",
                  borderColor: reached ? color : "var(--input-border)",
                  boxShadow: isCurrent ? `0 0 0 4px ${color}33` : "none",
                }}
              >
                {reached && <span style={rq.trackCheck}>✓</span>}
              </div>
              <div style={{ ...rq.trackBar, opacity: i === PROGRESS_STEPS.length - 1 ? 0 : 1, background: !dead && i < progress.step ? color : "var(--card-border)" }} />
            </div>
            <div style={{ ...rq.trackLabel, color: reached ? "var(--text-primary)" : "var(--text-faint)", fontWeight: isCurrent ? 700 : 500 }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Menyalin teks ke clipboard. Memakai Clipboard API, dengan cadangan untuk
// halaman non-HTTPS / browser lama. Mengembalikan true bila berhasil.
export async function copyText(text) {
  const value = String(text || "");
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

// Tombol kecil "Salin" — berubah jadi "Tersalin" sesaat setelah berhasil.
export function CopyButton({ text, label = "Salin", style }) {
  const [state, setState] = useState("idle"); // idle | done | fail
  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(text);
    setState(ok ? "done" : "fail");
    setTimeout(() => setState("idle"), 1800);
  };
  return (
    <button type="button" onClick={onClick} style={{ ...rq.copyBtn, ...(style || {}) }} title="Salin teks ke clipboard">
      {state === "done" ? "✓ Tersalin" : state === "fail" ? "Gagal menyalin" : label}
    </button>
  );
}

// Teks yang boleh diblok & disalin (menimpa user-select:none milik kartu papan).
export const selectableText = { userSelect: "text", WebkitUserSelect: "text", WebkitTouchCallout: "default", cursor: "text" };

export const rq = {
  copyBtn: { display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 600, color: "#3B82F6", background: "transparent", border: "1px solid rgba(59,130,246,0.4)", borderRadius: 6, padding: "2px 9px", cursor: "pointer", lineHeight: 1.5 },
  pill: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: "1px solid", whiteSpace: "nowrap" },
  pillDot: { width: 6, height: 6, borderRadius: "50%" },
  track: { display: "flex", width: "100%" },
  trackStep: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 },
  trackRail: { display: "flex", alignItems: "center", width: "100%" },
  trackBar: { flex: 1, height: 3, borderRadius: 2 },
  trackDot: { width: 18, height: 18, borderRadius: "50%", border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxSizing: "border-box" },
  trackCheck: { color: "#fff", fontSize: 10, lineHeight: 1, fontWeight: 800 },
  trackLabel: { fontSize: 11, textAlign: "center", lineHeight: 1.25 },
  chip: { fontSize: 11, padding: "3px 9px", borderRadius: 12, background: "rgba(59,130,246,0.14)", color: "#3B82F6", border: "1px solid rgba(59,130,246,0.3)", fontWeight: 600 },
  metaText: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 },
  queueBadge: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: "#3B82F6", background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)", borderRadius: 6, padding: "2px 8px", letterSpacing: 0.3, whiteSpace: "nowrap" },
  urgentBadge: { fontSize: 10.5, fontWeight: 700, color: "#EF4444", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 999, padding: "2px 8px", letterSpacing: 0.3 },
  desc: { fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word", ...selectableText },
  link: { fontSize: 12.5, color: "#3B82F6", wordBreak: "break-all", ...selectableText },
};
