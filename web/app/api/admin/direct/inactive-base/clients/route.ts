// web/app/api/admin/direct/inactive-base/clients/route.ts
// Список клієнтів неактивної бази для розділу «Не Активна база».

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enrichClientsWithInstagramAndTelegramChatMeta } from '@/lib/direct-clients-channel-chat-meta';
import { enrichClientsWithCallMeta } from '@/lib/direct-clients-communication-meta';
import { isInactiveBaseAuthorized } from '@/lib/inactive-base/auth';
import { computeDaysSinceLastVisit } from '@/lib/inactive-base/days-since-last-visit';
import { isInactiveBaseByDaysSinceLastVisit } from '@/lib/inactive-base/is-inactive-client';
import {
  enrichClientsWithCampaignChatStats,
  getAudienceJoinBaselinesForCampaign,
  getClientIdsForCampaign,
  getLastCampaignByClientIds,
  hasAnyInactiveBaseCampaigns,
  parseInactiveBaseCampaignChannels,
} from '@/lib/inactive-base/campaign-audience';
import { bigintToNumber } from '@/lib/inactive-base/telegram-business';
import {
  computeInstInstagramCounts,
  filterByInstInstagram,
  parseInstInstagramFilter,
} from '@/lib/inactive-base/instagram-presence-filter';
import {
  computeTelegramCanSendCounts,
  filterByTelegramCanSend,
  parseTelegramCanSendFilter,
} from '@/lib/inactive-base/telegram-can-send-filter';

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
  callStatusId: true,
} as const;

const SORT_FIELDS = [
  'name',
  'instagramUsername',
  'messagesTotal',
  'telegramMessagesTotal',
  'phone',
  'daysSinceLastVisit',
] as const;

type SortField = (typeof SORT_FIELDS)[number];

function compareName(
  a: { firstName: string | null; lastName: string | null; instagramUsername: string },
  b: { firstName: string | null; lastName: string | null; instagramUsername: string }
): number {
  const na = [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.instagramUsername;
  const nb = [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || b.instagramUsername;
  return na.localeCompare(nb, 'uk');
}

function comparePhone(a: string | null | undefined, b: string | null | undefined): number {
  const da = (a || '').replace(/\D/g, '');
  const db = (b || '').replace(/\D/g, '');
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.localeCompare(db);
}

function numField(c: Record<string, unknown>, key: string): number {
  const v = c[key];
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

export async function GET(req: NextRequest) {
  if (!isInactiveBaseAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100));
    const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0);
    const sortByRaw = req.nextUrl.searchParams.get('sortBy') || 'daysSinceLastVisit';
    const sortBy: SortField = (SORT_FIELDS as readonly string[]).includes(sortByRaw)
      ? (sortByRaw as SortField)
      : 'daysSinceLastVisit';
    const sortOrder = req.nextUrl.searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';
    const search = (req.nextUrl.searchParams.get('search') || '').trim().toLowerCase();
    const instInstagramFilter = parseInstInstagramFilter(
      req.nextUrl.searchParams.get('instInstagram')
    );
    const telegramCanSendFilter = parseTelegramCanSendFilter(
      req.nextUrl.searchParams.get('telegramCanSend')
    );
    const campaignId = (req.nextUrl.searchParams.get('campaignId') || '').trim();
    const campaignClientIds = campaignId ? await getClientIdsForCampaign(campaignId) : null;

    let campaignMeta: {
      id: string;
      name: string;
      channels: ReturnType<typeof parseInactiveBaseCampaignChannels>;
      createdAt: string;
    } | null = null;
    if (campaignId) {
      const camp = await prisma.inactiveBaseCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, name: true, channels: true, createdAt: true },
      });
      if (!camp) {
        return NextResponse.json({ ok: false, error: 'Кампанію не знайдено' }, { status: 404 });
      }
      campaignMeta = {
        id: camp.id,
        name: camp.name,
        channels: parseInactiveBaseCampaignChannels(camp.channels),
        createdAt: camp.createdAt.toISOString(),
      };
    }

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

    if (campaignClientIds) {
      inactive = inactive.filter((c) => campaignClientIds.has(c.id));
    }

    if (search) {
      inactive = inactive.filter((c) => {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
        const ig = (c.instagramUsername || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        return name.includes(search) || ig.includes(search) || phone.includes(search);
      });
    }

    inactive = await enrichClientsWithInstagramAndTelegramChatMeta(inactive);
    inactive = await enrichClientsWithCallMeta(inactive);

    const instInstagramCounts = computeInstInstagramCounts(inactive);
    const telegramCanSendCounts = computeTelegramCanSendCounts(inactive);
    if (instInstagramFilter.length > 0) {
      inactive = filterByInstInstagram(inactive, instInstagramFilter);
    }
    if (telegramCanSendFilter.length > 0) {
      inactive = filterByTelegramCanSend(inactive, telegramCanSendFilter);
    }

    const showCampaignColumn = await hasAnyInactiveBaseCampaigns();

    const lastCampaignMap = showCampaignColumn
      ? await getLastCampaignByClientIds(inactive.map((c) => c.id))
      : new Map();

    if (campaignMeta) {
      const joinBaselines = await getAudienceJoinBaselinesForCampaign(campaignMeta.id);
      inactive = inactive.map((c) => {
        const joined = joinBaselines.get(c.id);
        return {
          ...c,
          lastCampaign: joined
            ? {
                name: campaignMeta!.name,
                at: joined.toISOString(),
                campaignId: campaignMeta!.id,
                channels: campaignMeta!.channels,
                createdAt: campaignMeta!.createdAt,
                joinedAt: joined.toISOString(),
              }
            : null,
        };
      });
    } else {
      inactive = inactive.map((c) => {
        const lc = lastCampaignMap.get(c.id);
        if (!lc) return { ...c, lastCampaign: null };
        return {
          ...c,
          lastCampaign: {
            name: lc.name,
            at: lc.at,
            campaignId: lc.campaignId,
            channels: lc.channels,
            createdAt: lc.createdAt,
            joinedAt: lc.joinedAt,
          },
        };
      });
    }

    inactive = await enrichClientsWithCampaignChatStats(inactive);

    inactive.sort((a, b) => {
      let cmp = 0;
      const ar = a as Record<string, unknown>;
      const br = b as Record<string, unknown>;
      switch (sortBy) {
        case 'name':
          cmp = compareName(a, b);
          break;
        case 'instagramUsername':
          cmp = (a.instagramUsername || '').localeCompare(b.instagramUsername || '', 'uk');
          break;
        case 'messagesTotal':
          cmp = numField(ar, 'messagesTotal') - numField(br, 'messagesTotal');
          break;
        case 'telegramMessagesTotal':
          cmp = numField(ar, 'telegramMessagesTotal') - numField(br, 'telegramMessagesTotal');
          break;
        case 'phone':
          cmp = comparePhone(a.phone, b.phone);
          break;
        case 'daysSinceLastVisit':
        default: {
          const av = typeof a.daysSinceLastVisit === 'number' ? a.daysSinceLastVisit : -1;
          const bv = typeof b.daysSinceLastVisit === 'number' ? b.daysSinceLastVisit : -1;
          cmp = av - bv;
          break;
        }
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
      lastCampaign: (c as { lastCampaign?: unknown }).lastCampaign ?? null,
      campaignIncomingInstagram:
        (c as { campaignIncomingInstagram?: number }).campaignIncomingInstagram ?? 0,
      campaignIncomingTelegram:
        (c as { campaignIncomingTelegram?: number }).campaignIncomingTelegram ?? 0,
      campaignResponded: Boolean((c as { campaignResponded?: boolean }).campaignResponded),
      campaignLastIncomingInstagram:
        (c as { campaignLastIncomingInstagram?: string | null }).campaignLastIncomingInstagram ?? null,
      campaignLastIncomingTelegram:
        (c as { campaignLastIncomingTelegram?: string | null }).campaignLastIncomingTelegram ?? null,
      campaignNeedsAttentionInstagram: Boolean(
        (c as { campaignNeedsAttentionInstagram?: boolean }).campaignNeedsAttentionInstagram
      ),
      campaignNeedsAttentionTelegram: Boolean(
        (c as { campaignNeedsAttentionTelegram?: boolean }).campaignNeedsAttentionTelegram
      ),
      campaignOutgoingSystemTelegram:
        (c as { campaignOutgoingSystemTelegram?: number }).campaignOutgoingSystemTelegram ?? 0,
      campaignOutgoingManualTelegram:
        (c as { campaignOutgoingManualTelegram?: number }).campaignOutgoingManualTelegram ?? 0,
      campaignOutgoingInstagram:
        (c as { campaignOutgoingInstagram?: number }).campaignOutgoingInstagram ?? 0,
      telegramIncomingCount: (c as { telegramIncomingCount?: number }).telegramIncomingCount ?? 0,
      instagramIncomingCount: (c as { instagramIncomingCount?: number }).instagramIncomingCount ?? 0,
      instagramOutgoingCount: (c as { instagramOutgoingCount?: number }).instagramOutgoingCount ?? 0,
      telegramOutgoingSystemCount:
        (c as { telegramOutgoingSystemCount?: number }).telegramOutgoingSystemCount ?? 0,
      telegramOutgoingManualCount:
        (c as { telegramOutgoingManualCount?: number }).telegramOutgoingManualCount ?? 0,
      callStatusId: (c as { callStatusId?: string | null }).callStatusId ?? null,
      callStatusName: (c as { callStatusName?: string }).callStatusName ?? null,
      callStatusBadgeKey: (c as { callStatusBadgeKey?: string }).callStatusBadgeKey ?? null,
      binotelCallsCount: (c as { binotelCallsCount?: number }).binotelCallsCount ?? 0,
      binotelLatestCallRecordingUrl:
        (c as { binotelLatestCallRecordingUrl?: string | null }).binotelLatestCallRecordingUrl ?? null,
      binotelLatestCallGeneralID:
        (c as { binotelLatestCallGeneralID?: string | null }).binotelLatestCallGeneralID ?? null,
      binotelLatestCallType: (c as { binotelLatestCallType?: string | null }).binotelLatestCallType ?? null,
      binotelLatestCallDisposition:
        (c as { binotelLatestCallDisposition?: string | null }).binotelLatestCallDisposition ?? null,
      binotelLatestCallStartTime:
        (c as { binotelLatestCallStartTime?: string | null }).binotelLatestCallStartTime ?? null,
    }));

    return NextResponse.json({
      ok: true,
      clients,
      showCampaignColumn,
      campaignFilter: campaignMeta,
      totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
      sortBy,
      sortOrder,
      instInstagramCounts,
      telegramCanSendCounts,
    });
  } catch (error) {
    console.error('[inactive-base/clients] GET error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
