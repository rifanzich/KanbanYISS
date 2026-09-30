// Jenis akun: admin, operator (dulu "anggota"/member), dan submitter (pengaju
// dari luar tim media). Akun lama yang tersimpan dengan role "member"
// otomatis dianggap "operator", jadi tidak perlu migrasi data manual.
export const ROLE_ADMIN = "admin";
export const ROLE_OPERATOR = "operator";
export const ROLE_SUBMITTER = "submitter";
export const VALID_ROLES = [ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUBMITTER];

export const ROLE_LABEL = {
  admin: "Admin",
  operator: "Operator",
  submitter: "Submitter",
};

export function normalizeRole(role) {
  if (role === ROLE_ADMIN) return ROLE_ADMIN;
  if (role === ROLE_SUBMITTER) return ROLE_SUBMITTER;
  return ROLE_OPERATOR; // "operator", "member" (lama), atau nilai tak dikenal
}

// Untuk input dari form: null kalau tidak valid.
export function parseRoleInput(role) {
  if (VALID_ROLES.includes(role)) return role;
  if (role === "member") return ROLE_OPERATOR;
  return null;
}

// Admin & operator = tim media (punya akses ke ruang kerja).
export function isStaffRole(role) {
  return role === ROLE_ADMIN || role === ROLE_OPERATOR;
}
