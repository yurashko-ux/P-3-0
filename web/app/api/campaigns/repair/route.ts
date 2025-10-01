// web/app/api/campaigns/repair/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  unwrapDeep, uniqIds, normalizeId, normalizeCampaign, type Campaign
} from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const IDS_RO = "cmp:list:ids:RO";
const IDS_WR = "cmp:list:ids:WR";

async function readList(key: string): Promise<any[]> {
  const v = await kv.get<any>(key);
  const arr = unwrapDeep<any[]>(v) as any[];
  return Array.isArray(arr) ? arr : [];
}

async function writeList(key: string, ids: string[]) {
  await kv.set(key, ids);
}

async function readItem(id: string): Promise<any> {
  return await kv.get<any>(`cmp:item:${id}`);
}

async function writeItem(id: string, value: any) {
  await kv.set(`cmp:item:${id}`, value);
}

async function repair(apply = false) {
  const before = { ro: await readList(IDS_RO), wr: await readList(IDS_WR) };
  const roNorm = uniqIds(before.ro);
  const wrNorm = uniqIds(before.wr);
  const allIds = uniqIds([...roNorm, ...wrNorm]);

  const changedItems: string[] = [];
  const itemsBefore: Record<string, any> = {};
  const itemsAfter: Record<string, Campaign> = {};

  for (const idRaw of allIds) {
    const id = normalizeId(idRaw);
    const raw = await readItem(id);
    itemsBefore[id] = raw;

    const fixed = normalizeCampaign(raw ?? { id });
    fixed.id = id;
    itemsAfter[id] = fixed;

    const beforeJson = JSON.stringify(unwrapDeep(raw ?? {}));
    const afterJson = JSON.stringify(fixed);
    if (beforeJson !== afterJson) {
      changedItems.push(id);
      if (apply) await writeItem(id, fixed);
    }
  }

  const listsChanged: string[] = [];
  if (JSON.stringify(before.ro) !== JSON.stringify(roNorm)) {
    listsChanged.push(IDS_RO);
    if (apply) await writeList(IDS_RO, roNorm);
  }
  if (JSON.stringify(before.wr) !== JSON.stringify(wrNorm)) {
    listsChanged.push(IDS_WR);
    if (apply) await writeList(IDS_WR, wrNorm);
  }

  return {
    apply,
    totals: {
      idsRO_before: before.ro.length,
      idsRO_after: roNorm.length,
      idsWR_before: before.wr.length,
      idsWR_after: wrNorm.length,
      items_scanned: allIds.length,
      items_changed: changedItems.length,
    },
    listsChanged,
    changedItems,
    sample: allIds.slice(0, 5).map((id) => ({
      id,
      before: unwrapDeep(itemsBefore[id]),
      after: itemsAfter[id],
    })),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const apply = searchParams.get("apply") === "1";
  const result = await repair(apply);
  return NextResponse.json(result);
}

export async function POST() {
  const result = await repair(true);
  return NextResponse.json(result);
}
