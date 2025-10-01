// web/app/api/debug/kv/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { unwrapDeep } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  const env = {
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  // читаємо індексні ключі як «що завгодно», розпаковуємо до масиву
  const ro = unwrapDeep(await kv.get("cmp:list:ids:RO")) ?? [];
  const wr = unwrapDeep(await kv.get("cmp:list:ids:WR")) ?? [];

  // покажемо по 1-2 «живих» значення для швидкої діагностики
  const sample: any[] = [];
  const ids = [...(Array.isArray(ro) ? ro : [ro]), ...(Array.isArray(wr) ? wr : [wr])].slice(0, 3);

  for (const raw of ids) {
    try {
      const id = typeof raw === "string" ? raw : JSON.stringify(raw);
      const v = await kv.get(`cmp:item:${id}`);
      sample.push({ id, value: unwrapDeep(v), active: false });
    } catch (e: any) {
      sample.push({ id: String(raw), error: String(e?.message || e) });
    }
  }

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    env,
    idsRO: Array.isArray(ro) ? ro : [ro],
    idsWR: Array.isArray(wr) ? wr : [wr],
    sample,
  });
}
