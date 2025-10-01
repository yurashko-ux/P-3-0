// web/app/api/campaigns/delete/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pull(listKey: string, id: string) {
  const kvAny = kv as any;
  try {
    if (typeof kvAny?.lrem === "function") {
      // якщо це Redis list
      await kvAny.lrem(listKey, 0, id);
      return;
    }
  } catch {}
  // якщо зберігалося як масив
  const cur = await kv.get(listKey as any);
  const arr = Array.isArray(cur) ? cur : [];
  const next = arr.filter((x: any) => String(x) !== id);
  await kv.set(listKey, next);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const id = String(form?.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });

  await kv.del(`cmp:item:${id}`);
  await pull("cmp:list:ids:RO", id);
  await pull("cmp:list:ids:WR", id);

  return NextResponse.json({ ok: true, deleted: id });
}
