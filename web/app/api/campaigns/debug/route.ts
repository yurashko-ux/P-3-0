// web/app/api/campaigns/debug/route.ts
import { NextResponse } from "next/server";
import { kvGet, kvZRevRange } from "@/lib/kv";
import { assertAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  // Перевіримо адмін-логін, але навіть якщо ні — покажемо мінімум,
  // щоб зрозуміти де «ламається»
  let auth = false;
  try {
    await assertAdmin(req);
    auth = true;
  } catch (_) {
    auth = false;
  }

  try {
    const ids = (await kvZRevRange("campaigns:index", 0, -1)) ?? [];
    const items: any[] = [];

    // якщо не авторизовані — повернемо лише ідентифікатори (без чутливих полів)
    if (!auth) {
      return NextResponse.json(
        { ok: true, auth, count: ids.length, ids },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    for (const id of ids) {
      const raw = await kvGet(`campaigns:${id}`).catch(() => null);
      if (!raw) continue;
      const c: any = raw;

      items.push({
        id: c.id,
        name: c.name,
        created_at: c.created_at ?? null,
        active: !!c.active,
        base_pipeline_id: c.base_pipeline_id ?? null,
        base_status_id: c.base_status_id ?? null,
        v1: {
          pipeline_id: c.rules?.v1?.to_pipeline_id ?? c.v1_pipeline_id ?? null,
          status_id: c.rules?.v1?.to_status_id ?? c.v1_status_id ?? null,
          value: c.rules?.v1?.value ?? "",
        },
        v2: {
          pipeline_id: c.rules?.v2?.to_pipeline_id ?? c.v2_pipeline_id ?? null,
          status_id: c.rules?.v2?.to_status_id ?? c.v2_status_id ?? null,
          value: c.rules?.v2?.value ?? "",
        },
        exp: {
          days: c.rules?.exp?.days ?? c.exp_days ?? null,
          to_pipeline_id:
            c.rules?.exp?.to_pipeline_id ?? c.exp_to_pipeline_id ?? null,
          to_status_id:
            c.rules?.exp?.to_status_id ?? c.exp_to_status_id ?? null,
        },
      });
    }

    return NextResponse.json(
      { ok: true, auth, count: items.length, items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, auth, error: String(err?.message ?? err) },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}
