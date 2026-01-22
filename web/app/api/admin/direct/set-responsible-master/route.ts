// web/app/api/admin/direct/set-responsible-master/route.ts
// Адмін endpoint: точково змінити відповідального (masterId) для заданих клієнтів.
// Зроблено для "повернення" після дебагу без масових rollback-ів.
//
// ВАЖЛИВО:
// - не логуємо PII (імена/телефони/instagramUsername)
// - за замовчуванням dryRun=1
// - НЕ торкаємо updatedAt (touchUpdatedAt=false)

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectMasters } from '@/lib/direct-masters/store';
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

const normalizeName = (s: string) =>
  (s || '')
    .toLowerCase()
    .trim()
    .replace(/[’‘`ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'_-]+/gu, '');

function pickMasterByName(masters: Array<{ id: string; name: string }>, inputName: string) {
  const want = normalizeName(inputName);
  if (!want) return null;
  const enriched = masters.map((m) => ({ ...m, norm: normalizeName(m.name) }));

  // exact
  const exact = enriched.find((m) => m.norm === want);
  if (exact) return { id: exact.id, name: exact.name };

  // startsWith either direction
  const starts = enriched.filter((m) => m.norm.startsWith(want) || want.startsWith(m.norm));
  if (starts.length === 1) return { id: starts[0].id, name: starts[0].name };

  // includes
  const includes = enriched.filter((m) => m.norm.includes(want) || want.includes(m.norm));
  if (includes.length === 1) return { id: includes[0].id, name: includes[0].name };

  // first token
  const token = (want.split(' ')[0] || '').trim();
  if (token) {
    const tokenMatches = enriched.filter((m) => (m.norm.split(' ')[0] || '') === token || m.norm.startsWith(token));
    if (tokenMatches.length === 1) return { id: tokenMatches[0].id, name: tokenMatches[0].name };
  }

  return null;
}

function parseIdList(raw: string): number[] {
  const out: number[] = [];
  const parts = (raw || '')
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return Array.from(new Set(out));
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const masterName = (searchParams.get('masterName') || "Мар'яна").toString();
  const idsRaw = (searchParams.get('altegioClientIds') || searchParams.get('ids') || '').toString();
  const dryRun = (searchParams.get('dryRun') || '1').toString().trim() !== '0';

  const altegioClientIds = parseIdList(idsRaw);
  if (!altegioClientIds.length) {
    return NextResponse.json(
      { ok: false, error: 'Provide altegioClientIds as comma-separated list (ids=123,456)' },
      { status: 400 }
    );
  }

  const masters = await getAllDirectMasters();
  const picked = pickMasterByName(
    masters.map((m) => ({ id: m.id, name: m.name })),
    masterName
  );
  if (!picked) {
    const suggestions = masters
      .map((m) => m.name)
      .filter(Boolean)
      .slice(0, 20);
    return NextResponse.json(
      { ok: false, error: 'Master not found by name', masterNameLen: masterName.length, suggestions },
      { status: 404 }
    );
  }

  // #region agent log
  try {
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'set-master-1',hypothesisId:'H_set_two_masters',location:'set-responsible-master:entry',message:'request parsed',data:{count:altegioClientIds.length,dryRun,masterNameLen:masterName.length,masterId:String(picked.id).slice(0,12)},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion agent log

  const results: Array<{ altegioClientId: number; ok: boolean; changed: boolean; prevMasterId: string | null; nextMasterId: string | null; error?: string }> = [];

  for (const altegioClientId of altegioClientIds) {
    try {
      const client = await getDirectClientByAltegioId(altegioClientId);
      if (!client) {
        results.push({ altegioClientId, ok: false, changed: false, prevMasterId: null, nextMasterId: null, error: 'Client not found' });
        continue;
      }

      const prevMasterId = client.masterId ? String(client.masterId) : null;
      const nextMasterId = picked.id;
      const changed = prevMasterId !== nextMasterId;

      if (!dryRun && changed) {
        const updated = {
          ...client,
          masterId: nextMasterId,
          masterManuallySet: false,
        };
        await saveDirectClient(updated, 'admin:set-responsible-master', { altegioClientId }, { touchUpdatedAt: false, skipLogging: true, skipAltegioMetricsSync: true });
      }

      results.push({ altegioClientId, ok: true, changed, prevMasterId, nextMasterId });
    } catch (err) {
      results.push({
        altegioClientId,
        ok: false,
        changed: false,
        prevMasterId: null,
        nextMasterId: picked.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // #region agent log
  try {
    const changedCount = results.filter((r) => r.ok && r.changed).length;
    const errCount = results.filter((r) => !r.ok).length;
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'set-master-2',hypothesisId:'H_set_two_masters',location:'set-responsible-master:result',message:'done',data:{dryRun,changedCount,errCount},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion agent log

  return NextResponse.json({
    ok: true,
    dryRun,
    master: { id: picked.id, name: picked.name },
    requested: altegioClientIds,
    changedPlanned: results.filter((r) => r.ok && r.changed).length,
    results,
    note: dryRun
      ? 'dryRun=1: нічого не змінено. Запусти з dryRun=0 щоб застосувати.'
      : 'Застосовано (updatedAt не чіпали).',
  });
}

