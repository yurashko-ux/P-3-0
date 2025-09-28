// web/app/api/debug/kv/route.ts
// Diagnostic endpoint to compare KV reads via READ-ONLY and WRITE tokens
// and across both index keys: 'campaign:index' (new) and 'campaigns:index' (legacy).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, campaignKeys } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(req: NextRequest) {
  const header = req.headers.get('x-admin-token') || '';
  const cookie = req.cookies.get('admin_token')?.value || '';
  const t = header || cookie;
  return !!t && t === process.env.ADMIN_PASS;
}

async function readViaWriteToken(indexKey: string) {
  const base = process.env.KV_REST_API_URL || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  if (!base || !token) {
    return { ok: false, reason: 'missing base or write token', ids: [] as string[], items: [] as any[] };
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const urlBase = base.replace(/\/$/, '');

  const r1 = await fetch(`${urlBase}/lrange/${encodeURIComponent(indexKey)}/0/-1`, {
    method: 'GET', headers, cache: 'no-store',
  });
  if (!r1.ok) {
    const body = await r1.text().catch(() => '');
    return { ok: false, reason: `lrange ${r1.status}: ${body}`, ids: [] as string[], items: [] as any[] };
  }
  const j1 = await r1.json().catch(() => ({}));
  const ids: string[] = j1?.result ?? [];

  const items: any[] = [];
  for (const id of ids.slice(0, 10)) {
    const itemKey = indexKey === campaignKeys.INDEX_KEY ? campaignKeys.ITEM_KEY(id) : `campaign:${id}`;
    const r2 = await fetch(`${urlBase}/get/${encodeURIComponent(itemKey)}`, {
      method: 'GET', headers, cache: 'no-store',
    });
    if (!r2.ok) continue;
    const j2 = await r2.json().catch(() => ({}));
    const raw: string | null = j2?.result ?? null;
    if (!raw) continue;
    try { items.push(JSON.parse(raw)); } catch { items.push({ parseError: true, raw }); }
  }
  return { ok: true, ids, items };
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const indexes = [campaignKeys.INDEX_KEY, 'campaigns:index'];

  try {
    const roResults = [] as any[];
    for (const key of indexes) {
      const ids = await kvRead.lrange(key, 0, -1).catch(() => []) as string[];
      const items: any[] = [];
      for (const id of ids.slice(0, 10)) {
        const itemKey = key === campaignKeys.INDEX_KEY ? campaignKeys.ITEM_KEY(id) : `campaign:${id}`;
        const raw = await kvRead.getRaw(itemKey).catch(() => null);
        if (!raw) continue;
        try { items.push(JSON.parse(raw)); } catch { items.push({ parseError: true, raw }); }
      }
      roResults.push({ indexKey: key, ids, items });
    }

    const wrResults = [] as any[];
    for (const key of indexes) {
      wrResults.push(await readViaWriteToken(key));
    }

    return NextResponse.json({
      ok: true,
      time: new Date().toISOString(),
      env: {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_READ_ONLY_TOKEN: !!process.env.KV_REST_API_READ_ONLY_TOKEN,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
      },
      readOnly: roResults,
      writeToken: wrResults,
      hints: [
        'Якщо writeToken.ids має значення, а readOnly.ids — порожній, RO-токен неправильний або вказує на інший KV.',
        'Якщо обидва масиви порожні для обох індексів — запис не відбувся або інший KV-інстанс у /api/campaigns.',
      ],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'diag failed' }, { status: 500 });
  }
}
