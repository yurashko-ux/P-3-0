// web/app/api/admin/direct/today-records-total/route.ts
// Debug-only: підрахунок суми послуг за сьогодні з KV.
// Основний джерело — stats/periods (direct-stats-engine).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import { getAllDirectClients } from '@/lib/direct-store';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  kyivDayFromISO,
  computeGroupTotalCostUAHUniqueMasters,
} from '@/lib/altegio/records-grouping';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

/**
 * GET - отримати суму послуг за сьогодні (записи з paidServiceRecordCreatedAt за сьогодні)
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Отримуємо всіх клієнтів
    const clients = await getAllDirectClients();
    
    // Отримуємо всі записи з records:log та webhook:log
    const { KV_LIMIT_RECORDS, KV_LIMIT_WEBHOOK, getTodayKyiv } = await import('@/lib/direct-stats-config');
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, KV_LIMIT_RECORDS - 1);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, KV_LIMIT_WEBHOOK - 1);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    const dayParam = req.nextUrl.searchParams.get('day');
    const todayKyiv = getTodayKyiv(dayParam);

    // Функція для отримання paidServiceRecordCreatedAt з групи
    const pickRecordCreatedAtISOFromGroup = (group: any): string | null => {
      try {
        const events = Array.isArray(group?.events) ? group.events : [];
        const toTs = (e: any) => new Date(e?.receivedAt || e?.datetime || 0).getTime();

        // 1) Найперша подія зі статусом create
        let bestCreate = Infinity;
        for (const e of events) {
          const status = (e?.status || '').toString();
          if (status !== 'create') continue;
          const ts = toTs(e);
          if (isFinite(ts) && ts < bestCreate) bestCreate = ts;
        }
        if (bestCreate !== Infinity) return new Date(bestCreate).toISOString();

        // 2) Фолбек: найперша подія будь-якого статусу
        let bestAny = Infinity;
        for (const e of events) {
          const ts = toTs(e);
          if (isFinite(ts) && ts < bestAny) bestAny = ts;
        }
        if (bestAny !== Infinity) return new Date(bestAny).toISOString();

        return null;
      } catch {
        return null;
      }
    };

    // Функція для пошуку найближчої групи
    const pickClosestGroup = (groups: any[], groupType: 'paid' | 'consultation', targetISO: string) => {
      const targetTs = new Date(targetISO).getTime();
      if (!isFinite(targetTs)) return null;
      const targetDay = kyivDayFromISO(targetISO);
      const sameDay = targetDay
        ? (groups.find((g: any) => (g?.groupType === groupType) && (g?.kyivDay || '') === targetDay) || null)
        : null;
      if (sameDay) return sameDay;

      let best: any = null;
      let bestDiff = Infinity;
      for (const g of groups) {
        if ((g as any)?.groupType !== groupType) continue;
        const dt = (g as any)?.datetime || (g as any)?.receivedAt || null;
        if (!dt) continue;
        const ts = new Date(dt).getTime();
        if (!isFinite(ts)) continue;
        const diff = Math.abs(ts - targetTs);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = g;
        }
      }
      // Фолбек тільки якщо це справді той самий запис (до 24 год різниці)
      if (best && bestDiff <= 24 * 60 * 60 * 1000) return best;
      return null;
    };

    // Рахуємо суму: ітеруємо по ВСІХ групах з KV (не тільки по клієнтах з БД), щоб не втрачати через розбіжність clientId
    let total = 0;
    const recordsDetails: Array<{
      receivedAt: string;
      clientId: number | null;
      clientName: string | null;
      paidServiceDate: string;
      cost: number;
    }> = [];
    const clientMap = new Map<number, (typeof clients)[0]>();
    for (const c of clients) {
      if (c.altegioClientId) clientMap.set(Number(c.altegioClientId), c);
    }

    for (const [clientId, groups] of groupsByClient) {
      for (const group of groups) {
        if (group.groupType !== 'paid') continue;
        const paidRecordCreatedAt = pickRecordCreatedAtISOFromGroup(group);
        if (!paidRecordCreatedAt) continue;
        const createdDay = kyivDayFromISO(paidRecordCreatedAt);
        if (createdDay !== todayKyiv) continue;

        const cost = computeGroupTotalCostUAHUniqueMasters(group);
        if (cost <= 0) continue;

        total += cost;
        const client = clientMap.get(clientId);
        const paidServiceDate = client?.paidServiceDate ? String(client.paidServiceDate) : (group.datetime || group.receivedAt || '');
        recordsDetails.push({
          receivedAt: paidRecordCreatedAt,
          clientId,
          clientName: client ? [client.firstName, client.lastName].filter(Boolean).join(' ') || null : null,
          paidServiceDate,
          cost,
        });
      }
    }

    // Сортуємо записи за датою створення (найновіші першими)
    recordsDetails.sort((a, b) => {
      const dateA = new Date(a.receivedAt).getTime();
      const dateB = new Date(b.receivedAt).getTime();
      return dateB - dateA;
    });

    const debug = req.nextUrl.searchParams.get('debug') === '1';
    const payload: Record<string, unknown> = { ok: true, total, records: recordsDetails };
    if (debug) {
      payload._debug = {
        todayKyiv,
        kvRecordsCount: rawItemsRecords?.length ?? 0,
        kvWebhookCount: rawItemsWebhook?.length ?? 0,
        clientsTotal: clients.length,
        matchedCount: recordsDetails.length,
      };
    }
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[direct/today-records-total] GET error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
