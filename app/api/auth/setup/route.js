import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signSession, buildSessionCookie } from "../../../../lib/auth";
import { countAccounts, saveAccount } from "../../../../lib/kv";
import { errorMessage } from "../../../../lib/apiError";

export async function POST(request) {
  try {
    const total = await countAccounts();
    if (total > 0) {
      return NextResponse.json({ error: "Akun admin sudah pernah dibuat." }, { status: 409 });
    }
    const body = await request.json().catch(() => ({}));
    const username = (body.username || "").trim();
    const password = body.password || "";
    if (!username || !password) {
      return NextResponse.json({ error: "Isi username dan kata sandi." }, { status: 400 });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const account = { username, passwordHash, role: "admin" };
    await saveAccount(account);

    const token = signSession({ username, role: "admin" });
    const res = NextResponse.json({ user: { username, role: "admin" } });
    res.cookies.set(buildSessionCookie(token));
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
