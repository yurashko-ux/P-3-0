// web/app/api/debug/kv/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { unwrapDeep } from "@/lib/normalize";

export const runtime = "nodejs";

export async function GET() {
  const now = new Date().toISOString();

  const env = {
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
  };

  // ЖОДНИХ дженеріків у unwrapDeep — лише просте розпакування
  const roRaw = await kv.get("cmp:list:ids:RO");
  const wrRaw = await kv.get("cmp:list:ids:WR");

  const idsRO = (unwrapDeep(roRaw) as any[]) ?? [];
  const idsWR = (unwrapDeep(wrRaw) as any[]) ?? [];

  // Для зручності — зробимо маленьку "вітрину" вибірки
  const sample = (idsWR.length ? idsWR : idsRO)
    .slice(0, 1)
    .map((id) => ({ id, active: false }));

  return NextResponse.json({
    ok: true,
    time: now,
    env,
    idsRO,
    idsWR,
    sample,
    seeded: null,
  });
}
