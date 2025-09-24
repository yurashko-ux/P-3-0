// web/app/api/logs/route.ts
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get('days') || '3';
  const days = Number(daysParam);
  const now = Date.now();
  const from = now - days * 24 * 60 * 60 * 1000;

  // Раніше тут був zrange з byScore; у нашій in-memory реалізації немає sorted set-ів.
  // Тому читаємо увесь список id через lrange і фільтруємо по timestamp самого лога.
  const ids: string[] = await redis.lrange('logs:index', 0, -1).catch(() => []);

  const items: any[] = [];
  for (const id of ids) {
    const raw = await redis.get(`logs:${id}`).catch(() => null);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      // очікуємо поле ts (timestamp). Якщо нема — пропускаємо.
      if (obj && typeof obj.ts === 'number' && obj.ts >= from) {
        items.push(obj);
      }
    } catch {
      // ігноруємо некоректний JSON
    }
  }

  // новіші зверху
  items.sort((a, b) => (a.ts > b.ts ? -1 : 1));

  return NextResponse.json(
    { ok: true, items },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
