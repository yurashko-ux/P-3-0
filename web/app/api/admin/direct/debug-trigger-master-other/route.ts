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

  // Дружній парсер: якщо користувач вставив URL, де `=` та `&` були percent-encoded
  // (наприклад `?altegioClientId%3D123%26staffName%3DМар%27яна`), спробуємо витягнути параметри.
  const pickParam = (key: string): string => {
    const direct = (searchParams.get(key) || '').toString().trim();
    if (direct) return direct;

    try {
      const rawSearch = req.nextUrl.search || '';
      if (!rawSearch) return '';
      const decoded = decodeURIComponent(rawSearch);
      // decoded починається з "?" — не критично
      const m = decoded.match(new RegExp(`${key}=([^&]+)`));
      if (m && m[1]) return String(m[1]).trim();
    } catch {
      // ignore
    }
    return '';
  };

  const altegioClientIdRaw = pickParam('altegioClientId');
  const staffNameRaw = pickParam('staffName');
  const forceRaw = (searchParams.get('force') || '').toString().trim();
  const force = forceRaw === '1' || forceRaw.toLowerCase() === 'true';

  const altegioClientId = parseInt(altegioClientIdRaw, 10);
  if (!Number.isFinite(altegioClientId)) {
    return NextResponse.json(
      { ok: false, error: 'altegioClientId must be a number' },
      { status: 400 }
    );
  }

  try {
    const client = await getDirectClientByAltegioId(altegioClientId);
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 });
    }

    const masters = await getAllDirectMasters();
    const normalizeName = (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[’‘`ʼ]/g, "'")
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}\s'_-]+/gu, '');

    const staffName = staffNameRaw;
    const staffNorm = staffName ? normalizeName(staffName) : '';

    const enriched = masters.map((m) => ({
      id: m.id,
      name: m.name,
      norm: normalizeName(m.name || ''),
    }));

    const pickMaster = (): { id: string; name: string } | null => {
      if (!staffNorm) return null;

      // 1) exact
      const exact = enriched.find((m) => m.norm === staffNorm);
      if (exact) return { id: exact.id, name: exact.name };

      // 2) startsWith (either direction)
      const starts = enriched.filter((m) => m.norm.startsWith(staffNorm) || staffNorm.startsWith(m.norm));
      if (starts.length === 1) return { id: starts[0].id, name: starts[0].name };

      // 3) includes
      const includes = enriched.filter((m) => m.norm.includes(staffNorm) || staffNorm.includes(m.norm));
      if (includes.length === 1) return { id: includes[0].id, name: includes[0].name };

      // 4) first token match (e.g. "Мар'яна" should match "Мар'яна Сас")
      const firstToken = staffNorm.split(' ')[0] || '';
      if (firstToken) {
        const tokenMatches = enriched.filter((m) => m.norm.split(' ')[0] === firstToken || m.norm.startsWith(firstToken));
        if (tokenMatches.length === 1) return { id: tokenMatches[0].id, name: tokenMatches[0].name };
      }

      return null;
    };

    const picked = pickMaster();
    if (!picked && staffName) {
      // #region agent log
      try {
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'master-other-1',hypothesisId:'H_master_name_mismatch',location:'debug-trigger-master-other:pickMaster',message:'master not found',data:{altegioClientId,staffNameProvided:Boolean(staffNameRaw),staffNameLen:staffNameRaw.length,mastersCount:masters.length},timestamp:Date.now()})}).catch(()=>{});
      } catch {}
      // #endregion agent log

      const suggestions = staffNorm
        ? enriched
            .filter((m) => m.norm.includes(staffNorm) || staffNorm.includes(m.norm) || m.norm.startsWith(staffNorm))
            .slice(0, 10)
            .map((m) => m.name)
        : enriched.slice(0, 10).map((m) => m.name);

      return NextResponse.json(
        {
          ok: false,
          error: 'Master not found by name',
          staffNameLen: staffNameRaw.length,
          mastersCount: masters.length,
          suggestions,
          note: 'Спробуй передати staffName рівно як в suggestions, або лише перше слово (імʼя).',
        },
        { status: 404 }
      );
    }

    // Якщо staffName не передали — робимо toggle: беремо будь-якого іншого активного майстра.
    const currentMasterId = client.masterId || null;
    const togglePick = (): { id: string; name: string } | null => {
      const alt = enriched.find((m) => m.id && m.id !== currentMasterId);
      return alt ? { id: alt.id, name: alt.name } : null;
    };

    const master = picked ? { id: picked.id, name: picked.name } : togglePick();
    if (!master) {
      return NextResponse.json(
        { ok: false, error: 'No alternative master available', mastersCount: masters.length },
        { status: 400 }
      );
    }

    const prevMasterId = client.masterId || null;
    const nextMasterId = master.id;

    if (prevMasterId === nextMasterId && !force) {
      return NextResponse.json({
        ok: true,
        note: 'No changes (master already set)',
        altegioClientId,
        directClientId: client.id,
        prevMasterId,
        nextMasterId,
        hint: 'Додай force=1 або не передавай staffName, щоб endpoint автоматично вибрав іншого майстра.',
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
      staffNameLen: staffNameRaw.length,
    });

    // ВАЖЛИВО: викликаємо без touchUpdatedAt=false, щоб він “піднявся” і спрацював computeActivityKeys.
    await saveDirectClient(updated, 'debug-trigger-master-other', {
      altegioClientId,
      prevMasterId,
      nextMasterId,
      note: 'debug: master change only',
    });

    const after = await getDirectClientByAltegioId(altegioClientId);

    return NextResponse.json({
      ok: true,
      altegioClientId,
      directClientId: client.id,
      prevMasterId,
      nextMasterId,
      lastActivityKeys: after?.lastActivityKeys ?? null,
      lastActivityAt: after?.lastActivityAt ?? null,
      updatedAt: after?.updatedAt ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[debug-trigger-master-other] ❌ Помилка:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

