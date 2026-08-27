import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser } from "../../../../lib/auth";
import { listAccounts, getAccount, saveAccount } from "../../../../lib/kv";

export async function GET(request) {
  const user = getSessionUser(request);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Hanya admin yang bisa mengakses ini." }, { status: 403 });
  }
  const accounts = await listAccounts();
  return NextResponse.json({ accounts });
}

export async function POST(request) {
  const user = getSessionUser(request);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Hanya admin yang bisa mengakses ini." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const username = (body.username || "").trim();
  const password = body.password || "";
  const role = body.role === "admin" ? "admin" : "member";
  if (!username || !password) {
    return NextResponse.json({ error: "Isi username dan kata sandi." }, { status: 400 });
  }
  const existing = await getAccount(username);
  if (existing) {
    return NextResponse.json({ error: "Username sudah digunakan." }, { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await saveAccount({ username, passwordHash, role });
  return NextResponse.json({ account: { username, role } });
}
