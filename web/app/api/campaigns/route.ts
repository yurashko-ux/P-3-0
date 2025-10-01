// web/app/api/campaigns/route.ts
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { store } from '@/web/lib/store';

export async function GET() {
  const items = await store.getAll();
  // показуємо лише не видалені
  const filtered = items.filter((x) => !x.deleted);
  return NextResponse.json({ ok: true, items: filtered });
}
