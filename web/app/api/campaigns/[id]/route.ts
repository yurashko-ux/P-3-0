// web/app/api/campaigns/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDS_KEY = "cmp:ids";
const IDS_LIST_KEY = "cmp:ids:list";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;
const unique = (a:string[]) => Array.from(new Set(a.filter(Boolean)));

async function readIdsMerged(): Promise<string[]> {
  const arr = (await kv.get<string[] | null>(IDS_KEY)) ?? [];
  let list: string[] = [];
  try { list = await kv.lrange<string>(IDS_LIST_KEY, 0, -1); } catch {}
  return unique([...(Array.isArray(arr)?arr:[]), ...(Array.isArray(list)?list:[])]);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!id) return NextResponse.json({ ok:false, error:"no id" }, { status:400 });

  await kv.del(ITEM_KEY(id)).catch(()=>null);
  const merged = await readIdsMerged();
  const next = unique(merged.filter(x => x !== id));
  await kv.set(IDS_KEY, next);

  return new NextResponse(null, { status: 204 });
}
