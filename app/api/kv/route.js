import { NextResponse } from "next/server";
import { getSessionUser } from "../../../lib/auth";
import { storageGet, storageSet, storageDelete, canAccessSharedKey } from "../../../lib/kv";
import { errorMessage } from "../../../lib/apiError";

export async function GET(request) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const shared = searchParams.get("shared") === "true";
    if (!key) return NextResponse.json({ error: "key wajib diisi." }, { status: 400 });
    if (shared && !(await canAccessSharedKey(key, user))) {
      return NextResponse.json({ error: "Kamu belum terdaftar sebagai anggota ruang tim ini." }, { status: 403 });
    }
    const value = await storageGet(key, shared, user.username);
    if (value === null || value === undefined) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ key, value });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const { key, value, shared } = body;
    if (!key) return NextResponse.json({ error: "key wajib diisi." }, { status: 400 });
    if (shared && !(await canAccessSharedKey(key, user))) {
      return NextResponse.json({ error: "Kamu belum terdaftar sebagai anggota ruang tim ini." }, { status: 403 });
    }
    await storageSet(key, value, !!shared, user.username);
    return NextResponse.json({ key, value });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const shared = searchParams.get("shared") === "true";
    if (!key) return NextResponse.json({ error: "key wajib diisi." }, { status: 400 });
    if (shared && !(await canAccessSharedKey(key, user))) {
      return NextResponse.json({ error: "Kamu belum terdaftar sebagai anggota ruang tim ini." }, { status: 403 });
    }
    await storageDelete(key, shared, user.username);
    return NextResponse.json({ key, deleted: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
