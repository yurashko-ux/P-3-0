// web/app/api/admin/direct/debug-trigger-paid-total-cost/route.ts
// ДЕБАГ endpoint: змінюємо paidServiceTotalCost (сума запису) для перевірки UI в колонці "Запис".
//
// ВАЖЛИВО: не логуємо PII (імена/телефони). Використовуємо тільки ID/числа.

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClientByAltegioId, saveDirectClient } from '@/lib/direct-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  const tokenParam = req.nextUrl.searchParams.get('token');
  if (ADMIN_PASS && tokenParam === ADMIN_PASS) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

type Action = 'set' | 'inc' | 'clear' | 'cycle';

const safeParseInt = (raw: string): number | null => {
  const n = parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const altegioClientId = safeParseInt(searchParams.get('altegioClientId') || '');
  const action = ((searchParams.get('action') || '').toString().trim() as Action) || 'set';
  const uah = safeParseInt(searchParams.get('uah') || searchParams.get('amountUAH') || searchParams.get('amount') || '');
  const force = (searchParams.get('force') || '').toString().trim() === '1';

  if (!altegioClientId) {
    return NextResponse.json({ ok: false, error: 'altegioClientId must be a number' }, { status: 400 });
  }
  if (!['set', 'inc', 'clear', 'cycle'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'action must be set|inc|clear|cycle' }, { status: 400 });
  }

  try {
    const client = await getDirectClientByAltegioId(altegioClientId);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }
    if (!client.paidServiceDate) {
      return NextResponse.json(
        { ok: false, error: 'Client has no paidServiceDate (сума запису показується лише коли є запис)' },
        { status: 400 }
      );
    }

    const prev = typeof (client as any).paidServiceTotalCost === 'number' ? (client as any).paidServiceTotalCost : null;

    let next: number | null = prev;
    if (action === 'clear') {
      next = null;
    } else if (action === 'inc') {
      const inc = uah ?? 1000;
      next = Math.max(0, (prev ?? 0) + inc);
    } else if (action === 'cycle') {
      const seq: Array<number | null> = [null, 5000, 12000, 25000, 40000];
      const idx = seq.findIndex((v) => v === prev);
      next = seq[(idx + 1 + seq.length) % seq.length] ?? null;
    } else {
      // set
      next = (uah ?? 25000) > 0 ? (uah ?? 25000) : null;
    }

    // #region agent log
    try {
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'paid-total-cost-1',hypothesisId:'H_paid_total_cost_trigger',location:'debug-trigger-paid-total-cost:entry',message:'request parsed',data:{altegioClientId,action,force,prev,next},timestamp:Date.now()})}).catch(()=>{});
    } catch {}
    // #endregion agent log

    // Якщо значення вже таке саме — UI/lastActivityKeys може не змінитись.
    // Для дебагу інколи треба “форснути” тригер, але фінально залишити next.
    if ((prev ?? null) === (next ?? null) && force) {
      const step1Val = next === null ? 1 : next + 1;
      const step1 = { ...client, paidServiceTotalCost: step1Val };
      await saveDirectClient(step1, 'debug-trigger-paid-total-cost-step1', { altegioClientId, action, prev, step1Val });
      const step2 = { ...step1, paidServiceTotalCost: next };
      await saveDirectClient(step2, 'debug-trigger-paid-total-cost-step2', { altegioClientId, action, next });
      const after = await getDirectClientByAltegioId(altegioClientId);

      // #region agent log
      try {
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'paid-total-cost-2',hypothesisId:'H_paid_total_cost_trigger',location:'debug-trigger-paid-total-cost:forced',message:'forced trigger done',data:{altegioClientId,prev,next,lastActivityKeys:after?.lastActivityKeys??null},timestamp:Date.now()})}).catch(()=>{});
      } catch {}
      // #endregion agent log

      return NextResponse.json({
        ok: true,
        altegioClientId,
        action,
        forced: true,
        prev,
        next,
        lastActivityKeys: after?.lastActivityKeys ?? null,
        lastActivityAt: after?.lastActivityAt ?? null,
        updatedAt: after?.updatedAt ?? null,
      });
    }

    const updated = { ...client, paidServiceTotalCost: next };
    await saveDirectClient(updated, 'debug-trigger-paid-total-cost', { altegioClientId, action, prev, next });
    const after = await getDirectClientByAltegioId(altegioClientId);

    // #region agent log
    try {
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'paid-total-cost-3',hypothesisId:'H_paid_total_cost_trigger',location:'debug-trigger-paid-total-cost:save',message:'saved',data:{altegioClientId,prev,next,lastActivityKeys:after?.lastActivityKeys??null},timestamp:Date.now()})}).catch(()=>{});
    } catch {}
    // #endregion agent log

    return NextResponse.json({
      ok: true,
      altegioClientId,
      action,
      forced: false,
      prev,
      next,
      lastActivityKeys: after?.lastActivityKeys ?? null,
      lastActivityAt: after?.lastActivityAt ?? null,
      updatedAt: after?.updatedAt ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[debug-trigger-paid-total-cost] ❌ Помилка:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

