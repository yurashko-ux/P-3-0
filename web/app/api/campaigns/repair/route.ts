// web/app/api/campaigns/repair/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { Campaign, Target } from "@/lib/types";
import { getPipelineName, getStatusName } from "@/lib/keycrm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function ok(payload: any) {
  return NextResponse.json(payload, { status: 200 });
}

async function getIdsArray(): Promise<string[]> {
  const arr = await kv.get<string[] | null>(IDS_KEY);
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

// Одноразово читаємо можливий list, лише для міграції
async function getIdsListOnce(): Promise<string[]> {
  try {
    const list = await kv.lrange<string>(IDS_KEY, 0, -1);
    return Array.isArray(list) ? list.filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function setIdsArray(ids: string[]) {
  await kv.set(IDS_KEY, ids);
}

async function enrichNames(b?: Target): Promise<Target | undefined> {
  if (!b || !b.pipeline || !b.status) return b;
  const pipelineName =
    b.pipelineName ?? (await getPipelineName(b.pipeline)).toString();
  const statusName =
    b.statusName ?? (await getStatusName(b.pipeline, b.status)).toString();
  return { ...b, pipelineName, statusName };
}

async function enrichItemNames(item: Campaign): Promise<Campaign> {
  const [base, t1, t2, texp] = await Promise.all([
    enrichNames(item.base),
    enrichNames(item.t1),
    enrichNames(item.t2),
    enrichNames(item.texp),
  ]);
  return { ...item, base, t1, t2, texp };
}

function uniquePreserve<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const key = String(it);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

// GET /api/campaigns/repair?secret=ADMIN_PASS
export async function GET(req: NextRequest) {
  const secret =
    req.nextUrl.searchParams.get("secret") ||
    req.headers.get("x-admin-pass") ||
    "";

  if (!process.env.ADMIN_PASS || secret !== process.env.ADMIN_PASS) {
    return unauthorized();
  }

  // 1) Зчитуємо існуючий масив + можливий list (міграція одноразово)
  const arrIds = await getIdsArray();
  const listIds = await getIdsListOnce(); // лише для злиття, list далі не використовуємо
  const mergedIds = uniquePreserve<string>([...arrIds, ...listIds]);

  // 2) Завантажуємо елементи, фільтруємо неіснуючі
  const items = await kv.mget<Campaign | null>(
    ...mergedIds.map((id) => ITEM_KEY(id))
  );

  const existing: Campaign[] = [];
  const deadIds: string[] = [];

  mergedIds.forEach((id, i) => {
    const it = items?.[i];
    if (it && typeof it === "object") existing.push(it as Campaign);
    else deadIds.push(id);
  });

  // 3) Добиваємо назви, якщо бракує, і зберігаємо назад
  let enriched = 0;
  for (const it of existing) {
    const needEnrich =
      (!!it.base && (!it.base.pipelineName || !it.base.statusName)) ||
      (!!it.t1 && (!it.t1.pipelineName || !it.t1.statusName)) ||
      (!!it.t2 && (!it.t2.pipelineName || !it.t2.statusName)) ||
      (!!it.texp && (!it.texp.pipelineName || !it.texp.statusName));
    if (needEnrich) {
      const updated = await enrichItemNames(it);
      await kv.set(ITEM_KEY(it.id), updated);
      enriched++;
    }
  }

  // 4) Сортуємо за createdAt (спадання) й пишемо КАНОНІЧНИЙ МАСИВ JSON
  const sorted = [...existing].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );
  const finalIds = sorted.map((x) => x.id);
  await setIdsArray(finalIds);

  // 5) Репорт
  return ok({
    ok: true,
    totals: {
      before: { arr: arrIds.length, list: listIds.length, merged: mergedIds.length },
      existing: existing.length,
      removedBrokenIds: deadIds.length,
      enrichedItems: enriched,
      finalIds: finalIds.length,
    },
    sample: finalIds.slice(0, 10),
  });
}

// POST /api/campaigns/repair -> така сама логіка, щоб можна було дернути з форми
export async function POST(req: NextRequest) {
  return GET(req);
}
