import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { getRequest, saveRequest, deleteRequest, getIntakeConfig, attachProgress } from "../../../../lib/requests";
import { errorMessage } from "../../../../lib/apiError";

// Ambil pengajuan milik user yang sedang login (admin/operator tidak lewat sini).
async function loadOwned(request, id) {
  const user = await getSessionUser(request);
  if (!user) return { error: NextResponse.json({ error: "Belum login." }, { status: 401 }) };
  const req = await getRequest(id);
  if (!req || req.submitter !== user.username) {
    return { error: NextResponse.json({ error: "Pengajuan tidak ditemukan." }, { status: 404 }) };
  }
  return { user, req };
}

// Membatalkan pengajuan. Kartunya di papan tim dihapus oleh klien operator yang
// sedang membuka ruang penerima (sama seperti saat kartu dimasukkan).
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const { error, req } = await loadOwned(request, id);
    if (error) return error;
    const body = await request.json().catch(() => ({}));
    if (body.action !== "cancel") return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
    if (req.cancelledAt) return NextResponse.json({ error: "Pengajuan sudah dibatalkan." }, { status: 409 });

    const config = await getIntakeConfig();
    const { requests } = await attachProgress([req], config);
    if (requests[0].progress.stage === "done") {
      return NextResponse.json({ error: "Pekerjaan yang sudah selesai tidak bisa dibatalkan." }, { status: 409 });
    }
    const saved = { ...req, cancelledAt: Date.now() };
    await saveRequest(saved);
    const out = await attachProgress([saved], config);
    return NextResponse.json({ request: out.requests[0] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// Menghapus pengajuan dari dashboard. Hanya untuk pengajuan yang sudah dibatalkan,
// sudah selesai, atau belum sempat masuk papan (tidak punya kartu). Pengajuan yang
// masih berjalan harus dibatalkan dulu, supaya kartunya tidak tertinggal di papan.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { error, req } = await loadOwned(request, id);
    if (error) return error;

    const config = await getIntakeConfig();
    const { requests } = await attachProgress([req], config);
    const stage = requests[0].progress.stage;
    const hasCard = !!req.ingested && !["done", "cancelled", "removed"].includes(stage);
    if (hasCard) {
      return NextResponse.json({ error: "Batalkan pengajuan ini dulu sebelum menghapusnya." }, { status: 409 });
    }
    await deleteRequest(req.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
