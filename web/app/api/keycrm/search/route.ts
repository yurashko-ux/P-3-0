// web/app/api/keycrm/search/route.ts
import { NextResponse } from "next/server";
import { kcFindCardIdByAny } from "@/lib/keycrm";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username") || undefined;
  const fullName = url.searchParams.get("full_name") || url.searchParams.get("fullname") || undefined;

  const result = await kcFindCardIdByAny({ username, fullName });
  return NextResponse.json({ ok: result.ok, result, username, fullName });
}
