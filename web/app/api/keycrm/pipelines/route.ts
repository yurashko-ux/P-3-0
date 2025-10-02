// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from "next/server";
import { assertKeycrmEnv, keycrmHeaders, keycrmUrl } from "@/lib/env";

export const runtime = "nodejs";

type RawPipeline = any;
type RawStatus = any;

type UnifiedStatus = { id: string; name: string };
type UnifiedPipeline = { id: string; name: string; statuses: UnifiedStatus[] };

const idOf = (o: any) =>
  String(o?.id ?? o?.uuid ?? o?._id ?? o?.slug ?? "").trim();
const nameOf = (o: any) =>
  String(o?.name ?? o?.title ?? o?.label ?? "").trim();

function unifyPipeline(p: RawPipeline) {
  return { id: idOf(p), name: nameOf(p) };
}
function unifyStatus(s: RawStatus) {
  return { id: idOf(s), name: nameOf(s) };
}

export async function GET() {
  try {
    assertKeycrmEnv();

    // 1) тягнемо всі воронки
    const rp = await fetch(keycrmUrl("/pipelines"), {
      headers: keycrmHeaders(),
      cache: "no-store",
    });
    if (!rp.ok) {
      const text = await rp.text();
      throw new Error(`Pipelines fetch failed: ${rp.status} ${text}`);
    }
    const pJson = await rp.json();
    const rawPipes: RawPipeline[] = Array.isArray(pJson)
      ? pJson
      : Array.isArray(pJson?.data)
      ? pJson.data
      : Array.isArray(pJson?.items)
      ? pJson.items
      : [];

    const unified: UnifiedPipeline[] = [];

    // 2) по кожній воронці — дотягуємо статуси
    for (const rp of rawPipes) {
      const { id, name } = unifyPipeline(rp);
      if (!id) continue;

      const rs = await fetch(keycrmUrl(`/pipelines/${encodeURIComponent(id)}/statuses`), {
        headers: keycrmHeaders(),
        cache: "no-store",
      });

      let statuses: UnifiedStatus[] = [];
      if (rs.ok) {
        const sJson = await rs.json();
        const rawStatuses: RawStatus[] = Array.isArray(sJson)
          ? sJson
          : Array.isArray(sJson?.data)
          ? sJson.data
          : Array.isArray(sJson?.items)
          ? sJson.items
          : [];
        statuses = rawStatuses.map(unifyStatus).filter(s => s.id && s.name);
      } else {
        // якщо у KeyCRM ваш тариф/дані не повертають статуси окремим ендпоінтом
        // — не падаємо, лишаємо порожній список
      }

      unified.push({ id, name, statuses });
    }

    return NextResponse.json({ ok: true, items: unified });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "KEYCRM_FETCH_FAILED" },
      { status: 500 }
    );
  }
}
