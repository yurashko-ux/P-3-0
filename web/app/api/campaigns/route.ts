// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;

function kv(path: string, init?: RequestInit) {
  return fetch(`${KV_URL}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });
}

export async function GET() {
  if (!KV_URL || !KV_TOKEN) {
    return NextResponse.json([], { status: 200 });
  }

  // ids: Set(campaigns)
  const idsRes = await kv('smembers/campaigns:index');
  const idsJson = await idsRes.json();
  const ids: string[] = idsJson?.result ?? [];
  if (ids.length === 0) return NextResponse.json([]);

  // mget items
  const mgetRes = await kv(`mget/${ids.map((id) => `campaigns:${id}`).join('/')}`);
  const mgetJson = await mgetRes.json();
  const items = (mgetJson?.result as (string | null)[]).map((raw) => (raw ? JSON.parse(raw) : null)).filter(Boolean);

  return NextResponse.json(items);
}
