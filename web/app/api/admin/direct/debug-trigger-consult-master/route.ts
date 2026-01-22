// web/app/api/admin/direct/debug-trigger-consult-master/route.ts
// ДЕБАГ endpoint: навмисно змінюємо лише майстра консультації (consultationMasterId/Name)
// для клієнта по altegioClientId, щоб перевірити тригери lastActivityKeys і крапочку в колонці "Запис на консультацію".
//
// ВАЖЛИВО: не логуємо PII (імена/телефони). Повертаємо тільки ID та ключі.

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
  const staffNameRaw = (searchParams.get('staffName') || '').toString().trim();
  const forceRaw = (searchParams.get('force') || '').toString().trim();
  const force = forceRaw === '1' || forceRaw.toLowerCase() === 'true';

  const altegioClientId = parseInt(altegioClientIdRaw, 10);
  if (!Number.isFinite(altegioClientId)) {
    return NextResponse.json({ ok: false, error: 'altegioClientId must be a number' }, { status: 400 });
  }

  const normalizeName = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[’‘`ʼ]/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N}\s'_-]+/gu, '');

  try {
    const client = await getDirectClientByAltegioId(altegioClientId);
    if (!client) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });

    if (!client.consultationBookingDate) {
      return NextResponse.json(
        { ok: false, error: 'Client has no consultationBookingDate (nothing to show in UI)' },
        { status: 400 }
      );
    }

    const masters = await getAllDirectMasters();
    const enriched = masters.map((m) => ({ id: m.id, name: m.name, norm: normalizeName(m.name || '') }));

    const currentConsultMasterId = client.consultationMasterId || null;
    const currentConsultMasterName = (client.consultationMasterName || '').toString().trim() || null;

    const staffNorm = staffNameRaw ? normalizeName(staffNameRaw) : '';

    const pickByName = (): { id: string; name: string } | null => {
      if (!staffNorm) return null;
      const exact = enriched.find((m) => m.norm === staffNorm);
      if (exact) return { id: exact.id, name: exact.name };
      const starts = enriched.filter((m) => m.norm.startsWith(staffNorm) || staffNorm.startsWith(m.norm));
      if (starts.length === 1) return { id: starts[0].id, name: starts[0].name };
      const includes = enriched.filter((m) => m.norm.includes(staffNorm) || staffNorm.includes(m.norm));
      if (includes.length === 1) return { id: includes[0].id, name: includes[0].name };
      const firstToken = staffNorm.split(' ')[0] || '';
      if (firstToken) {
        const tokenMatches = enriched.filter((m) => m.norm.split(' ')[0] === firstToken || m.norm.startsWith(firstToken));
        if (tokenMatches.length === 1) return { id: tokenMatches[0].id, name: tokenMatches[0].name };
      }
      return null;
    };

    const pickToggle = (): { id: string; name: string } | null => {
      const alt = enriched.find((m) => m.id && m.id !== currentConsultMasterId);
      return alt ? { id: alt.id, name: alt.name } : null;
    };

    const picked = pickByName() || pickToggle();
    if (!picked) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No master match / no alternative master',
          mastersCount: masters.length,
          suggestions: staffNorm
            ? enriched.filter((m) => m.norm.includes(staffNorm) || m.norm.startsWith(staffNorm)).slice(0, 10).map((m) => m.name)
            : enriched.slice(0, 10).map((m) => m.name),
        },
        { status: 400 }
      );
    }

    if (!force && currentConsultMasterId === picked.id) {
      return NextResponse.json({
        ok: true,
        note: 'No changes (consultation master already set)',
        altegioClientId,
        directClientId: client.id,
        prevConsultationMasterId: currentConsultMasterId,
        nextConsultationMasterId: picked.id,
        prevConsultationMasterName: currentConsultMasterName,
        nextConsultationMasterName: picked.name,
        hint: 'Додай force=1 або не передавай staffName, щоб endpoint автоматично вибрав іншого майстра.',
      });
    }

    const updated = {
      ...client,
      consultationMasterId: picked.id,
      consultationMasterName: picked.name,
    };

    await saveDirectClient(updated, 'debug-trigger-consult-master', {
      altegioClientId,
      prevConsultationMasterId: currentConsultMasterId,
      nextConsultationMasterId: picked.id,
    });

    const after = await getDirectClientByAltegioId(altegioClientId);

    return NextResponse.json({
      ok: true,
      altegioClientId,
      directClientId: client.id,
      prevConsultationMasterId: currentConsultMasterId,
      nextConsultationMasterId: picked.id,
      prevConsultationMasterName: currentConsultMasterName,
      nextConsultationMasterName: picked.name,
      lastActivityKeys: after?.lastActivityKeys ?? null,
      lastActivityAt: after?.lastActivityAt ?? null,
      updatedAt: after?.updatedAt ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[debug-trigger-consult-master] ❌ Помилка:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

