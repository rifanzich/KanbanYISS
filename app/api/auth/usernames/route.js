import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { listAccounts } from "../../../../lib/kv";
import { errorMessage } from "../../../../lib/apiError";

// Any authenticated user can see the list of usernames (no roles/passwords) —
// needed to tag "anggota terlibat" on cards and to build team rosters.
export async function GET(request) {
  try {
    const user = getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const accounts = await listAccounts();
    return NextResponse.json({ usernames: accounts.map((a) => a.username) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
