// web/app/api/admin/direct/debug-rollback-master-id/route.ts
// ДЕБАГ/АДМІН endpoint: відкотити тестові зміни відповідального (masterId),
// які робились дебаг-ендпойнтами (зазвичай lastActivityKeys == ["masterId"]).
//
// ВАЖЛИВО:
// - не логуємо PII (імена/телефони/instagramUsername)
// - за замовчуванням працює як dry-run
// - не “торкаємо” updatedAt (touchUpdatedAt=false)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { saveDirectClient } from '@/lib/direct-store';
import { getDirectManager } from '@/lib/direct-masters/store';

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

const safeInt = (raw: string, def: number): number => {
  const n = parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(n) ? n : def;
};

function looksLikeExactMasterIdOnly(keys: any): boolean {
  if (!Array.isArray(keys)) return false;
  return keys.length === 1 && String(keys[0]) === 'masterId';
}

async function pickMasterIdFromStateLogs(clientId: string): Promise<string | null> {
  // беремо найсвіжіші логи і шукаємо metadata.masterId
  const logs = await prisma.directClientStateLog.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { metadata: true },
  });

  for (const l of logs) {
    const raw = (l.metadata || '').toString().trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const mid = parsed?.masterId;
      if (typeof mid === 'string' && mid.trim()) return mid.trim();
    } catch {
      // ignore
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const sinceHours = safeInt(searchParams.get('sinceHours') || '', 24);
  const limit = safeInt(searchParams.get('limit') || '', 300);
  const dryRun = (searchParams.get('dryRun') || '1').toString().trim() !== '0';
  const apply = (searchParams.get('apply') || '').toString().trim() === '1';

  const now = Date.now();
  const sinceMs = Math.max(1, sinceHours) * 60 * 60 * 1000;
  const sinceDate = new Date(now - sinceMs);

  try {
    const directManager = await getDirectManager();
    const directManagerId = directManager?.id || null;

    // Беремо кандидатів по lastActivityAt + masterManuallySet=false, далі фільтруємо по lastActivityKeys == ["masterId"].
    const candidates = await prisma.directClient.findMany({
      where: {
        masterManuallySet: false,
        lastActivityAt: { gte: sinceDate },
      },
      orderBy: { lastActivityAt: 'desc' },
      take: Math.max(1, Math.min(2000, limit * 5)),
      select: {
        id: true,
        state: true,
        masterId: true,
        masterManuallySet: true,
        lastActivityAt: true,
        lastActivityKeys: true,
      },
    });

    const filtered = candidates
      .filter((c) => looksLikeExactMasterIdOnly(c.lastActivityKeys as any))
      .slice(0, Math.max(1, Math.min(2000, limit)));

    const changes: Array<{
      clientId: string;
      prevMasterId: string | null;
      nextMasterId: string | null;
      source: 'stateLog' | 'directManagerLead' | 'none';
    }> = [];

    const errors: Array<{ clientId: string; error: string }> = [];

    for (const c of filtered) {
      const prevMasterId = c.masterId ? String(c.masterId) : null;
      let nextMasterId: string | null = null;
      let source: 'stateLog' | 'directManagerLead' | 'none' = 'none';

      if (String(c.state || '').trim() === 'lead') {
        nextMasterId = directManagerId;
        source = 'directManagerLead';
      } else {
        nextMasterId = await pickMasterIdFromStateLogs(c.id);
        source = nextMasterId ? 'stateLog' : 'none';
      }

      if ((nextMasterId ?? null) === (prevMasterId ?? null)) continue;

      changes.push({ clientId: c.id, prevMasterId, nextMasterId, source });

      if (apply && !dryRun) {
        try {
          // Оновлюємо через saveDirectClient, але без touchUpdatedAt і без логів стану.
          const updated = {
            id: c.id,
            masterId: nextMasterId ?? undefined,
            masterManuallySet: false,
          } as any;
          await saveDirectClient(updated, 'admin:rollback-masterId', { source }, { touchUpdatedAt: false, skipLogging: true });
        } catch (err) {
          errors.push({ clientId: c.id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      applyRequested: apply,
      sinceHours,
      limit,
      candidatesTotal: candidates.length,
      filteredCandidates: filtered.length,
      changesPlanned: changes.length,
      applied: Boolean(apply && !dryRun),
      errorsCount: errors.length,
      sampleChanges: changes.slice(0, 20).map((c) => ({
        clientId: String(c.clientId).slice(0, 18),
        prevMasterId: c.prevMasterId ? String(c.prevMasterId).slice(0, 12) : null,
        nextMasterId: c.nextMasterId ? String(c.nextMasterId).slice(0, 12) : null,
        source: c.source,
      })),
      note:
        'Це best-effort rollback: для lead ставимо direct-manager, для інших беремо masterId з metadata в останніх state-логах. Якщо source=none — відкотити точно неможливо без додаткових правил.',
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[debug-rollback-master-id] ❌ Помилка:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

