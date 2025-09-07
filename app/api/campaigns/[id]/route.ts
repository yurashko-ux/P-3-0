// app/api/campaigns/[id]/route.ts
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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const res = await kv(`get/campaigns:${params.id}`);
  const json = await res.json();
  if (!json?.result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(JSON.parse(json.result));
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const now = new Date().toISOString();
  const campaign = { ...body, id: params.id, updatedAt: now };

  await kv(`set/campaigns:${params.id}/${encodeURIComponent(JSON.stringify(campaign))}`, { method: 'POST' });
  await kv(`sadd/campaigns:index/${params.id}`, { method: 'POST' });

  return NextResponse.json(campaign);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await kv(`del/campaigns:${params.id}`, { method: 'POST' });
  await kv(`srem/campaigns:index/${params.id}`, { method: 'POST' });
  return new NextResponse(null, { status: 204 });
}
