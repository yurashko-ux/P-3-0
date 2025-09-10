// app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { kcFindCardIdInBase } from "@/lib/keycrm";
import { getActiveCampaign } from "@/lib/campaigns"; // має повертати { base: { pipeline_id, status_id }, ... }

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // нормалізація полів ManyChat
    const username: string =
      body?.username || body?.ig_username || body?.user || "";
    const fullname: string =
      body?.full_name || body?.fullName || body?.fullname || body?.name || "";
    const text: string = body?.text ?? "";

    // беремо лише БАЗОВУ воронку/статус активної кампанії
    const campaign = await getActiveCampaign();
    const scope = {
      pipeline_id: Number(campaign?.base?.pipeline_id),
      status_id: Number(campaign?.base?.status_id),
    };

    // шукаємо ТІЛЬКИ у base
    const found = await kcFindCardIdInBase({ username, fullname, scope });

    return NextResponse.json({
      ok: true,
      via: "manychat",
      normalized: { username, text, fullname },
      ingest: { ...found, scope },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
