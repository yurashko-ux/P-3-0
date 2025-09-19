// web/app/api/keycrm/card/get/route.ts
// Діагностика: підтягнути деталі картки за точно відомим id із KeyCRM.
// Виклик: /api/keycrm/card/get?id=435&pass=11111

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function baseUrl() {
  return process.env.KEYCRM_API_URL || process.env.KEYCRM_BASE_URL || 'https://openapi.keycrm.app/v1';
}
function token() {
  return (
    process.env.KEYCRM_API_TOKEN ||
    process.env.KEYCRM_BEARER ||
    process.env.KEYCRM_TOKEN ||
    ''
  );
}

async function ensureAdmin(req: NextRequest) {
  const u = new URL(req.url);
  const passParam = u.searchParams.get('pass') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if (!expected) return true;
  return bearer === expected || passParam === expected;
}

// Простий fetch із невеликим throttle та 429-retry на всякий випадок
async function fetchJsonWithRetry(path: string) {
  const url = `${baseUrl()}${path}`;
  let attempt = 0;
  let backoff = 500;
  for (;;) {
    // легкий throttle
    await sleep(150);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw new Error(`Non-JSON from KeyCRM :: ${text.slice(0, 400)}`); }
    }
    if (res.status === 429 && attempt < 5) {
      const ra = Number(res.headers.get('retry-after') || '') || 0;
      await sleep(Math.max(backoff, ra * 1000));
      backoff = Math.min(backoff * 2, 15000);
      attempt++;
      continue;
    }
    const body = await res.text().catch(() => '');
    throw new Error(`KeyCRM ${res.status} ${res.statusText} :: ${body.slice(0, 400)}`);
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const u = new URL(req.url);
    const id = u.searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });

    const card = await fetchJsonWithRetry(`/pipelines/cards/${encodeURIComponent(id)}`);

    // Витягуємо найважливіше для перевірки
    const pid = card?.status?.pipeline_id ?? card?.pipeline_id ?? null;
    const sid = card?.status_id ?? card?.status?.id ?? null;

    const social =
      card?.contact?.social_id ??
      card?.contact?.client?.social_id ??
      null;

    return NextResponse.json({
      ok: true,
      id: Number(card?.id ?? id),
      pipeline_id: pid ? Number(pid) : null,
      status_id: sid ? Number(sid) : null,
      title: card?.title ?? null,
      contact_full_name: card?.contact?.full_name ?? card?.contact?.client?.full_name ?? null,
      contact_social_name: card?.contact?.social_name ?? null,
      contact_social_id: social,
      raw_sample_keys: Object.keys(card || {}).slice(0, 16),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
