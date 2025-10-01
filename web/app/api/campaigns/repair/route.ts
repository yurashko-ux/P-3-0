// web/app/api/campaigns/repair/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  unwrapDeep,
  uniqIds,
  normalizeId,
  normalizeCampaign,
  type Campaign,
} from "@/lib/normalize";

export const runtime = "nodejs";

// Ключ зберігання масиву кампаній у KV
const LIST_KEY = "campaigns";

/** Прочитати сирий список з KV, акуратно розпакувати */
async function readList(key: string): Promise<any[]> {
  const v = await kv.get<any>(key);
  const arr = unwrapDeep(v) as any[];
  return Array.isArray(arr) ? arr : [];
}

/** Акуратно записати масив у KV */
async function writeList(key: string, value: any[]): Promise<void> {
  await kv.set(key, value);
}

/**
 * GET /api/campaigns/repair
 * - читає список з KV
 * - нормалізує елементи
 * - прибирає дублікати id
 * - повертає результат та перезаписує у KV
 */
export async function GET() {
  // 1) читаємо все як є
  const raw = await readList(LIST_KEY);

  // 2) нормалізація до Campaign
  const normalized: Campaign[] = raw.map((x) => normalizeCampaign(x));

  // 3) уніфікуємо id та прибираємо дублікати
  const order = uniqIds(normalized.map((c) => c.id));
  const byId = new Map<string, Campaign>();
  for (const c of normalized) byId.set(normalizeId(c.id), c);
  const cleaned: Campaign[] = order
    .map((id) => byId.get(id))
    .filter(Boolean) as Campaign[];

  // (не обов'язково) відфільтрувати видалені, якщо треба:
  // const cleaned = tmp.filter(c => !c.deleted);

  // 4) записуємо назад
  await writeList(LIST_KEY, cleaned);

  return NextResponse.json({
    ok: true,
    before: raw.length,
    after: cleaned.length,
    repaired: raw.length - cleaned.length,
    sample: cleaned.slice(0, 3),
  });
}
