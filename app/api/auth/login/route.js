import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signSession, buildSessionCookie } from "../../../../lib/auth";
import { getAccount } from "../../../../lib/kv";
import { errorMessage } from "../../../../lib/apiError";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = (body.username || "").trim();
    const password = body.password || "";
    const account = await getAccount(username);
    if (!account) {
      return NextResponse.json({ error: "Username atau kata sandi salah." }, { status: 401 });
    }
    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Username atau kata sandi salah." }, { status: 401 });
    }
    const token = signSession({ username: account.username, role: account.role });
    const res = NextResponse.json({ user: { username: account.username, role: account.role } });
    res.cookies.set(buildSessionCookie(token));
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
