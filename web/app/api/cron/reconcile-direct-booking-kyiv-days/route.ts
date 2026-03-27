// Щоденне узгодження денормалізованих днів Kyiv з timestamptz (якщо обійшов middleware / старі рядки).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { directKyivDayColumnsExist } from '@/lib/direct-booking-kyiv-ensure';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const secretParam = req.nextUrl.searchParams.get('secret');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const authorized =
    isVercelCron ||
    (cronSecret && (authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret));
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!(await directKyivDayColumnsExist())) {
      const payload = { ok: true, skipped: true, reason: 'kyiv_day_columns_missing' as const };
      console.log('[cron/reconcile-direct-booking-kyiv-days]', payload);
      return NextResponse.json(payload);
    }
    const c1 = await prisma.$executeRaw`
      UPDATE "direct_clients"
      SET "consultationBookingKyivDay" = to_char(timezone('Europe/Kyiv', "consultationBookingDate"), 'YYYY-MM-DD')
      WHERE "consultationBookingDate" IS NOT NULL
        AND (
          "consultationBookingKyivDay" IS NULL
          OR "consultationBookingKyivDay" <> to_char(timezone('Europe/Kyiv', "consultationBookingDate"), 'YYYY-MM-DD')
        )
    `;
    const c2 = await prisma.$executeRaw`
      UPDATE "direct_clients"
      SET "consultationBookingKyivDay" = NULL
      WHERE "consultationBookingDate" IS NULL AND "consultationBookingKyivDay" IS NOT NULL
    `;
    const p1 = await prisma.$executeRaw`
      UPDATE "direct_clients"
      SET "paidServiceKyivDay" = to_char(timezone('Europe/Kyiv', "paidServiceDate"), 'YYYY-MM-DD')
      WHERE "paidServiceDate" IS NOT NULL
        AND (
          "paidServiceKyivDay" IS NULL
          OR "paidServiceKyivDay" <> to_char(timezone('Europe/Kyiv', "paidServiceDate"), 'YYYY-MM-DD')
        )
    `;
    const p2 = await prisma.$executeRaw`
      UPDATE "direct_clients"
      SET "paidServiceKyivDay" = NULL
      WHERE "paidServiceDate" IS NULL AND "paidServiceKyivDay" IS NOT NULL
    `;

    const payload = {
      ok: true,
      updated: {
        consultationMismatches: Number(c1),
        consultationCleared: Number(c2),
        paidMismatches: Number(p1),
        paidCleared: Number(p2),
      },
    };
    console.log('[cron/reconcile-direct-booking-kyiv-days]', payload);
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[cron/reconcile-direct-booking-kyiv-days]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
