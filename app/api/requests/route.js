import { NextResponse } from "next/server";
import { getSessionUser } from "../../../lib/auth";
import { listRequests, saveRequest, newRequestId, nextQueueNo, ensureQueueNumbers, deleteRequest, getIntakeConfig, attachProgress } from "../../../lib/requests";
import { errorMessage } from "../../../lib/apiError";
import { parseRequestInput } from "../../../lib/requestInput";

// Pengaju (submitter) hanya melihat pengajuannya sendiri; admin & operator
// melihat semuanya. Progres selalu dihitung dari kartu di papan tim media.
export async function GET(request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });
    const staff = user.role !== "submitter";

    let all = await ensureQueueNumbers(await listRequests());
    const config = await getIntakeConfig();
    // Progres dihitung untuk semua pengajuan agar "antrian di depan" akurat.
    const attached = await attachProgress(all, config);

    // Kartu yang dihapus tim media dari papan -> pengajuannya ikut dihapus otomatis
    // (hilang dari dashboard submitter dan Pengajuan Masuk).
    // Pengajuan yang sudah "dihapus" submitter disimpan sementara sampai kartunya benar-benar
    // hilang dari papan (dihapus oleh klien operator), lalu dibersihkan.
    const gone = attached.requests.filter((r) => r.progress.stage === "removed" || (r.hiddenBySubmitter && r.progress.inBoard === false));
    const goneIds = new Set(gone.map((r) => r.id));
    for (const r of gone) await deleteRequest(r.id);
    let list = attached.requests.filter((r) => !goneIds.has(r.id));

    // Submitter tidak melihat yang sudah dihapusnya; operator tetap menerimanya di respons
    // agar kartu yang dibatalkan bisa dibersihkan dari papan (Pengajuan Masuk menyembunyikannya).
    if (!staff) list = list.filter((r) => !r.hiddenBySubmitter);
    if (!staff) list = list.filter((r) => r.submitter === user.username);
    list.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({ requests: list, cardTypes: attached.cardTypes, config: staff ? config : undefined });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = parseRequestInput(body);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { title, cardType, qty, description, link, neededBy } = parsed.value;

    const req = {
      id: newRequestId(),
      title,
      cardType,
      qty,
      description,
      link,
      neededBy,
      urgent: parsed.value.urgent,
      submitter: user.username,
      createdAt: Date.now(),
      queueNo: await nextQueueNo(),
      ingested: null,
    };
    await saveRequest(req);
    const config = await getIntakeConfig();
    const { requests } = await attachProgress([req], config);
    return NextResponse.json({ request: requests[0] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
