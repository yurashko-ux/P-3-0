// web/app/api/campaigns/debug/route.ts
// Швидка діагностика KV для кампаній
import { NextResponse } from "next/server";
import { kvGet, kvZrevrange } from "../../../../lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = {
      KV_REST_API_URL: !!process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    };

    const ids = await kvZrevrange("campaigns:index", 0, 50);
    const first = ids[0] ? await kvGet(`campaigns:${ids[0]}`) : null;

    return NextResponse.json(
      { ok: true, env, indexCount: ids.length, ids, first },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "debug failed" }, { status: 500 });
  }
}
