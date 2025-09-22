// web/app/api/logs/route.ts
import { NextResponse } from 'next/server';
import { redis } from '../../../lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') || '3');
  const now = Date.now();
  const from = now - days * 24 * 60 * 60 * 1000;

  // ВАЖЛИВО: без дженериків у наших in-memory redis методів
  const ids = await redis.zrange('logs:index', from, now, { byScore: true }).catch(() => []);
  const items: any[] = [];

  for (const id of ids) {
    const raw = await redis.get(`logs:${id}`);
    if (!raw) continue;
    try {
      items.push(JSON.parse(raw));
    } catch {
      items.push({ id, raw });
    }
  }

  items.sort((a: any, b: any) => (a.ts > b.ts ? -1 : 1));

  return NextResponse.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
}
