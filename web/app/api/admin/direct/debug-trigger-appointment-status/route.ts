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
  const action = ((searchParams.get('action') || '').toString().trim() as Action) || 'cycle_attendance';

  if (!altegioClientId) {
    return NextResponse.json({ ok: false, error: 'altegioClientId must be a number' }, { status: 400 });
  }
  if (kind !== 'consult' && kind !== 'paid') {
    return NextResponse.json({ ok: false, error: 'kind must be consult|paid' }, { status: 400 });
  }
  if (!['cycle_attendance', 'cycle_cancelled', 'touch_date'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'action must be cycle_attendance|cycle_cancelled|touch_date' }, { status: 400 });
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

      if (action === 'touch_date') {
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
    } else {
      if (!client.paidServiceDate) {
        return NextResponse.json({ ok: false, error: 'Client has no paidServiceDate' }, { status: 400 });
      }

      if (action === 'touch_date') {
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

