// /app/api/campaigns/seed/route.ts
import { NextResponse } from 'next/server';
import { kvPushId, kvSetItem } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST() {
  const now = Date.now().toString();
  const id = now;
  const payload = {
    name: 'UI-created',
    base: { pipeline: '#—', status: '#—' },
    v1: { rule: null, value: null },
    v2: { rule: null, value: null },
    counters: { v1: 0, v2: 0, exp: 0 },
  };
  await kvSetItem(id, payload);
  await kvPushId(id);
  return NextResponse.json({ ok: true, id });
}
