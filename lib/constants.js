export const PERSONAL_INDEX_KEY = "ruang-personal-index";
export const SHARED_INDEX_KEY = "ruang-shared-index";
export const dataKey = (id) => `ruang-data-${id}`;

export const DEFAULT_CARD_TYPES = [
  "Video Semenit",
  "Kalam Ulama",
  "Poster Dakwah",
  "Video Dokumentasi/Konten",
  "Poster Kajian/TA",
  "Desain Cetak",
  "Desain Poster Divisi",
];

export const MOOD_COLORS = [
  "#FEF3C7",
  "#DBEAFE",
  "#DCFCE7",
  "#FCE7F3",
  "#EDE9FE",
  "#FFE4E6",
  "#E0F2FE",
  "#FFEDD5",
];

export const MINDMAP_PALETTE = [
  "#3B82F6",
  "#EF4444",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F97316",
];

export const UNIT_MS = { menit: 60000, jam: 3600000, hari: 86400000 };
export const UNIT_LABEL = { menit: "menit", jam: "jam", hari: "hari" };
export const DUE_SOON_MS = 12 * UNIT_MS.jam;

export const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export const COLUMN_DOT_COLORS = [
  "#9CA3AF",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
];

export function columnDotColor(index) {
  return COLUMN_DOT_COLORS[index % COLUMN_DOT_COLORS.length];
}

export const uid = () => Math.random().toString(36).slice(2, 10);
