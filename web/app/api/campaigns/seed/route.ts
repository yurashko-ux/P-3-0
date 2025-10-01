import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { unwrapDeep } from '@/lib/normalize';
import type { Campaign } from '@/lib/types';

export const runtime = 'nodejs';

const KEY = 'cmp:list:items';

export async function POST() {
  try {
    const now = Date.now();
    const demo: Campaign[] = [
      {
        id: String(now),
        name: 'UI-created',
        v1: '—',
        v2: '—',
        base: {
          pipeline: 'p-2',
          status: 's-2',
          pipelineName: 'Клієнти Інші послуги',
          statusName: 'Перший контакт',
        },
        counters: { v1: 0, v2: 0, exp: 0 },
        deleted: false,
        createdAt: now,
      },
      {
        id: String(now - 1),
        name: 'UI-created',
        v1: '—',
        v2: '—',
        base: {
          pipeline: 'p-1',
          status: 's-1',
          pipelineName: 'Нові Ліди',
          statusName: 'Новий',
        },
        counters: { v1: 0, v2: 0, exp: 0 },
        deleted: false,
        createdAt: now - 1,
      },
    ];

    const raw = await kv.get(KEY);
    const list = (unwrapDeep<any[]>(raw) || []).filter((x) => !x?.deleted);
    const merged = [...demo, ...list];
    await kv.set(KEY, merged);

    return NextResponse.json({ ok: true, created: demo.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Seed error' },
      { status: 500 }
    );
  }
}
