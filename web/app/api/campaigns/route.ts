// web/app/api/campaigns/route.ts
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
// з campaigns -> api -> app -> (root) -> lib/store
import { store } from '../../../lib/store';

export async function GET() {
  const items = await store.getAll();
  const filtered = items.filter((x) => !x.deleted);
  return NextResponse.json({ ok: true, items: filtered });
}
