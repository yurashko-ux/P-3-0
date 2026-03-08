// API endpoint для міграції statusId: 'new' → 'lead' | 'client'
// За правилом: якщо є altegioClientId → 'client', інакше → 'lead'

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Оновлюємо клієнтів з statusId = 'new': з altegioClientId → 'client', без нього → 'lead'
    const toLead = await prisma.directClient.updateMany({
      where: {
        statusId: 'new',
        altegioClientId: null,
      },
      data: { statusId: 'lead' },
    });

    const toClient = await prisma.directClient.updateMany({
      where: {
        statusId: 'new',
        altegioClientId: { not: null },
      },
      data: { statusId: 'client' },
    });

    const total = toLead.count + toClient.count;

    return NextResponse.json({
      ok: true,
      results: {
        total,
        toLead: toLead.count,
        toClient: toClient.count,
      },
      message: `Оновлено статуси: ${toLead.count} → Лід, ${toClient.count} → Клієнт`,
    });
  } catch (err) {
    console.error('[migrate-statuses-lead-client] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Помилка міграції',
      },
      { status: 500 }
    );
  }
}
