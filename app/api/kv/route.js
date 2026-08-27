import { NextResponse } from "next/server";
import { getSessionUser } from "../../../lib/auth";
import { storageGet, storageSet, storageDelete } from "../../../lib/kv";

export async function GET(request) {
  const user = getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const shared = searchParams.get("shared") === "true";
  if (!key) return NextResponse.json({ error: "key wajib diisi." }, { status: 400 });
  const value = await storageGet(key, shared, user.username);
  if (value === null || value === undefined) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ key, value });
}

export async function POST(request) {
  const user = getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { key, value, shared } = body;
  if (!key) return NextResponse.json({ error: "key wajib diisi." }, { status: 400 });
  await storageSet(key, value, !!shared, user.username);
  return NextResponse.json({ key, value });
}

export async function DELETE(request) {
  const user = getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const shared = searchParams.get("shared") === "true";
  if (!key) return NextResponse.json({ error: "key wajib diisi." }, { status: 400 });
  await storageDelete(key, shared, user.username);
  return NextResponse.json({ key, deleted: true });
}
