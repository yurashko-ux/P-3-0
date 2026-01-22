// web/app/api/admin/direct/debug-trigger-master-other/route.ts
// ДЕБАГ endpoint: навмисно змінюємо лише майстра (masterId) для клієнта,
// щоб відтворити ситуацію, коли lastActivityKeys стає "other" через непокриті поля.
//
// ВАЖЛИВО: не логуємо PII (імена/телефони). Використовуємо тільки ID/довжини.

import { NextRequest, NextResponse } from 'next/server';
import { getDirectClientByAltegioId, saveDirectClient } from '@/lib/direct-store';
import { getAllDirectMasters } from '@/lib/direct-masters/store';

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const altegioClientIdRaw = (searchParams.get('altegioClientId') || '').toString().trim();
  const staffName = (searchParams.get('staffName') || '').toString().trim();

  const altegioClientId = parseInt(altegioClientIdRaw, 10);
  if (!Number.isFinite(altegioClientId)) {
    return NextResponse.json(
      { ok: false, error: 'altegioClientId must be a number' },
      { status: 400 }
    );
  }
  if (!staffName) {
    return NextResponse.json(
      { ok: false, error: 'staffName is required' },
      { status: 400 }
    );
  }

  try {
    const client = await getDirectClientByAltegioId(altegioClientId);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const masters = await getAllDirectMasters();
    const master = masters.find((m) => m.name === staffName) || null;
    if (!master) {
      return NextResponse.json(
        { ok: false, error: 'Master not found by name', staffNameLen: staffName.length },
        { status: 404 }
      );
    }

    const prevMasterId = client.masterId || null;
    const nextMasterId = master.id;

    if (prevMasterId === nextMasterId) {
      return NextResponse.json({
        ok: true,
        note: 'No changes (master already set)',
        altegioClientId,
        directClientId: client.id,
        prevMasterId,
        nextMasterId,
      });
    }

    const updated = {
      ...client,
      masterId: nextMasterId,
      // Це не ручна дія з UI, а технічний дебаг-триггер.
      masterManuallySet: false,
    };

    console.log('[debug-trigger-master-other] 🔧 Змінюємо майстра (debug)', {
      altegioClientId,
      directClientId: client.id,
      prevMasterId,
      nextMasterId,
      staffNameLen: staffName.length,
    });

    // ВАЖЛИВО: викликаємо без touchUpdatedAt=false, щоб він “піднявся” і спрацював computeActivityKeys.
    await saveDirectClient(updated, 'debug-trigger-master-other', {
      altegioClientId,
      prevMasterId,
      nextMasterId,
      note: 'debug: master change only',
    });

    return NextResponse.json({
      ok: true,
      altegioClientId,
      directClientId: client.id,
      prevMasterId,
      nextMasterId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[debug-trigger-master-other] ❌ Помилка:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

