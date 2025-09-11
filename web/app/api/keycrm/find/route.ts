// web/app/api/keycrm/find/route.ts
import { NextResponse } from "next/server";
import { findCardSimple } from "@/lib/keycrm-find";

export const dynamic = "force-dynamic";

/**
 * GET /api/keycrm/find?username=kolachnyk.v&full_name=Viktoria%20Kolachnyk
 * Параметри:
 *   scope=campaign|global            (default: global)
 *   pipeline_id=<num>&status_id=<num>  // якщо scope=campaign
 *   max_pages=3&page_size=50
 *   strategy=social|title|both       (default: both)
 *   title_mode=exact|contains        (default: exact)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (k: string) => url.searchParams.get(k) || undefined;

    const username = q("username")?.trim();
    const full_name = q("full_name")?.trim();

    const pipeline_id = q("pipeline_id") ? Number(q("pipeline_id")) : undefined;
    const status_id   = q("status_id") ? Number(q("status_id")) : undefined;

    const max_pages = q("max_pages") ? Math.max(1, Number(q("max_pages"))) : 3;
    const page_size = q("page_size") ? Math.max(1, Number(q("page_size"))) : 50;

    const strategy   = (q("strategy") as "social" | "title" | "both") || "both";
    const title_mode = (q("title_mode") as "exact" | "contains") || "exact";
    const scope      = (q("scope") as "campaign" | "global" | undefined) || "global";

    const res = await findCardSimple({
      username,
      full_name,
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
