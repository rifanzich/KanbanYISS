import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { storageListKeys, canAccessSharedKey } from "../../../../lib/kv";
import { errorMessage } from "../../../../lib/apiError";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get("prefix") || "";
    const shared = searchParams.get("shared") === "true";
    let keys = await storageListKeys(prefix, shared, user.username);
    if (shared && user.role !== "admin") {
      const allowedKeys = [];
      for (const k of keys) {
        if (await canAccessSharedKey(k, user, "read")) {
          allowedKeys.push(k);
        }
      }
      keys = allowedKeys;
    }
    return NextResponse.json({ keys, prefix });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
