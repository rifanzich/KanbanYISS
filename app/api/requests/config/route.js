import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { getIntakeConfig, saveIntakeConfig, getSharedWorkspace } from "../../../../lib/requests";
import { errorMessage } from "../../../../lib/apiError";

export async function GET(request) {
  try {
    const user = await getSessionUser(request);
    if (!user || user.role === "submitter") {
      return NextResponse.json({ error: "Hanya admin atau operator yang bisa mengakses ini." }, { status: 403 });
    }
    return NextResponse.json({ config: await getIntakeConfig() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// Admin menentukan papan mana (di ruang tim mana) yang menerima pengajuan.
export async function PUT(request) {
  try {
    const user = await getSessionUser(request);
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Hanya admin yang bisa mengatur papan penerima." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId || "");
    const boardId = String(body.boardId || "");
    if (!workspaceId || !boardId) {
      return NextResponse.json({ error: "Ruang kerja dan papan wajib diisi." }, { status: 400 });
    }
    const ws = await getSharedWorkspace(workspaceId);
    if (!ws || ws.mode !== "team") {
      return NextResponse.json({ error: "Papan penerima harus berada di ruang kerja Tim." }, { status: 400 });
    }
    const config = {
      workspaceId,
      boardId,
      workspaceName: String(body.workspaceName || ws.name || "").slice(0, 80),
      boardName: String(body.boardName || "").slice(0, 80),
      setBy: user.username,
      setAt: Date.now(),
    };
    await saveIntakeConfig(config);
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
