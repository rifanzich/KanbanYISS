import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser, signSession, buildSessionCookie } from "../../../../../lib/auth";
import { deleteAccount, getAccount, saveAccount, renameAccount, migratePersonalKeys, renameInSharedRoster } from "../../../../../lib/kv";
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

// Edits an existing account's username and/or password. Renaming migrates
// that person's personal data and any shared-workspace roster entries so
// nothing gets orphaned.
export async function PATCH(request, { params }) {
  try {
    const user = getSessionUser(request);
    if (!user || user.role !== "admin") {
      return NextResponse.json({ error: "Hanya admin yang bisa mengakses ini." }, { status: 403 });
    }
    const oldUsername = decodeURIComponent(params.username);
    const existing = await getAccount(oldUsername);
    if (!existing) {
      return NextResponse.json({ error: "Akun tidak ditemukan." }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const newUsernameRaw = typeof body.newUsername === "string" ? body.newUsername.trim() : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const wantsRename = newUsernameRaw && newUsernameRaw !== oldUsername;

    let finalUsername = oldUsername;
    let account = existing;

    if (wantsRename) {
      const clash = await getAccount(newUsernameRaw);
      if (clash) {
        return NextResponse.json({ error: "Username sudah digunakan." }, { status: 409 });
      }
      await renameAccount(oldUsername, newUsernameRaw);
      await migratePersonalKeys(oldUsername, newUsernameRaw);
      await renameInSharedRoster(oldUsername, newUsernameRaw);
      finalUsername = newUsernameRaw;
      account = { ...existing, username: finalUsername };
    }

    if (newPassword) {
      account = { ...account, passwordHash: await bcrypt.hash(newPassword, 10) };
    }

    if (wantsRename || newPassword) {
      await saveAccount(account);
    }

    const res = NextResponse.json({ account: { username: finalUsername, role: account.role } });

    // Editing your own account: reissue the session cookie so the new
    // username takes effect immediately instead of logging you out.
    if (user.username === oldUsername && finalUsername !== oldUsername) {
      const token = signSession({ username: finalUsername, role: account.role });
      const cookie = buildSessionCookie(token);
      res.cookies.set(cookie.name, cookie.value, cookie);
    }

    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
