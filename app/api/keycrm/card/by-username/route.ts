// app/api/keycrm/card/by-username/route.ts
import { NextResponse } from "next/server";
import { kcFindCardIdByTitleSmart } from "@/lib/keycrm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") || "").trim();

  if (!username) {
    return NextResponse.json(
      { ok: false, error: "username required" },
      { status: 400 }
    );
  }

  const card_id = await kcFindCardIdByTitleSmart(username);

  return NextResponse.json({
    ok: !!card_id,
    username,
    card_id: card_id ?? null,
  });
}
