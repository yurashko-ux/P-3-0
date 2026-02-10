// Аудит сум записів: порівняння paidServiceTotalCost vs breakdown.
// Допомагає зрозуміти, наскільки можна покладатися на дані.

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { kvRead } from '@/lib/kv';
import {
  groupRecordsByClientDay,
  normalizeRecordsLogItems,
  computeGroupTotalCostUAH,
  getPerMasterSumsFromGroup,
  kyivDayFromISO,
} from '@/lib/altegio/records-grouping';

const ADMIN_PASS = process.env.ADMIN_PASS || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

function isAuthorized(req: NextRequest): boolean {
  const adminToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (CRON_SECRET && req.nextUrl.searchParams.get('secret') === CRON_SECRET) return true;
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clients = await getAllDirectClients();
    const rawItemsRecords = await kvRead.lrange('altegio:records:log', 0, 9999);
    const rawItemsWebhook = await kvRead.lrange('altegio:webhook:log', 0, 999);
    const normalizedEvents = normalizeRecordsLogItems([...rawItemsRecords, ...rawItemsWebhook]);
    const groupsByClient = groupRecordsByClientDay(normalizedEvents);

    const withPaidDate = clients.filter((c) => c.paidServiceDate);
    const results: Array<{
      instagram: string;
      fullName: string;
      paidServiceDate: string;
      fromDb: { totalCost: number | null; breakdownTotal: number; breakdown: { masterName: string; sumUAH: number }[] };
      fromKv: { totalCost: number; breakdownTotal: number; breakdown: { masterName: string; sumUAH: number }[] } | null;
      dbMatchesKv: boolean;
      recommendation: string;
    }> = [];

    for (const c of withPaidDate) {
      const groups = groupsByClient.get(c.altegioClientId!) || [];
      const paidKyivDay = kyivDayFromISO(String(c.paidServiceDate));
      const paidGroup = groups.find((g: any) => g?.groupType === 'paid' && (g?.kyivDay || '') === paidKyivDay);
      const dbBreakdown = (c as any).paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
      const dbTotalCost = typeof (c as any).paidServiceTotalCost === 'number' ? (c as any).paidServiceTotalCost : null;

      const dbBreakdownTotal = Array.isArray(dbBreakdown)
        ? dbBreakdown.reduce((a, x) => a + x.sumUAH, 0)
        : 0;
      const kvTotalCost = paidGroup ? computeGroupTotalCostUAH(paidGroup) : 0;
      const kvBreakdown = paidGroup ? getPerMasterSumsFromGroup(paidGroup, null, null) : [];
      const kvBreakdownTotal = kvBreakdown.reduce((a, x) => a + x.sumUAH, 0);

      const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.instagramUsername || '—';
      const kvData =
        paidGroup && (kvTotalCost > 0 || kvBreakdown.length > 0)
          ? { totalCost: kvTotalCost, breakdownTotal: kvBreakdownTotal, breakdown: kvBreakdown }
          : null;

      const dbMatchesKv =
        kvData != null &&
        dbTotalCost != null &&
        Math.abs(dbTotalCost - kvData.totalCost) <= 500 &&
        Math.abs(dbBreakdownTotal - kvData.breakdownTotal) <= 500;

      let recommendation: string;
      if (!kvData) {
        recommendation = '⚠️ Немає даних у KV (вебхуки). Можна перевірити вручну в Altegio.';
      } else if (Math.abs(dbBreakdownTotal - kvData.totalCost) > Math.max(1000, (kvData.totalCost || 1) * 0.15)) {
        recommendation =
          '✅ Довіряємо KV (вебхукам). Breakdown з API не узгоджений — у UI показуємо суму з KV.';
      } else if (dbMatchesKv) {
        recommendation = '✅ DB і KV узгоджені. Дані надійні.';
      } else {
        recommendation = '⚠️ Є розбіжність. Рекомендується перевірити в Altegio.';
      }

      results.push({
        instagram: c.instagramUsername || '—',
        fullName,
        paidServiceDate: String(c.paidServiceDate).slice(0, 10),
        fromDb: {
          totalCost: dbTotalCost,
          breakdownTotal: dbBreakdownTotal,
          breakdown: Array.isArray(dbBreakdown) ? dbBreakdown : [],
        },
        fromKv: kvData,
        dbMatchesKv,
        recommendation,
      });
    }

    const withKvData = results.filter((r) => r.fromKv != null);
    const mismatched = results.filter(
      (r) =>
        r.fromKv != null &&
        Math.abs((r.fromDb.breakdownTotal || 0) - (r.fromKv?.totalCost || 0)) >
          Math.max(1000, ((r.fromKv?.totalCost || 0) || 1) * 0.15)
    );
    const ok = withKvData.filter((r) => !mismatched.includes(r));

    return NextResponse.json({
      ok: true,
      summary: {
        totalWithPaidRecord: withPaidDate.length,
        withKvData: withKvData.length,
        dbMatchesKv: ok.length,
        mismatchedDbVsKv: mismatched.length,
        noKvData: withPaidDate.length - withKvData.length,
      },
      note: 'Джерело правди — вебхуки (KV). Якщо DB (API) не збігається з KV, у UI показуємо дані з KV.',
      results: results.slice(0, 50),
      mismatchedSample: mismatched.slice(0, 20),
    });
  } catch (err) {
    console.error('[audit-breakdown]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
