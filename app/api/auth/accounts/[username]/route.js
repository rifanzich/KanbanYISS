import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../../lib/auth";
import { deleteAccount } from "../../../../../lib/kv";
import { errorMessage } from "../../../../../lib/apiError";

export async function DELETE(request, { params }) {
  try {
    const user = getSessionUser(request);
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Hanya admin yang bisa mengakses ini." }, { status: 403 });
    }
    const username = decodeURIComponent(params.username);
    await deleteAccount(username);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
