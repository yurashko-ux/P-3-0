// app/api/mc/manychat/route.ts
import { NextResponse } from "next/server";
import { kcFindCardIdInBase } from "@/lib/keycrm";
import { getActiveCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = await req.json();

    const username: string =
      b?.username || b?.ig_username || b?.user || "";
    const fullname: string =
      b?.full_name || b?.fullName || b?.fullname || b?.name || "";
    const first_name: string = b?.first_name || "";
    const last_name: string = b?.last_name || "";
    const text: string = b?.text ?? "";

    const campaign = await getActiveCampaign();
    const scope = {
      pipeline_id: Number(campaign?.base?.pipeline_id),
      status_id: Number(campaign?.base?.status_id),
    };

    const found = await kcFindCardIdInBase({
      username,
      fullname,
      first_name,
      last_name,
      scope,
    });

    return NextResponse.json({
      ok: true,
      via: "manychat",
      normalized: { username, text, fullname, first_name, last_name },
      ingest: { ...found, scope },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
