// web/app/api/campaigns/delete/route.ts
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { store } from '@/web/lib/store';

export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get('id') ?? '');

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
  }

  await store.remove(id);
  // повертаємося на список (без 405)
  return NextResponse.redirect(new URL('/admin/campaigns', req.url));
}
