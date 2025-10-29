// web/app/api/keycrm/card/get/route.ts
// Діагностика: підтягнути деталі картки та (за потреби) контакт із KeyCRM.
// Якщо в картці немає contact.social_id, але є contact_id — довантажуємо /contacts/{id}.
//
// Виклик: /api/keycrm/card/get?id=435&pass=11111

import { NextRequest, NextResponse } from 'next/server';
import { baseUrl, ensureBearer } from '../../_common';

export const dynamic = 'force-dynamic';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function token() {
  return ensureBearer(
    process.env.KEYCRM_BEARER ||
      process.env.KEYCRM_API_TOKEN ||
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

async function fetchJsonWithRetry(path: string, opts: { delayMs?: number; retry429?: number; backoffMs?: number } = {}) {
  const { delayMs = 150, retry429 = 5, backoffMs = 500 } = opts;
  const url = `${baseUrl()}${path}`;
  let attempt = 0;
  let backoff = backoffMs;

  for (;;) {
    if (delayMs > 0) await sleep(delayMs);
    const auth = token();
    const res = await fetch(url, {
      headers: auth
        ? { Authorization: auth, 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw new Error(`Non-JSON from KeyCRM :: ${text.slice(0, 400)}`); }
    }
    if (res.status === 429 && attempt < retry429) {
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

    // 1) деталі картки
    const card = await fetchJsonWithRetry(`/pipelines/cards/${encodeURIComponent(id)}`);

    const pid = card?.status?.pipeline_id ?? card?.pipeline_id ?? null;
    const sid = card?.status_id ?? card?.status?.id ?? null;

    // те, що (можливо) є прямо в картці
    let contact = card?.contact ?? null;
    let contact_source: 'card.contact' | 'contacts/{id}' | null = contact ? 'card.contact' : null;

    // 2) якщо контакт не прийшов або немає social_id — довантажити /contacts/{contact_id}
    const contact_id =
      card?.contact_id ??
      card?.contact?.id ??
      null;

    const hasSocialInCard =
      (card?.contact && (card?.contact?.social_id || card?.contact?.client?.social_id)) ||
      false;

    if ((!contact || !hasSocialInCard) && contact_id) {
      try {
        const c = await fetchJsonWithRetry(`/contacts/${encodeURIComponent(String(contact_id))}`);
        if (c && typeof c === 'object') {
          contact = {
            id: c?.id ?? contact_id,
            full_name: c?.full_name ?? null,
            social_name: c?.social_name ?? null,
            social_id: c?.social_id ?? null,
            client: c?.client ?? null,
          };
          contact_source = 'contacts/{id}';
        }
      } catch {
        // ігноруємо, повернемо що є
      }
    }

    // Акуратно дістаємо social_id / full_name
    const contact_full_name =
      contact?.full_name ??
      contact?.client?.full_name ??
      null;

    const contact_social_id =
      contact?.social_id ??
      contact?.client?.social_id ??
      null;

    const contact_social_name =
      contact?.social_name ??
      null;

    return NextResponse.json({
      ok: true,
      id: Number(card?.id ?? id),
      pipeline_id: pid ? Number(pid) : null,
      status_id: sid ? Number(sid) : null,
      title: card?.title ?? null,
      contact_full_name,
      contact_social_name,
      contact_social_id,
      contact_source, // звідки взяли контакт
      raw_has_contact_in_card: !!card?.contact,
      raw_sample_keys: Object.keys(card || {}).slice(0, 16),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
