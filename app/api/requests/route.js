import { NextResponse } from "next/server";
import { getSessionUser } from "../../../lib/auth";
import { listRequests, saveRequest, newRequestId, nextQueueNo, ensureQueueNumbers, deleteRequest, getIntakeConfig, attachProgress } from "../../../lib/requests";
import { errorMessage } from "../../../lib/apiError";

const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
const isHttpUrl = (s) => /^https?:\/\/\S+$/i.test(s);

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
    const gone = attached.requests.filter((r) => r.progress.stage === "removed");
    for (const r of gone) await deleteRequest(r.id);
    let list = attached.requests.filter((r) => r.progress.stage !== "removed");

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
    const title = String(body.title || "").trim();
    const cardType = String(body.cardType || "").trim();
    const description = String(body.description || "").trim();
    const link = String(body.link || "").trim();
    const neededBy = String(body.neededBy || "").trim();
    const qtyNum = Math.floor(Number(body.qty));
    const qty = qtyNum >= 1 && qtyNum <= 999 ? qtyNum : 1;

    if (!title) return NextResponse.json({ error: "Judul pekerjaan wajib diisi." }, { status: 400 });
    if (title.length > 140) return NextResponse.json({ error: "Judul maksimal 140 karakter." }, { status: 400 });
    if (cardType.length > 80) return NextResponse.json({ error: "Jenis pekerjaan terlalu panjang." }, { status: 400 });
    if (description.length > 2000) return NextResponse.json({ error: "Detail maksimal 2000 karakter." }, { status: 400 });
    if (link && (link.length > 300 || !isHttpUrl(link))) {
      return NextResponse.json({ error: "Link harus diawali http:// atau https:// (maks. 300 karakter)." }, { status: 400 });
    }
    if (neededBy && !isDateStr(neededBy)) return NextResponse.json({ error: "Format tanggal tidak valid." }, { status: 400 });

    const req = {
      id: newRequestId(),
      title,
      cardType,
      qty,
      description,
      link,
      neededBy,
      urgent: !!body.urgent,
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
