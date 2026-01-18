// web/app/api/admin/direct/fix-names-from-altegio/route.ts
// Масово виправляє "погані" імена з Altegio API по altegioClientId (пріоритет Altegio).

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEnvValue } from '@/lib/env';
import { getClient } from '@/lib/altegio/clients';
import { getAllDirectClients } from '@/lib/direct-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;

  if (CRON_SECRET) {
    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get('secret');
    if (secret === CRON_SECRET) return true;
  }

  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

function isBadNamePart(v?: string | null): boolean {
  if (!v) return true;
  const t = String(v).trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (t.includes('{{') || t.includes('}}')) return true;
  if (lower === 'not found') return true;
  return false;
}

function looksInstagramSourced(firstName?: string | null, lastName?: string | null): boolean {
  const fn = String(firstName || '').trim();
  const ln = String(lastName || '').trim();
  if (!fn && !ln) return true;
  // Евристика: одне слово ALL CAPS без прізвища — часто це "кличка/нік"
  const isAllCapsSingle = !!fn && !ln && fn.length >= 3 && fn === fn.toUpperCase() && !/\s/.test(fn);
  return isAllCapsSingle;
}

function normalizeNameForCompare(v: string): string {
  return v
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || null;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { firstName, lastName };
}

function idSuffix(id: string | number): string {
  const s = String(id);
  return s.length <= 6 ? s : s.slice(-6);
}

async function dbg(payload: any) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      ...payload,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const sp = req.nextUrl.searchParams;

  const rawMode = String((body as any).mode || sp.get('mode') || '').trim(); // '' | 'all' | 'diff' | 'heuristic'
  const mode = rawMode || 'diff';
  const dryRun = String((body as any).dryRun ?? sp.get('dryRun') ?? 'false').toLowerCase() === 'true';
  const onlySourceInstagram =
    String((body as any).onlySourceInstagram ?? sp.get('onlySourceInstagram') ?? 'true').toLowerCase() === 'true';
  const limit = Math.max(1, Math.min(Number((body as any).limit || sp.get('limit') || 200), 2000));
  const runId = String((body as any).runId || sp.get('runId') || 'pre-fix');

  const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
  if (!companyIdStr) {
    return NextResponse.json({ ok: false, error: 'ALTEGIO_COMPANY_ID not configured' }, { status: 500 });
  }
  const companyId = Number(companyIdStr);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ ok: false, error: 'Invalid ALTEGIO_COMPANY_ID' }, { status: 500 });
  }

  const clients = await getAllDirectClients();
  const base = clients
    .filter((c) => typeof c.altegioClientId === 'number' && c.altegioClientId > 0)
    .filter((c) => (onlySourceInstagram ? c.source === 'instagram' : true));

  const candidates =
    mode === 'all' || mode === 'diff'
      ? base.slice(0, limit)
      : base
          .filter(
            (c) =>
              isBadNamePart(c.firstName) ||
              isBadNamePart(c.lastName) ||
              looksInstagramSourced(c.firstName, c.lastName)
          )
          .slice(0, limit);

  console.log(
    `[direct/fix-names-from-altegio] Старт. mode=${mode}, onlySourceInstagram=${onlySourceInstagram}, кандидатів: ${candidates.length} з ${clients.length}. dryRun=${dryRun}`
  );

  let updated = 0;
  let checked = 0;
  let sameName = 0;
  let mismatched = 0;
  let fetched404 = 0;
  let fetchedErrors = 0;
  let noNameInAltegio = 0;

  const sample: Array<{ directClientId: string; altegioClientId: number; updated: boolean }> = [];
  let dbgMismatchLogged = 0;
  let dbgUpdatedLogged = 0;

  await dbg({
    runId,
    hypothesisId: 'H1',
    location: 'web/app/api/admin/direct/fix-names-from-altegio/route.ts:POST:start',
    message: 'Старт масового виправлення імен',
    data: {
      mode,
      dryRun,
      onlySourceInstagram,
      limit,
      totalClients: clients.length,
      candidates: candidates.length,
    },
  });

  for (const c of candidates) {
    const altegioId = c.altegioClientId!;
    try {
      const ac = await getClient(companyId, altegioId);
      checked++;
      if (!ac) {
        fetched404++;
        continue;
      }
      const fullName = String((ac as any).name || (ac as any).display_name || '').trim();
      if (!fullName) {
        noNameInAltegio++;
        continue;
      }
      const { firstName, lastName } = splitName(fullName);
      if (!firstName) {
        noNameInAltegio++;
        continue;
      }

      const directFull = normalizeNameForCompare([c.firstName, c.lastName].filter(Boolean).join(' '));
      const altegioFull = normalizeNameForCompare(fullName);
      const shouldUpdate =
        mode === 'diff'
          ? directFull !== altegioFull
          : String(c.firstName || '').trim() !== String(firstName || '').trim() ||
            String(c.lastName || '').trim() !== String(lastName || '').trim();

      if (mode === 'diff') {
        if (shouldUpdate) mismatched++;
        else sameName++;
      }

      if (shouldUpdate && dbgMismatchLogged < 5) {
        dbgMismatchLogged++;
        await dbg({
          runId,
          hypothesisId: 'H1',
          location: 'web/app/api/admin/direct/fix-names-from-altegio/route.ts:POST:compare',
          message: 'Знайдено розбіжність імен (без ПІБ)',
          data: {
            directIdSuffix: idSuffix(c.id),
            altegioIdSuffix: idSuffix(altegioId),
            directLen: directFull.length,
            altegioLen: altegioFull.length,
          },
        });
      }

      if (!dryRun && shouldUpdate) {
        await prisma.directClient.update({
          where: { id: c.id },
          data: {
            firstName,
            lastName,
            updatedAt: new Date(),
          },
        });
        updated++;

        if (dbgUpdatedLogged < 5) {
          dbgUpdatedLogged++;
          await dbg({
            runId,
            hypothesisId: 'H2',
            location: 'web/app/api/admin/direct/fix-names-from-altegio/route.ts:POST:update',
            message: 'Оновлено ім’я з Altegio (без ПІБ)',
            data: {
              directIdSuffix: idSuffix(c.id),
              altegioIdSuffix: idSuffix(altegioId),
            },
          });
        }
      }

      if (sample.length < 25) {
        sample.push({ directClientId: c.id, altegioClientId: altegioId, updated: Boolean(shouldUpdate) });
      }
    } catch (err: any) {
      checked++;
      fetchedErrors++;
      console.warn('[direct/fix-names-from-altegio] ⚠️ Помилка для altegioClientId:', altegioId, err?.message || err);
    }
  }

  await dbg({
    runId,
    hypothesisId: 'H2',
    location: 'web/app/api/admin/direct/fix-names-from-altegio/route.ts:POST:done',
    message: 'Завершено масове виправлення імен',
    data: {
      mode,
      dryRun,
      onlySourceInstagram,
      limit,
      totalClients: clients.length,
      candidates: candidates.length,
      checked,
      updated,
      sameName,
      mismatched,
      fetched404,
      fetchedErrors,
      noNameInAltegio,
    },
  });

  return NextResponse.json({
    ok: true,
    dryRun,
    stats: {
      totalClients: clients.length,
      candidates: candidates.length,
      checked,
      updated,
      sameName,
      mismatched,
      fetched404,
      fetchedErrors,
      noNameInAltegio,
      limit,
    },
    sample,
    timestamp: new Date().toISOString(),
  });
}

