// web/app/api/admin/direct/fix-names-from-records/route.ts
// Масово виправляє плейсхолдерні імена ({{full_name}}) з KV логу altegio:records:log

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { prisma } from '@/lib/prisma';
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

function parseKVItem(raw: any): any | null {
  try {
    let parsed: any = raw;
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
      try {
        parsed = JSON.parse(parsed.value);
      } catch {
        // ignore
      }
    }
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[direct/fix-names-from-records] Старт масового виправлення імен з records:log...');

    const clients = await getAllDirectClients();
    const candidates = clients.filter((c) => c.altegioClientId && (isBadNamePart(c.firstName) || isBadNamePart(c.lastName)));

    console.log(`[direct/fix-names-from-records] Кандидатів: ${candidates.length} з ${clients.length}`);

    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    console.log(`[direct/fix-names-from-records] Записів у KV: ${rawItems.length}`);

    // clientId -> { ts, fullName }
    const bestByClient = new Map<number, { ts: number; fullName: string }>();

    for (const raw of rawItems) {
      const e = parseKVItem(raw);
      if (!e) continue;
      const cid = e.clientId ?? e.data?.client?.id ?? e.data?.client_id;
      const clientId = Number(cid);
      if (!clientId) continue;

      const clientObj = e.data?.client || null;
      const fullName = (clientObj?.name || clientObj?.display_name || e.clientName || '').toString().trim();
      if (!fullName) continue;
      if (fullName.includes('{{') || fullName.includes('}}')) continue;

      const dt = e.datetime || e.data?.datetime || e.receivedAt;
      const ts = dt ? new Date(dt).getTime() : 0;

      const existing = bestByClient.get(clientId);
      if (!existing || ts >= existing.ts) {
        bestByClient.set(clientId, { ts, fullName });
      }
    }

    console.log(`[direct/fix-names-from-records] Знайдено імен у records:log для ${bestByClient.size} Altegio клієнтів`);

    let updated = 0;
    let notFoundInLog = 0;
    const sample: Array<{ directClientId: string; altegioClientId: number; fullName: string }> = [];

    for (const c of candidates) {
      const info = bestByClient.get(c.altegioClientId!);
      if (!info) {
        notFoundInLog++;
        continue;
      }

      const parts = info.fullName.split(/\s+/).filter(Boolean);
      const firstName = parts[0] || null;
      const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
      if (!firstName) continue;

      await prisma.directClient.update({
        where: { id: c.id },
        data: {
          firstName,
          lastName,
          updatedAt: new Date(),
        },
      });

      updated++;
      if (sample.length < 20) {
        sample.push({ directClientId: c.id, altegioClientId: c.altegioClientId!, fullName: info.fullName });
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Fix names completed',
      stats: {
        totalClients: clients.length,
        candidates: candidates.length,
        updated,
        notFoundInLog,
      },
      sample,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[direct/fix-names-from-records] ❌ Помилка:', err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

