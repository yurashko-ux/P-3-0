// web/app/api/keycrm/sync/diag/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRange } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = {
      KEYCRM_API_TOKEN: !!process.env.KEYCRM_API_TOKEN,
      KEYCRM_BASE_URL: (process.env.KEYCRM_BASE_URL || "https://openapi.keycrm.app/v1"),
      KV_REST_API_URL: !!process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
      ADMIN_PASS_SET: !!process.env.ADMIN_PASS,
    };

    const ids = await kvZRange("campaigns:index", 0, -1);
    const campaigns: any[] = [];
    const pairs: Array<{ pipeline_id: number; status_id: number; id: string; name: string; enabled: boolean }> = [];

    for (const id of ids) {
      const raw = await kvGet(`campaigns:${id}`);
      if (!raw) continue;
      try {
        const c = JSON.parse(raw);
        campaigns.push(c);
        const p = Number(c.base_pipeline_id);
        const s = Number(c.base_status_id);
        if (c.enabled && Number.isFinite(p) && Number.isFinite(s)) {
          pairs.push({ pipeline_id: p, status_id: s, id: c.id, name: c.name, enabled: true });
        }
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      env,
      index_len: ids.length,
      campaign_count: campaigns.length,
      pairs_count: pairs.length,
      pairs,
      sample_campaigns: campaigns.slice(0, 5),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "diag_failed" }, { status: 200 });
  }
}
