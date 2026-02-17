// web/app/api/admin/direct/debug-new-leads/route.ts
// Діагностика підрахунку «Нові ліди»

import { NextRequest, NextResponse } from 'next/server';
import { getAllDirectClients } from '@/lib/direct-store';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';

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

function toKyivDay(iso?: string | null): string {
  if (!iso) return '';
  return kyivDayFromISO(String(iso));
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dayParam = (req.nextUrl.searchParams.get('day') || '').trim().replace(/\//g, '-');
    const todayKyiv = /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam
      : kyivDayFromISO(new Date().toISOString());

    const clients = await getAllDirectClients();

    const recentClients: Array<{
      id: string;
      instagramUsername: string;
      firstContactDate: string;
      createdAt: string;
      firstContactDay: string;
      isNewLeadToday: boolean;
    }> = [];

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const cutoff = twoDaysAgo.getTime();

    let newLeadsCount = 0;
    const isPlaceholderUsername = (u?: string | null) =>
      !u || u.startsWith('missing_instagram_') || u.startsWith('no_instagram_');

    for (const c of clients) {
      if (isPlaceholderUsername((c as any).instagramUsername)) continue;
      const firstContactDate = (c as any).firstContactDate;
      const createdAt = (c as any).createdAt;
      const firstContactDay = toKyivDay(firstContactDate || createdAt);

      if (firstContactDay === todayKyiv) newLeadsCount++;

      const createdTs = createdAt ? new Date(createdAt).getTime() : 0;
      if (createdTs >= cutoff) {
        recentClients.push({
          id: c.id,
          instagramUsername: c.instagramUsername || '',
          firstContactDate: firstContactDate ? String(firstContactDate) : '',
          createdAt: createdAt ? String(createdAt) : '',
          firstContactDay,
          isNewLeadToday: firstContactDay === todayKyiv,
        });
      }
    }

    recentClients.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({
      ok: true,
      todayKyiv,
      dayParam: dayParam || '(не передано, використано сервер)',
      newLeadsCount,
      totalClients: clients.length,
      recentClientsLast2Days: recentClients.slice(0, 30),
    });
  } catch (err) {
    console.error('[debug-new-leads] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
