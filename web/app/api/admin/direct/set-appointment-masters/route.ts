// web/app/api/admin/direct/set-appointment-masters/route.ts
// Адмін endpoint: точково змінити "майстра консультації" та/або "майстра запису" у таблиці.
//
// Це НЕ відповідальний (masterId). Це поля, які показуються в:
// - "Запис на консультацію" → consultationMasterName
// - "Запис" → serviceMasterName (+ serviceMasterAltegioStaffId обнуляємо, щоб не плутати фільтр по staff_id)
//
// ВАЖЛИВО:
// - не логуємо PII
// - за замовчуванням dryRun=1
// - updatedAt не чіпаємо (touchUpdatedAt=false)

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

  const exact = enriched.find((m) => m.norm === want);
  if (exact) return { id: exact.id, name: exact.name };

  const starts = enriched.filter((m) => m.norm.startsWith(want) || want.startsWith(m.norm));
  if (starts.length === 1) return { id: starts[0].id, name: starts[0].name };

  const includes = enriched.filter((m) => m.norm.includes(want) || want.includes(m.norm));
  if (includes.length === 1) return { id: includes[0].id, name: includes[0].name };

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
  const idsRaw = (searchParams.get('ids') || searchParams.get('altegioClientIds') || '').toString();
  const dryRun = (searchParams.get('dryRun') || '1').toString().trim() !== '0';
  const applyTo = (searchParams.get('applyTo') || 'both').toString().trim(); // both|paid|consult

  const altegioClientIds = parseIdList(idsRaw);
  if (!altegioClientIds.length) {
    return NextResponse.json({ ok: false, error: 'Provide ids=123,456' }, { status: 400 });
  }
  if (!['both', 'paid', 'consult'].includes(applyTo)) {
    return NextResponse.json({ ok: false, error: 'applyTo must be both|paid|consult' }, { status: 400 });
  }

  const masters = await getAllDirectMasters();
  const picked = pickMasterByName(
    masters.map((m) => ({ id: m.id, name: m.name })),
    masterName
  );
  if (!picked) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Master not found by name',
        suggestions: masters.map((m) => m.name).filter(Boolean).slice(0, 20),
      },
      { status: 404 }
    );
  }

  const results: Array<{
    altegioClientId: number;
    ok: boolean;
    changed: boolean;
    prev: { consultationMasterName: string | null; serviceMasterName: string | null };
    next: { consultationMasterName: string | null; serviceMasterName: string | null };
    error?: string;
  }> = [];

  for (const altegioClientId of altegioClientIds) {
    try {
      const client = await getDirectClientByAltegioId(altegioClientId);
      if (!client) {
        results.push({
          altegioClientId,
          ok: false,
          changed: false,
          prev: { consultationMasterName: null, serviceMasterName: null },
          next: { consultationMasterName: null, serviceMasterName: null },
          error: 'Client not found',
        });
        continue;
      }

      const prevConsult = (client.consultationMasterName || '').toString().trim() || null;
      const prevPaid = (client.serviceMasterName || '').toString().trim() || null;

      const nextConsult = applyTo === 'paid' ? prevConsult : picked.name.trim();
      const nextPaid = applyTo === 'consult' ? prevPaid : picked.name.trim();

      const changed = (prevConsult ?? null) !== (nextConsult ?? null) || (prevPaid ?? null) !== (nextPaid ?? null);

      if (!dryRun && changed) {
        const updated: any = {
          ...client,
        };
        if (applyTo !== 'paid') updated.consultationMasterName = nextConsult || undefined;
        if (applyTo !== 'consult') {
          updated.serviceMasterName = nextPaid || undefined;
          // щоб /clients не перетирав з KV: ми вже змінили правило, але staffId теж прибираємо (не обовʼязково)
          updated.serviceMasterAltegioStaffId = null;
        }

        await saveDirectClient(updated, 'admin:set-appointment-masters', { altegioClientId, applyTo }, { touchUpdatedAt: false, skipLogging: true, skipAltegioMetricsSync: true });
      }

      results.push({
        altegioClientId,
        ok: true,
        changed,
        prev: { consultationMasterName: prevConsult, serviceMasterName: prevPaid },
        next: { consultationMasterName: nextConsult, serviceMasterName: nextPaid },
      });
    } catch (err) {
      results.push({
        altegioClientId,
        ok: false,
        changed: false,
        prev: { consultationMasterName: null, serviceMasterName: null },
        next: { consultationMasterName: picked.name.trim(), serviceMasterName: picked.name.trim() },
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    applyTo,
    master: { id: picked.id, name: picked.name },
    requested: altegioClientIds,
    changedPlanned: results.filter((r) => r.ok && r.changed).length,
    results,
    note: dryRun ? 'dryRun=1: нічого не змінено. Запусти з dryRun=0 щоб застосувати.' : 'Застосовано.',
  });
}

