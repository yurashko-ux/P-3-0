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

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = Boolean((body as any).dryRun);
  const limit = Math.max(1, Math.min(Number((body as any).limit || 200), 2000));

  const companyIdStr = getEnvValue('ALTEGIO_COMPANY_ID');
  if (!companyIdStr) {
    return NextResponse.json({ ok: false, error: 'ALTEGIO_COMPANY_ID not configured' }, { status: 500 });
  }
  const companyId = Number(companyIdStr);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return NextResponse.json({ ok: false, error: 'Invalid ALTEGIO_COMPANY_ID' }, { status: 500 });
  }

  const clients = await getAllDirectClients();
  const candidates = clients
    .filter((c) => typeof c.altegioClientId === 'number' && c.altegioClientId > 0)
    .filter((c) => isBadNamePart(c.firstName) || isBadNamePart(c.lastName) || looksInstagramSourced(c.firstName, c.lastName))
    .slice(0, limit);

  console.log(
    `[direct/fix-names-from-altegio] Старт. Кандидатів: ${candidates.length} з ${clients.length}. dryRun=${dryRun}`
  );

  let updated = 0;
  let fetched404 = 0;
  let fetchedErrors = 0;
  let noNameInAltegio = 0;

  const sample: Array<{ directClientId: string; altegioClientId: number; updated: boolean }> = [];

  for (const c of candidates) {
    const altegioId = c.altegioClientId!;
    try {
      const ac = await getClient(companyId, altegioId);
      if (!ac) {
        fetched404++;
        continue;
      }
      const fullName = String((ac as any).name || (ac as any).display_name || '').trim();
      if (!fullName) {
        noNameInAltegio++;
        continue;
      }
      const parts = fullName.split(/\s+/).filter(Boolean);
      const firstName = parts[0] || null;
      const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
      if (!firstName) {
        noNameInAltegio++;
        continue;
      }

      const shouldUpdate =
        String(c.firstName || '').trim() !== String(firstName || '').trim() ||
        String(c.lastName || '').trim() !== String(lastName || '').trim();

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
      }

      if (sample.length < 25) {
        sample.push({ directClientId: c.id, altegioClientId: altegioId, updated: Boolean(shouldUpdate) });
      }
    } catch (err: any) {
      fetchedErrors++;
      console.warn('[direct/fix-names-from-altegio] ⚠️ Помилка для altegioClientId:', altegioId, err?.message || err);
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    stats: {
      totalClients: clients.length,
      candidates: candidates.length,
      updated,
      fetched404,
      fetchedErrors,
      noNameInAltegio,
      limit,
    },
    sample,
    timestamp: new Date().toISOString(),
  });
}

