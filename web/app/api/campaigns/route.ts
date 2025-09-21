// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function kvSetJSON(key: string, value: any) {
  const base = mustEnv('KV_REST_API_URL');
  const token = mustEnv('KV_REST_API_TOKEN');
  const url = `${base}/set/${encodeURIComponent(key)}/${encodeURIComponent(
    JSON.stringify(value)
  )}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(`Upstash SET failed: ${json?.error || res.statusText}`);
  return json?.result ?? null;
}

async function kvGetJSON<T = any>(key: string): Promise<T | null> {
  const base = mustEnv('KV_REST_API_URL');
  const token = mustEnv('KV_REST_API_TOKEN');
  const url = `${base}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(`Upstash GET failed: ${json?.error || res.statusText}`);
  const raw = json?.result as string | null;
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // якщо колись лежав plain-string
    return raw as unknown as T;
  }
}

async function kvZAdd(key: string, score: number, member: string) {
  const base = mustEnv('KV_REST_API_URL');
  const token = mustEnv('KV_REST_API_TOKEN');
  const url = `${base}/zadd/${encodeURIComponent(key)}/${score}/${encodeURIComponent(member)}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(`Upstash ZADD failed: ${json?.error || res.statusText}`);
  return json?.result ?? null;
}

async function kvZRangeRev(key: string, start = 0, stop = -1): Promise<string[]> {
  const base = mustEnv('KV_REST_API_URL');
  const token = mustEnv('KV_REST_API_TOKEN');
  // upstash підтримує ?rev=true для зворотного порядку
  const url = `${base}/zrange/${encodeURIComponent(key)}/${start}/${stop}?rev=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(`Upstash ZRANGE failed: ${json?.error || res.statusText}`);
  return (json?.result as string[]) || [];
}

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids = await kvZRangeRev(INDEX, 0, -1);
  if (!ids?.length) return NextResponse.json([]);

  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGetJSON<any>(KEY(id));
    if (!raw) continue;
    const c = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);
    items.push(c);
  }
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // 1) зберігаємо повний JSON
    await kvSetJSON(KEY(c.id), c);

    // 2) індексуємо за created_at
    await kvZAdd(INDEX, c.created_at, c.id);

    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Invalid payload' }, { status: 400 });
  }
}
