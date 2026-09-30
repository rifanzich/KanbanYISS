import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser, signSession, buildSessionCookie } from "../../../../../lib/auth";
import { deleteAccount, getAccount, saveAccount, renameAccount, migratePersonalKeys, renameInSharedRoster } from "../../../../../lib/kv";
import { errorMessage } from "../../../../../lib/apiError";
import { parseRoleInput } from "../../../../../lib/roles";
import { renameRequestSubmitter } from "../../../../../lib/requests";

export async function DELETE(request, { params }) {
  try {
    const user = await getSessionUser(request);
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
    const user = await getSessionUser(request);
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

    // Ganti jenis akun (admin / operator / submitter). Admin tidak bisa
    // mengubah jenis akunnya sendiri supaya portal tidak pernah kehilangan admin.
    const newRole = body.newRole ? parseRoleInput(body.newRole) : null;
    if (body.newRole && !newRole) {
      return NextResponse.json({ error: "Jenis akun tidak dikenal." }, { status: 400 });
    }
    const wantsRoleChange = !!newRole && newRole !== existing.role;
    if (wantsRoleChange && user.username === oldUsername) {
      return NextResponse.json({ error: "Kamu tidak bisa mengubah jenis akunmu sendiri." }, { status: 400 });
    }

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
      await renameRequestSubmitter(oldUsername, newUsernameRaw);
      finalUsername = newUsernameRaw;
      account = { ...existing, username: finalUsername };
    }

    if (newPassword) {
      account = { ...account, passwordHash: await bcrypt.hash(newPassword, 10) };
    }

    if (wantsRoleChange) {
      account = { ...account, role: newRole };
    }

    if (wantsRename || newPassword || wantsRoleChange) {
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
