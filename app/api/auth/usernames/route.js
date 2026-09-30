import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { listAccounts } from "../../../../lib/kv";
import { errorMessage } from "../../../../lib/apiError";

// Admin & operator bisa melihat daftar username (tanpa role/password) —
// needed to tag "anggota terlibat" on cards and to build team rosters.
export async function GET(request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    // Submitter bukan bagian tim media: tidak ikut daftar tim terlibat/roster,
    // dan tidak boleh melihat daftar akun.
    if (user.role === "submitter") return NextResponse.json({ usernames: [] });
    const accounts = await listAccounts();
    return NextResponse.json({ usernames: accounts.filter((a) => a.role !== "submitter").map((a) => a.username) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
