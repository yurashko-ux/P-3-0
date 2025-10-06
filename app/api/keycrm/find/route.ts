// app/api/keycrm/find/route.ts
import { NextResponse } from "next/server";
import { findCardSimple } from "@/lib/keycrm-find";
import { getActiveCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

/**
 * GET /api/keycrm/find?social_id=kolachnyk.v&full_name=Viktoria%20Kolachnyk
 *   [optional] pipeline_id=1&status_id=38
 *   [optional] max_pages=3&page_size=50
 *   [optional] strategy=social|full_name|both (default: both)
 *   [optional] title_mode=exact|contains (default: exact)
 *   [optional] scope=campaign|global (default: campaign якщо є активна, інакше global)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (k: string) => url.searchParams.get(k) || undefined;

    const social_id = q("social_id")?.trim() || undefined;
    const full_name = q("full_name")?.trim();
    const social_name = q("social_name")?.trim();

    let pipeline_id = q("pipeline_id") ? Number(q("pipeline_id")) : undefined;
    let status_id = q("status_id") ? Number(q("status_id")) : undefined;

    const max_pages = q("max_pages") ? Math.max(1, Number(q("max_pages"))) : 3;
    const page_size = q("page_size") ? Math.max(1, Number(q("page_size"))) : 50;
    const strategy = (q("strategy") as "social" | "full_name" | "both") || "both";
    const title_mode = (q("title_mode") as "exact" | "contains") || "exact";
    let scope = (q("scope") as "campaign" | "global" | undefined) || undefined;

    // якщо scope не задано — беремо з активної кампанії
    if (!scope) {
      const active = await getActiveCampaign();
      scope = active ? "campaign" : "global";
      if (active && (!pipeline_id || !status_id)) {
        pipeline_id = pipeline_id ?? active.base?.pipeline_id;
        status_id = status_id ?? active.base?.status_id;
      }
    }

    const res = await findCardSimple({
      social_id,
      full_name,
      social_name,
      pipeline_id,
      status_id,
      max_pages,
      page_size,
      strategy,
      title_mode,
      scope,
    });

    return NextResponse.json(res, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: err?.message || String(err) },
      { status: 200 }
    );
  }
}
