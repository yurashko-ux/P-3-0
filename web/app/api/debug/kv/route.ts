// web/app/api/debug/kv/route.ts
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { unwrapDeep } from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const ro = unwrapDeep<any[]>(await kv.get('cmp:list:ids:RO')) ?? [];
  const wr = unwrapDeep<any[]>(await kv.get('cmp:list:ids:WR')) ?? [];
  const campaigns = unwrapDeep<any>(await kv.get('campaigns'));

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    env: {
      KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
      KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
      KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
    },
    idsRO: ro,
    idsWR: wr,
    sample: Array.isArray(ro)
      ? ro.slice(0, 3).map((id) => ({ id, active: false }))
      : [],
    seeded: campaigns ? true : null,
  });
}
