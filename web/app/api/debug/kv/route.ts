// web/app/api/debug/kv/route.ts
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { unwrapDeep } from "@/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const env = {
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  const ro = unwrapDeep<any[]>(await kv.get("cmp:list:ids:RO")) ?? [];
  const wr = unwrapDeep<any[]>(await kv.get("cmp:list:ids:WR")) ?? [];

  return NextResponse.json({
    ok: true,
    env,
    idsRO_len: ro.length,
    idsWR_len: wr.length,
    idsRO_sample: ro.slice(0, 3),
    idsWR_sample: wr.slice(0, 3),
  });
}
