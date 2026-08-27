import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { countAccounts } from "../../../../lib/kv";

export async function GET(request) {
  const user = getSessionUser(request);
  const total = await countAccounts();
  return NextResponse.json({ hasAccounts: total > 0, user });
}
