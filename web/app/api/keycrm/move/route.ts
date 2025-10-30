// web/app/api/keycrm/move/route.ts
import { NextResponse } from 'next/server';

const BASE = process.env.KEYCRM_API_BASE || '';
const TOKEN = process.env.KEYCRM_TOKEN || '';

export async function POST(req: Request) {
  try {
    if (!BASE || !TOKEN) {
      return NextResponse.json({ ok: false, error: 'KEYCRM env missing' }, { status: 500 });
    }
    const body = await req.json().catch(() => ({}));
    const card_id = String(body.card_id || '').trim();
    const to_pipeline_id = String(body.to_pipeline_id || '').trim();
    const to_status_id = String(body.to_status_id || '').trim();

    if (!card_id || !to_pipeline_id || !to_status_id) {
      return NextResponse.json({ ok: false, error: 'card_id, to_pipeline_id, to_status_id are required' }, { status: 400 });
    }

    // У KeyCRM оновлення “угоди/картки” звично через PATCH до ресурсу з body { pipeline_id, status_id }.
    // За потреби підлаштуй шлях нижче під свій існуючий бек (назва сутності може бути deals/cards).
    const url = `${BASE}/crm/deals/${encodeURIComponent(card_id)}`;

    const r = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipeline_id: to_pipeline_id,
        status_id: to_status_id,
      }),
      cache: 'no-store',
    });

    const text = await r.text();
    let j: any = {};
    try { j = JSON.parse(text); } catch {}

    if (!r.ok) {
      return NextResponse.json({ ok: false, error: j?.message || `${r.status} ${r.statusText}`, raw: j || text }, { status: r.status });
    }

    return NextResponse.json({ ok: true, result: j || text });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'move failed' }, { status: 500 });
  }
}
