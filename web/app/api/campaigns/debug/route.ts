// web/app/api/campaigns/debug/route.ts
// Простий API-дебаг: читає індекс кампаній і віддає першу.

import { NextResponse } from "next/server";
import { kvGet, kvZRevRange } from "../../../../lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ids = await kvZRevRange("campaigns:index", 0, 9);
    const first = ids[0] ? await kvGet(`campaigns:${ids[0]}`) : null;
    return NextResponse.json({ ok: true, ids, first });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
