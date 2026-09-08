import jwt from "jsonwebtoken";

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET wajib diatur di environment variable production!");
    }
    return "dev-only-insecure-secret-change-me";
  }
  return secret;
}

const COOKIE_NAME = "ruang_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function signSession(user) {
  return jwt.sign({ username: user.username, role: user.role }, getAuthSecret(), { expiresIn: MAX_AGE_SECONDS });
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, getAuthSecret());
    return { username: payload.username, role: payload.role };
  } catch (e) {
    return null;
  }
}

export function getSessionUser(request) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
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
