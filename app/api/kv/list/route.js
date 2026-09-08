import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { storageListKeys } from "../../../../lib/kv";
import { errorMessage } from "../../../../lib/apiError";

export async function GET(request) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get("prefix") || "";
    const shared = searchParams.get("shared") === "true";
    const keys = await storageListKeys(prefix, shared, user.username);
    return NextResponse.json({ keys, prefix });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
