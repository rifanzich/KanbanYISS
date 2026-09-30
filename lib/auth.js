import jwt from "jsonwebtoken";
import { getAccount } from "./kv";
import { normalizeRole } from "./roles";

const SECRET = process.env.AUTH_SECRET || "dev-only-insecure-secret-change-me";
const COOKIE_NAME = "ruang_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function signSession(user) {
  return jwt.sign({ username: user.username, role: normalizeRole(user.role) }, SECRET, { expiresIn: MAX_AGE_SECONDS });
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    return { username: payload.username, role: normalizeRole(payload.role) };
  } catch (e) {
    return null;
  }
}

// Sesi divalidasi ke data akun terbaru (bukan hanya isi token), supaya
// perubahan jenis akun atau penghapusan akun langsung berlaku tanpa
// menunggu cookie 30 hari habis.
export async function getSessionUser(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySession(token);
  if (!payload) return null;
  const account = await getAccount(payload.username);
  if (!account) return null;
  return { username: account.username, role: normalizeRole(account.role) };
}

export function buildSessionCookie(token) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

export function buildLogoutCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  };
}
