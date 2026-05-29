// web/app/api/admin/direct/inactive-base/clients/route.ts
// Список клієнтів неактивної бази для розділу «Не Активна база».

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enrichClientsWithInstagramAndTelegramChatMeta } from '@/lib/direct-clients-channel-chat-meta';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { computeDaysSinceLastVisit } from '@/lib/inactive-base/days-since-last-visit';
import { isInactiveBaseByDaysSinceLastVisit } from '@/lib/inactive-base/is-inactive-client';
import { bigintToNumber } from '@/lib/inactive-base/telegram-business';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CLIENT_SELECT = {
  id: true,
  instagramUsername: true,
  firstName: true,
  lastName: true,
  phone: true,
  spent: true,
  paidServiceAttended: true,
  paidServiceAttendanceValue: true,
  paidRecordsInHistoryCount: true,
  consultationAttended: true,
  consultationAttendanceValue: true,
  consultationDate: true,
  consultationBookingDate: true,
  paidServiceDate: true,
  lastVisitAt: true,
  lastMessageAt: true,
  chatStatusId: true,
  chatStatusSetAt: true,
  chatStatusCheckedAt: true,
  telegramChatStatusId: true,
  telegramChatStatusSetAt: true,
  telegramChatStatusCheckedAt: true,
  telegramChatId: true,
  telegramUserId: true,
} as const;

type SortField = 'name' | 'daysSinceLastVisit' | 'messagesTotal';

function compareName(
  a: { firstName: string | null; lastName: string | null; instagramUsername: string },
  b: { firstName: string | null; lastName: string | null; instagramUsername: string }
): number {
  const na = [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.instagramUsername;
  const nb = [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || b.instagramUsername;
  return na.localeCompare(nb, 'uk');
}

export async function GET(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100));
    const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
    const sortBy = (req.nextUrl.searchParams.get('sortBy') || 'daysSinceLastVisit') as SortField;
    const sortOrder = req.nextUrl.searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';
    const search = (req.nextUrl.searchParams.get('search') || '').trim().toLowerCase();

    const raw = await prisma.directClient.findMany({
      where: {
        OR: [
          { paidServiceAttended: true },
          { paidServiceAttendanceValue: 1 },
          { paidRecordsInHistoryCount: { gt: 0 } },
          { spent: { gt: 0 } },
        ],
      },
      select: CLIENT_SELECT,
    });

    let withDays = computeDaysSinceLastVisit(raw);
    let inactive = withDays.filter((c) =>
      isInactiveBaseByDaysSinceLastVisit(c, c.daysSinceLastVisit)
    );

    if (search) {
      inactive = inactive.filter((c) => {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
        const ig = (c.instagramUsername || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        return name.includes(search) || ig.includes(search) || phone.includes(search);
      });
    }

    inactive = await enrichClientsWithInstagramAndTelegramChatMeta(inactive);

    inactive.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = compareName(a, b);
      } else if (sortBy === 'messagesTotal') {
        const av =
          typeof (a as unknown as { messagesTotal?: number }).messagesTotal === 'number'
            ? (a as unknown as { messagesTotal: number }).messagesTotal
            : 0;
        const bv =
          typeof (b as unknown as { messagesTotal?: number }).messagesTotal === 'number'
            ? (b as unknown as { messagesTotal: number }).messagesTotal
            : 0;
        cmp = av - bv;
      } else {
        const av = typeof a.daysSinceLastVisit === 'number' ? a.daysSinceLastVisit : -1;
        const bv = typeof b.daysSinceLastVisit === 'number' ? b.daysSinceLastVisit : -1;
        cmp = av - bv;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const totalCount = inactive.length;
    const page = inactive.slice(offset, offset + limit);

    const clients = page.map((c) => ({
      id: c.id,
      instagramUsername: c.instagramUsername,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      daysSinceLastVisit: c.daysSinceLastVisit,
      messagesTotal: (c as { messagesTotal?: number }).messagesTotal ?? 0,
      chatNeedsAttention: Boolean((c as { chatNeedsAttention?: boolean }).chatNeedsAttention),
      chatStatusName: (c as { chatStatusName?: string }).chatStatusName ?? null,
      chatStatusId: c.chatStatusId,
      chatStatusBadgeKey: (c as { chatStatusBadgeKey?: string }).chatStatusBadgeKey ?? null,
      lastMessageAt: c.lastMessageAt,
      telegramMessagesTotal: (c as { telegramMessagesTotal?: number }).telegramMessagesTotal ?? 0,
      telegramChatNeedsAttention: Boolean(
        (c as { telegramChatNeedsAttention?: boolean }).telegramChatNeedsAttention
      ),
      telegramChatStatusName: (c as { telegramChatStatusName?: string }).telegramChatStatusName ?? null,
      telegramChatStatusId: (c as { telegramChatStatusId?: string }).telegramChatStatusId ?? null,
      telegramChatStatusBadgeKey:
        (c as { telegramChatStatusBadgeKey?: string }).telegramChatStatusBadgeKey ?? null,
      telegramLastMessageAt: (c as { telegramLastMessageAt?: string }).telegramLastMessageAt ?? null,
      telegramChatId: bigintToNumber(c.telegramChatId),
      telegramUserId: bigintToNumber(c.telegramUserId),
    }));

    return NextResponse.json({
      ok: true,
      clients,
      totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    });
  } catch (error) {
    console.error('[inactive-base/clients] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
