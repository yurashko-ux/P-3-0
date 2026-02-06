// web/app/api/admin/direct/footer-stats/route.ts
// Футер-статистика для Direct (поточний місяць): З початку місяця | Сьогодні | До кінця місяця

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

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

type FooterStatsBlock = {
  createdConsultations: number;
  successfulConsultations: number;
  cancelledOrNoShow: number;
  sales: number;
  conversion1Rate?: number;
  conversion2Rate?: number;
  createdPaidSum: number;
  plannedPaidSum: number;
};

/** Додаткові KPI лише для блоку «Сьогодні» (піктограми в футері) */
export type FooterTodayStats = FooterStatsBlock & {
  /** Консультації: створені (дата запису = сьогодні) */
  consultationCreated: number;
  /** Консультації: заплановані (сьогодні, без результату) */
  consultationPlanned: number;
  /** Консультації: реалізовані (сьогодні, прийшов) */
  consultationRealized: number;
  /** Консультації: не прийшов (сьогодні) */
  consultationNoShow: number;
  /** Консультації: скасовані (сьогодні) */
  consultationCancelled: number;
  /** Нові платні клієнти (продаж після консультації) за сьогодні */
  newPaidClients: number;
  /** Сума створених записів за сьогодні (тис. грн) */
  recordsCreatedSum: number;
  /** Сума реалізованих записів за сьогодні (тис. грн) */
  recordsRealizedSum: number;
  /** Кількість перезаписів (🔁) за сьогодні */
  rebookingsCount: number;
  /** Доп продажі (продукція без груп волосся) за сьогодні */
  upsalesGoodsSum: number;
  /** Нові клієнти (голубий фон у колонці Майстер) за сьогодні */
  newClientsCount: number;
};

const emptyBlock = (): FooterStatsBlock => ({
  createdConsultations: 0,
  successfulConsultations: 0,
  cancelledOrNoShow: 0,
  sales: 0,
  createdPaidSum: 0,
  plannedPaidSum: 0,
});

function emptyTodayBlock(): FooterTodayStats {
  return {
    ...emptyBlock(),
    consultationCreated: 0,
    consultationPlanned: 0,
    consultationRealized: 0,
    consultationNoShow: 0,
    consultationCancelled: 0,
    newPaidClients: 0,
    recordsCreatedSum: 0,
    recordsRealizedSum: 0,
    rebookingsCount: 0,
    upsalesGoodsSum: 0,
    newClientsCount: 0,
  };
}

const toKyivDay = (iso?: string | null): string => {
  if (!iso) return '';
  return kyivDayFromISO(String(iso));
};

const getMonthBounds = (todayKyiv: string): { start: string; end: string } => {
  const [y, m] = todayKyiv.split('-');
  const year = Number(y);
  const month = Number(m);
  const monthIndex = Math.max(0, month - 1);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${pad(lastDay)}` };
};

const getPaidSum = (client: any): number => {
  const breakdown = Array.isArray(client?.paidServiceVisitBreakdown) ? client.paidServiceVisitBreakdown : null;
  if (breakdown && breakdown.length > 0) {
    return breakdown.reduce((acc: number, b: any) => acc + (Number(b?.sumUAH) || 0), 0);
  }
  const cost = Number(client?.paidServiceTotalCost);
  return Number.isFinite(cost) ? cost : 0;
};

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clients = await getAllDirectClients();

    const todayKyiv = kyivDayFromISO(new Date().toISOString());
    const { start, end } = getMonthBounds(todayKyiv);

    const stats = {
      past: emptyBlock(),
      today: emptyTodayBlock(),
      future: emptyBlock(),
    };

    let consultBookedPast = 0;
    let consultAttendedPast = 0;
    let salesFromConsultPast = 0;
    const newClientsIdsToday = new Set<string>();

    const addByDay = (day: string, apply: (block: FooterStatsBlock) => void) => {
      if (!day || day < start || day > end) return;
      if (day <= todayKyiv) {
        apply(stats.past);
        if (day === todayKyiv) apply(stats.today);
      } else {
        apply(stats.future);
      }
    };

    for (const client of clients) {
      const visitsCount = typeof client.visits === 'number' ? client.visits : 0;
      const isEligibleSale = client.consultationAttended === true && !!client.paidServiceDate && visitsCount < 2;
      const paidSum = getPaidSum(client);
      const t = stats.today as FooterTodayStats;

      // 1) Створено консультацій (по даті створення або даті запису)
      const consultCreatedDay = toKyivDay((client as any).consultationRecordCreatedAt || client.consultationBookingDate);
      if (consultCreatedDay) {
        addByDay(consultCreatedDay, (b) => {
          b.createdConsultations += 1;
        });
        if (consultCreatedDay === todayKyiv) t.consultationCreated += 1;
      }

      // 2) Успішні / 3) Скасовані та не відбулися (по даті консультації) + 5 станів для сьогодні
      const consultDay = toKyivDay(client.consultationBookingDate);
      if (consultDay) {
        addByDay(consultDay, (b) => {
          if (client.consultationAttended === true) b.successfulConsultations += 1;
          else if (client.consultationCancelled || client.consultationAttended === false) b.cancelledOrNoShow += 1;
        });
        if (consultDay === todayKyiv) {
          if (client.consultationCancelled) t.consultationCancelled += 1;
          else if (client.consultationAttended === true) t.consultationRealized += 1;
          else if (client.consultationAttended === false) t.consultationNoShow += 1;
          else t.consultationPlanned += 1;
        }

        if (consultDay >= start && consultDay <= todayKyiv) {
          consultBookedPast += 1;
          if (client.consultationAttended === true) consultAttendedPast += 1;
          if (client.consultationAttended === true && isEligibleSale) salesFromConsultPast += 1;
        }
      }

      // 4) Продажі (нові платні клієнти) за сьогодні
      const paidDay = toKyivDay(client.paidServiceDate);
      if (isEligibleSale && paidDay) {
        addByDay(paidDay, (b) => {
          b.sales += 1;
        });
      }

      // 7) Сума створених записів (по даті створення платного або даті запису як fallback)
      const paidCreatedDay = toKyivDay((client as any).paidServiceRecordCreatedAt) || paidDay;
      if (paidSum > 0 && paidCreatedDay) {
        addByDay(paidCreatedDay, (b) => {
          b.createdPaidSum += paidSum;
        });
        if (paidCreatedDay === todayKyiv) t.recordsCreatedSum += paidSum;
      }

      // 8) Сума запланованих та реалізованих записів за сьогодні
      if (paidSum > 0 && paidDay) {
        addByDay(paidDay, (b) => {
          b.plannedPaidSum += paidSum;
        });
        if (paidDay === todayKyiv && client.paidServiceAttended === true) t.recordsRealizedSum += paidSum;
      }

      // Перезаписи (🔁) — поки 0, потрібне поле paidServiceIsRebooking з KV/енричменту
      if (paidDay === todayKyiv && (client as any).paidServiceIsRebooking === true) t.rebookingsCount += 1;

      // Нові клієнти за сьогодні (голубий фон у колонці Майстер)
      if (visitsCount < 2) {
        if ((consultDay === todayKyiv && client.consultationAttended === true) ||
            (paidDay === todayKyiv && client.paidServiceAttended === true)) {
          newClientsIdsToday.add(client.id);
        }
      }
    }

    (stats.today as FooterTodayStats).newClientsCount = newClientsIdsToday.size;
    (stats.today as FooterTodayStats).newPaidClients = stats.today.sales;

    stats.past.conversion1Rate = consultBookedPast > 0 ? (consultAttendedPast / consultBookedPast) * 100 : 0;
    stats.past.conversion2Rate = consultAttendedPast > 0 ? (salesFromConsultPast / consultAttendedPast) * 100 : 0;

    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error('[direct/footer-stats] GET error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
