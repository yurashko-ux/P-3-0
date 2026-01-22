// web/app/api/admin/direct/debug-trigger-appointment-status/route.ts
// ДЕБАГ endpoint: керовано змінює "статуси" записів (attendance/cancelled/date)
// для консультації або платної послуги, щоб перевірити lastActivityKeys + крапочки в таблиці.
//
// ВАЖЛИВО: не логуємо PII (імена/телефони). Повертаємо тільки ID/keys.

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

type Kind = 'consult' | 'paid';
type Action = 'cycle_attendance' | 'cycle_cancelled' | 'touch_date';

function safeParseInt(v: string): number | null {
  const n = parseInt(String(v || '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function addMinutesIso(iso: string, minutes: number): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const altegioClientId = safeParseInt(searchParams.get('altegioClientId') || '');
  const kind = ((searchParams.get('kind') || '').toString().trim() as Kind) || 'consult';
  const actionRaw = (searchParams.get('action') || '').toString().trim();
  const action = (actionRaw as Action) || 'cycle_attendance';
  const dateMode = (searchParams.get('dateMode') || '').toString().trim(); // keep|today|future

  if (!altegioClientId) {
    return NextResponse.json({ ok: false, error: 'altegioClientId must be a number' }, { status: 400 });
  }
  if (kind !== 'consult' && kind !== 'paid') {
    return NextResponse.json({ ok: false, error: 'kind must be consult|paid' }, { status: 400 });
  }
  if (!['cycle_attendance', 'cycle_cancelled', 'touch_date', 'set_expected'].includes(actionRaw || action)) {
    return NextResponse.json(
      { ok: false, error: 'action must be cycle_attendance|cycle_cancelled|touch_date|set_expected' },
      { status: 400 }
    );
  }

  try {
    const client = await getDirectClientByAltegioId(altegioClientId);
    if (!client) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });

    const nowIso = new Date().toISOString();

    const updates: any = {};

    if (kind === 'consult') {
      if (!client.consultationBookingDate) {
        return NextResponse.json({ ok: false, error: 'Client has no consultationBookingDate' }, { status: 400 });
      }

      if ((actionRaw || action) === 'set_expected') {
        // Гарантовано створюємо тригер для ⏳:
        // якщо вже стоїть attended=null і cancelled=false, робимо 2-кроковий перехід null -> false -> null,
        // щоб фінально залишився ⏳, але lastActivityKeys включив consultationAttended.
        const alreadyExpected =
          (client.consultationAttended === null || client.consultationAttended === undefined) &&
          Boolean(client.consultationCancelled) === false;

        if (alreadyExpected) {
          const step1 = {
            ...client,
            consultationAttended: false,
            consultationCancelled: false,
            updatedAt: nowIso,
          };
          await saveDirectClient(step1, `debug-trigger-consult-set_expected-step1`, { altegioClientId, kind, action: 'set_expected' });
          const step2 = {
            ...step1,
            consultationAttended: null,
            updatedAt: nowIso,
          };
          await saveDirectClient(step2, `debug-trigger-consult-set_expected-step2`, { altegioClientId, kind, action: 'set_expected' });
          const after = await getDirectClientByAltegioId(altegioClientId);
          return NextResponse.json({
            ok: true,
            altegioClientId,
            kind,
            action: 'set_expected',
            note: 'Already expected, forced trigger via null->false->null',
            lastActivityKeys: after?.lastActivityKeys ?? null,
            lastActivityAt: after?.lastActivityAt ?? null,
            updatedAt: after?.updatedAt ?? null,
          });
        }

        updates.consultationAttended = null;
        updates.consultationCancelled = false;
      } else if (action === 'touch_date') {
        updates.consultationBookingDate = addMinutesIso(client.consultationBookingDate, 5);
      } else if (action === 'cycle_cancelled') {
        const prev = Boolean(client.consultationCancelled);
        updates.consultationCancelled = !prev;
      } else {
        // cycle_attendance: null -> true -> false -> null
        const prev = client.consultationAttended;
        const next = prev === null || prev === undefined ? true : prev === true ? false : null;
        updates.consultationAttended = next;
      }

      if (dateMode === 'today') {
        updates.consultationBookingDate = new Date().toISOString();
      } else if (dateMode === 'future') {
        updates.consultationBookingDate = addMinutesIso(new Date().toISOString(), 60);
      }
    } else {
      if (!client.paidServiceDate) {
        return NextResponse.json({ ok: false, error: 'Client has no paidServiceDate' }, { status: 400 });
      }

      if ((actionRaw || action) === 'set_expected') {
        const alreadyExpected =
          (client.paidServiceAttended === null || client.paidServiceAttended === undefined) &&
          Boolean(client.paidServiceCancelled) === false;

        if (alreadyExpected) {
          const step1 = {
            ...client,
            paidServiceAttended: false,
            paidServiceCancelled: false,
            updatedAt: nowIso,
          };
          await saveDirectClient(step1, `debug-trigger-paid-set_expected-step1`, { altegioClientId, kind, action: 'set_expected' });
          const step2 = {
            ...step1,
            paidServiceAttended: null,
            updatedAt: nowIso,
          };
          await saveDirectClient(step2, `debug-trigger-paid-set_expected-step2`, { altegioClientId, kind, action: 'set_expected' });
          const after = await getDirectClientByAltegioId(altegioClientId);
          return NextResponse.json({
            ok: true,
            altegioClientId,
            kind,
            action: 'set_expected',
            note: 'Already expected, forced trigger via null->false->null',
            lastActivityKeys: after?.lastActivityKeys ?? null,
            lastActivityAt: after?.lastActivityAt ?? null,
            updatedAt: after?.updatedAt ?? null,
          });
        }

        updates.paidServiceAttended = null;
        updates.paidServiceCancelled = false;
      } else if (action === 'touch_date') {
        updates.paidServiceDate = addMinutesIso(client.paidServiceDate, 5);
      } else if (action === 'cycle_cancelled') {
        const prev = Boolean(client.paidServiceCancelled);
        updates.paidServiceCancelled = !prev;
      } else {
        // cycle_attendance: null -> true -> false -> null
        const prev = client.paidServiceAttended;
        const next = prev === null || prev === undefined ? true : prev === true ? false : null;
        updates.paidServiceAttended = next;
      }

      if (dateMode === 'today') {
        updates.paidServiceDate = new Date().toISOString();
      } else if (dateMode === 'future') {
        updates.paidServiceDate = addMinutesIso(new Date().toISOString(), 60);
      }
    }

    const updated = { ...client, ...updates, updatedAt: nowIso };

    await saveDirectClient(updated, `debug-trigger-${kind}-${action}`, { altegioClientId, kind, action });

    const after = await getDirectClientByAltegioId(altegioClientId);

    return NextResponse.json({
      ok: true,
      altegioClientId,
      kind,
      action,
      appliedKeys: Object.keys(updates),
      lastActivityKeys: after?.lastActivityKeys ?? null,
      lastActivityAt: after?.lastActivityAt ?? null,
      updatedAt: after?.updatedAt ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[debug-trigger-appointment-status] ❌ Помилка:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

