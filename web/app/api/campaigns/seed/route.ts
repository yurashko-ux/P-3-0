// web/app/api/campaigns/seed/route.ts
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { store } from '@/web/lib/store';

export async function POST() {
  const existing = await store.getAll();
  if (existing.length > 0) {
    return NextResponse.json({ ok: true, created: 0, note: 'already seeded' });
  }

  const now = Date.now();
  await store.create({
    id: String(now),
    name: 'UI-created',
    v1: '—',
    v2: '—',
    base: { pipeline: 'p-1', status: 's-1', pipelineName: 'Нові Ліди', statusName: 'Новий' },
    counters: { v1: 0, v2: 0, exp: 0 },
    deleted: false,
    createdAt: now,
  });

  await store.create({
    id: String(now + 1),
    name: 'UI-created',
    v1: '—',
    v2: '—',
    base: { pipeline: 'p-2', status: 's-2', pipelineName: 'Клієнти Інші послуги', statusName: 'Перший контакт' },
    counters: { v1: 0, v2: 0, exp: 0 },
    deleted: false,
    createdAt: now + 1,
  });

  return NextResponse.json({ ok: true, created: 2 });
}
