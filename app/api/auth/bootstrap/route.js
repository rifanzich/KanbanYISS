import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/auth";
import { countAccounts } from "../../../../lib/kv";
import { errorMessage } from "../../../../lib/apiError";

export async function GET(request) {
  try {
    const user = getSessionUser(request);
    const total = await countAccounts();
    return NextResponse.json({ hasAccounts: total > 0, user });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
