import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { getRequest, saveRequest, getIntakeConfig } from "../../../../lib/requests";
import { requestCardId } from "../../../../lib/requestProgress";
import { errorMessage } from "../../../../lib/apiError";

// Dipanggil klien admin/operator setelah kartu pengajuan berhasil masuk ke
// papan penerima (dan tersimpan). Menandai pengajuan sebagai "sudah masuk
// papan" — sehingga kalau kartunya nanti dihapus tim, kartu tidak dibuat ulang.
export async function POST(request) {
  try {
    const user = await getSessionUser(request);
    if (!user || user.role === "submitter") {
      return NextResponse.json({ error: "Hanya admin atau operator yang bisa mengakses ini." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const config = await getIntakeConfig();
    if (!config || body.workspaceId !== config.workspaceId || body.boardId !== config.boardId) {
      return NextResponse.json({ error: "Papan penerima pengajuan tidak cocok atau belum diatur." }, { status: 409 });
    }
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    let marked = 0;
    for (const it of items) {
      if (!it || typeof it.id !== "string" || !/^\d{4}-\d{2}$/.test(String(it.monthKey || ""))) continue;
      const req = await getRequest(it.id);
      if (!req || req.ingested || req.cancelledAt) continue;
      await saveRequest({
        ...req,
        ingested: { workspaceId: config.workspaceId, boardId: config.boardId, monthKey: it.monthKey, cardId: requestCardId(req.id), at: Date.now() },
      });
      marked += 1;
    }
    return NextResponse.json({ ok: true, marked });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
