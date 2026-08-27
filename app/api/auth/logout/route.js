import { NextResponse } from "next/server";
import { buildLogoutCookie } from "../../../../lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(buildLogoutCookie());
  return res;
}
