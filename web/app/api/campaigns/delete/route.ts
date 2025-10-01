// web/app/api/campaigns/delete/route.ts
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
// з delete -> campaigns -> api -> app -> (root) -> lib/store
import { store } from '../../../../lib/store';

export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get('id') ?? '');

  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
  }

  await store.remove(id);
  return NextResponse.redirect(new URL('/admin/campaigns', req.url));
}
