// Validasi isian pengajuan (dipakai bersama oleh pembuatan dan pengeditan).
const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
const isHttpUrl = (s) => /^https?:\/\/\S+$/i.test(s);

// Mengembalikan { error } atau { value }.
export function parseRequestInput(body) {
  const b = body || {};
  const title = String(b.title || "").trim();
  const cardType = String(b.cardType || "").trim();
  const description = String(b.description || "").trim();
  const link = String(b.link || "").trim();
  const neededBy = String(b.neededBy || "").trim();
  const qtyNum = Math.floor(Number(b.qty));
  const qty = qtyNum >= 1 && qtyNum <= 999 ? qtyNum : 1;

  if (!title) return { error: "Judul pekerjaan wajib diisi." };
  if (title.length > 140) return { error: "Judul maksimal 140 karakter." };
  if (cardType.length > 80) return { error: "Jenis pekerjaan terlalu panjang." };
  if (description.length > 2000) return { error: "Detail maksimal 2000 karakter." };
  if (link && (link.length > 300 || !isHttpUrl(link))) return { error: "Link harus diawali http:// atau https:// (maks. 300 karakter)." };
  if (neededBy && !isDateStr(neededBy)) return { error: "Format tanggal tidak valid." };

  return { value: { title, cardType, qty, description, link, neededBy, urgent: !!b.urgent } };
}
