// /app/api/campaigns/delete/route.ts
import { NextResponse } from 'next/server';
import { kvDelItem, kvDelIdFromList } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const id = String(form.get('id') || '');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
    }
    await kvDelItem(id);
    await kvDelIdFromList(id);
    return NextResponse.redirect(new URL('/admin/campaigns', req.url), 303);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
