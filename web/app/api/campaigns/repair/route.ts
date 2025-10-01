// web/app/api/campaigns/repair/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  unwrapDeep,
  normalizeCampaign,
  normalizeId,
  uniqIds,
  type Campaign,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const kvAny = kv as any;

// Допоміжне читання масиву id з KV (може бути string/json/{value}/list)
async function readIdList(key: string): Promise<string[]> {
  try {
    const raw = await kv.get(key as any);
    const arr = unwrapDeep(raw);
    if (Array.isArray(arr)) return uniqIds(arr);
    return uniqIds([arr]);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("WRONGTYPE")) {
      try {
        const list = await (kvAny?.lrange?.(key, 0, -1) as Promise<any[] | null>);
        return uniqIds(Array.isArray(list) ? list : []);
      } catch {
        return [];
      }
    }
    return [];
  }
}

// Читання item по id з різними можливими типами збереження
async function readItemById(id: string): Promise<unknown | null> {
  const k = `cmp:item:${id}`;
  try {
    const v = await kv.get(k as any);
    const u = unwrapDeep(v);
    if (u == null) return null;
    return u;
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("WRONGTYPE")) {
      // пробуємо як hash
      try {
        const h = await (kvAny?.hgetall?.(k) as Promise<Record<string, any> | null>);
        if (h && typeof h === "object") return h;
      } catch {}
      // пробуємо як список (беремо перший елемент)
      try {
        const list = await (kvAny?.lrange?.(k, 0, 0) as Promise<any[] | null>);
        if (Array.isArray(list) && list.length) return unwrapDeep(list[0]);
      } catch {}
    }
    return null;
  }
}

export async function GET() {
  // 1) збираємо всі id з RO/WR
  const idsRO = await readIdList("cmp:list:ids:RO");
  const idsWR = await readIdList("cmp:list:ids:WR");
  const ids = uniqIds([...idsRO, ...idsWR]).filter(Boolean);

  // 2) читаємо items
  const items: Campaign[] = [];
  for (const rawId of ids) {
    const id = normalizeId(rawId);
    const raw = await readItemById(id);
    if (raw == null) continue;
    const norm = normalizeCampaign({ id, ...(unwrapDeep(raw) as any) });
    if (norm?.id) items.push(norm);
  }

  // 3) оновлюємо індекси (перезаписуємо уніфіковані списки)
  await kv.set("cmp:list:ids:RO", idsRO);
  await kv.set("cmp:list:ids:WR", idsWR);

  return NextResponse.json({
    ok: true,
    repaired: items.length,
    idsTotal: ids.length,
    sample: items.slice(0, 5),
  });
}

export async function POST() {
  return GET();
}
