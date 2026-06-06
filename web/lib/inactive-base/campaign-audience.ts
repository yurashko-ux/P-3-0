// Аудиторія кампанії (виділені клієнти) та остання кампанія по клієнту.

import { prisma } from '@/lib/prisma';
import {
  DIRECT_MESSAGE_SOURCES_BY_CHANNEL,
  isSourceForChannel,
  isTelegramCampaignSource,
  TELEGRAM_CAMPAIGN_SOURCE,
  type DirectChatChannel,
} from '@/lib/direct-channel-chat';
import { renderCampaignBody } from '@/lib/inactive-base/campaign-template';
import { clientCanReceiveTelegramSystemMessage } from '@/lib/inactive-base/telegram-can-send-filter';

export const INACTIVE_BASE_AUDIENCE_CHANNEL = 'audience';

/** Службова кампанія (не показується в UI) для зняття клієнта з груп. */
export const INACTIVE_BASE_UNGROUPED_CAMPAIGN_INTERNAL_NAME = '__inactive_base_no_group__';
export const INACTIVE_BASE_UNGROUPED_CHANNEL = 'ungrouped';

export function isInactiveBaseSystemCampaign(name: string): boolean {
  return name.trim() === INACTIVE_BASE_UNGROUPED_CAMPAIGN_INTERNAL_NAME;
}

export type LastCampaignInfo = {
  campaignId: string;
  name: string;
  at: string;
  channels: DirectChatChannel[];
  /** Дата створення кампанії (групи). */
  createdAt: string;
  /** Останнє додавання в цю кампанію (audience); після перенесення — нова дата. */
  joinedAt: string;
};

export type CampaignResponseStats = {
  clientCount: number;
  respondedCount: number;
};

export type ClientCampaignChatStats = {
  campaignIncomingInstagram: number;
  campaignIncomingTelegram: number;
  campaignOutgoingSystemTelegram: number;
  campaignOutgoingManualTelegram: number;
  campaignResponded: boolean;
  campaignLastIncomingInstagram: string | null;
  campaignLastIncomingTelegram: string | null;
  campaignNeedsAttentionInstagram: boolean;
  campaignNeedsAttentionTelegram: boolean;
  campaignOutgoingInstagram: number;
  telegramIncomingCount: number;
  telegramOutgoingSystemCount: number;
  telegramOutgoingManualCount: number;
  instagramIncomingCount: number;
  instagramOutgoingCount: number;
};

export type CampaignTelegramSendReadiness = {
  canSend: boolean;
  audienceCount: number;
  withTelegramCount: number;
  withoutTelegramCount: number;
};

export type CampaignTelegramActiveClientCounts = {
  outgoingManualCount: number;
  outgoingSystemCount: number;
  incomingCount: number;
};

export function parseInactiveBaseCampaignChannels(ch: unknown): DirectChatChannel[] {
  if (!Array.isArray(ch)) return ['instagram', 'telegram'];
  return ch.filter((x): x is DirectChatChannel => x === 'telegram' || x === 'instagram');
}

/** Baseline відповіді: останній audience-запис клієнта в цій кампанії (max createdAt). */
export async function getAudienceJoinBaselinesForCampaign(
  campaignId: string
): Promise<Map<string, Date>> {
  const rows = await prisma.inactiveBaseCampaignDelivery.findMany({
    where: {
      status: INACTIVE_BASE_AUDIENCE_CHANNEL,
      run: { campaignId, channel: INACTIVE_BASE_AUDIENCE_CHANNEL },
    },
    select: { clientId: true, createdAt: true },
  });

  const map = new Map<string, Date>();
  for (const row of rows) {
    const prev = map.get(row.clientId);
    if (!prev || row.createdAt > prev) {
      map.set(row.clientId, row.createdAt);
    }
  }
  return map;
}

function messageMatchesCampaignChannel(
  source: string,
  channels: DirectChatChannel[]
): boolean {
  if (channels.includes('instagram') && isSourceForChannel(source, 'instagram')) return true;
  if (channels.includes('telegram') && isSourceForChannel(source, 'telegram')) return true;
  return false;
}

function countIncomingSinceBaseline(
  messages: Array<{ clientId: string; source: string; receivedAt: Date }>,
  baselines: Map<string, Date>,
  channels: DirectChatChannel[]
): { perClient: Map<string, { instagram: number; telegram: number; lastIg?: Date; lastTg?: Date }>; respondedIds: Set<string> } {
  const perClient = new Map<string, { instagram: number; telegram: number; lastIg?: Date; lastTg?: Date }>();
  const respondedIds = new Set<string>();

  for (const m of messages) {
    const baseline = baselines.get(m.clientId);
    if (!baseline || m.receivedAt <= baseline) continue;
    if (!messageMatchesCampaignChannel(m.source, channels)) continue;

    respondedIds.add(m.clientId);
    let bucket = perClient.get(m.clientId);
    if (!bucket) {
      bucket = { instagram: 0, telegram: 0 };
      perClient.set(m.clientId, bucket);
    }
    if (isSourceForChannel(m.source, 'telegram')) {
      bucket.telegram += 1;
      if (!bucket.lastTg || m.receivedAt > bucket.lastTg) bucket.lastTg = m.receivedAt;
    } else {
      bucket.instagram += 1;
      if (!bucket.lastIg || m.receivedAt > bucket.lastIg) bucket.lastIg = m.receivedAt;
    }
  }

  return { perClient, respondedIds };
}

type TelegramMsgRow = {
  clientId: string;
  direction: string;
  source: string;
  receivedAt: Date;
};

type TelegramCounterBucket = {
  incoming: number;
  outgoingSystem: number;
  outgoingManual: number;
};

function emptyTelegramBucket(): TelegramCounterBucket {
  return { incoming: 0, outgoingSystem: 0, outgoingManual: 0 };
}

type InstagramMsgRow = {
  clientId: string;
  direction: string;
  source: string;
  receivedAt: Date;
};

type InstagramCounterBucket = {
  incoming: number;
  outgoing: number;
};

function emptyInstagramBucket(): InstagramCounterBucket {
  return { incoming: 0, outgoing: 0 };
}

function countInstagramMessages(
  messages: InstagramMsgRow[],
  baselines: Map<string, Date | null>
): Map<string, InstagramCounterBucket> {
  const perClient = new Map<string, InstagramCounterBucket>();

  for (const m of messages) {
    if (!isSourceForChannel(m.source, 'instagram')) continue;
    const baseline = baselines.get(m.clientId);
    if (baseline != null && m.receivedAt <= baseline) continue;

    let bucket = perClient.get(m.clientId);
    if (!bucket) {
      bucket = emptyInstagramBucket();
      perClient.set(m.clientId, bucket);
    }

    if (m.direction === 'incoming') bucket.incoming += 1;
    else if (m.direction === 'outgoing') bucket.outgoing += 1;
  }

  return perClient;
}

function countTelegramMessages(
  messages: TelegramMsgRow[],
  baselines: Map<string, Date | null>
): Map<string, TelegramCounterBucket> {
  const perClient = new Map<string, TelegramCounterBucket>();

  for (const m of messages) {
    const baseline = baselines.get(m.clientId);
    if (baseline != null && m.receivedAt <= baseline) continue;

    let bucket = perClient.get(m.clientId);
    if (!bucket) {
      bucket = emptyTelegramBucket();
      perClient.set(m.clientId, bucket);
    }

    if (m.direction === 'incoming' && m.source === 'telegram') {
      bucket.incoming += 1;
    } else if (m.direction === 'outgoing' && isTelegramCampaignSource(m.source)) {
      bucket.outgoingSystem += 1;
    } else if (m.direction === 'outgoing' && m.source === 'telegram') {
      bucket.outgoingManual += 1;
    }
  }

  return perClient;
}

function aggregateTelegramActiveClientCounts(
  perClient: Map<string, TelegramCounterBucket>
): CampaignTelegramActiveClientCounts {
  let outgoingManualCount = 0;
  let outgoingSystemCount = 0;
  let incomingCount = 0;
  for (const bucket of perClient.values()) {
    if (bucket.outgoingManual > 0) outgoingManualCount += 1;
    if (bucket.outgoingSystem > 0) outgoingSystemCount += 1;
    if (bucket.incoming > 0) incomingCount += 1;
  }
  return { outgoingManualCount, outgoingSystemCount, incomingCount };
}

function emptyTelegramActiveClientCounts(): CampaignTelegramActiveClientCounts {
  return { outgoingManualCount: 0, outgoingSystemCount: 0, incomingCount: 0 };
}

function emptyCampaignChatStats(): ClientCampaignChatStats {
  return {
    campaignIncomingInstagram: 0,
    campaignIncomingTelegram: 0,
    campaignOutgoingSystemTelegram: 0,
    campaignOutgoingManualTelegram: 0,
    campaignResponded: false,
    campaignLastIncomingInstagram: null,
    campaignLastIncomingTelegram: null,
    campaignNeedsAttentionInstagram: false,
    campaignNeedsAttentionTelegram: false,
    campaignOutgoingInstagram: 0,
    telegramIncomingCount: 0,
    telegramOutgoingSystemCount: 0,
    telegramOutgoingManualCount: 0,
    instagramIncomingCount: 0,
    instagramOutgoingCount: 0,
  };
}

export async function getCampaignResponseCounts(
  campaignIds: string[]
): Promise<Map<string, CampaignResponseStats>> {
  const map = new Map<string, CampaignResponseStats>();
  if (campaignIds.length === 0) return map;

  const [audienceCounts, campaigns] = await Promise.all([
    getCampaignAudienceCounts(campaignIds),
    prisma.inactiveBaseCampaign.findMany({
      where: { id: { in: campaignIds } },
      select: { id: true, channels: true },
    }),
  ]);
  const channelsByCampaign = new Map(
    campaigns.map((c) => [c.id, parseInactiveBaseCampaignChannels(c.channels)])
  );

  for (const campaignId of campaignIds) {
    const baselines = await getAudienceJoinBaselinesForCampaign(campaignId);
    const clientIds = [...baselines.keys()];
    const channels = channelsByCampaign.get(campaignId) ?? ['instagram', 'telegram'];
    const clientCount = audienceCounts.get(campaignId) ?? clientIds.length;

    if (clientIds.length === 0) {
      map.set(campaignId, { clientCount, respondedCount: 0 });
      continue;
    }

    const sources = new Set<string>();
    if (channels.includes('instagram')) {
      for (const s of DIRECT_MESSAGE_SOURCES_BY_CHANNEL.instagram) sources.add(s);
    }
    if (channels.includes('telegram')) {
      sources.add('telegram');
      sources.add(TELEGRAM_CAMPAIGN_SOURCE);
    }

    const messages = await prisma.directMessage.findMany({
      where: {
        clientId: { in: clientIds },
        direction: 'incoming',
        source: { in: [...sources] },
      },
      select: { clientId: true, source: true, receivedAt: true },
    });

    const { respondedIds } = countIncomingSinceBaseline(messages, baselines, channels);
    map.set(campaignId, { clientCount, respondedCount: respondedIds.size });
  }

  return map;
}

type ClientWithLastCampaign = {
  id: string;
  lastCampaign?: {
    campaignId?: string;
    joinedAt?: string;
    channels?: DirectChatChannel[];
  } | null;
  chatStatusId?: string | null;
  chatStatusSetAt?: Date | string | null;
  chatStatusCheckedAt?: Date | string | null;
  telegramChatStatusId?: string | null;
  telegramChatStatusSetAt?: Date | string | null;
  telegramChatStatusCheckedAt?: Date | string | null;
};

function thresholdTs(isoOrDate: string | Date | null | undefined): number {
  const s = isoOrDate != null ? String(isoOrDate).trim() : '';
  if (!s) return NaN;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function needsAttentionSinceJoin(
  lastIncoming: Date | undefined,
  joinedAt: Date,
  statusId: string | undefined,
  checkedAt: string | Date | null | undefined,
  setAt: string | Date | null | undefined
): boolean {
  if (!lastIncoming || lastIncoming <= joinedAt) return false;
  const threshold = thresholdTs(checkedAt) || thresholdTs(setAt);
  if (Number.isFinite(threshold)) return lastIncoming.getTime() > threshold;
  return !Boolean((statusId || '').trim());
}

/** Вхідні після join у поточну (останню) кампанію — для колонок Inst/Telegram. */
export async function enrichClientsWithCampaignChatStats<T extends ClientWithLastCampaign>(
  clients: T[]
): Promise<(T & ClientCampaignChatStats)[]> {
  const targets = clients.filter(
    (c) => c.lastCampaign?.campaignId && c.lastCampaign.joinedAt && (c.lastCampaign.channels?.length ?? 0) > 0
  );

  const allClientIds = clients.map((c) => c.id);
  const allSources = new Set<string>([
    ...DIRECT_MESSAGE_SOURCES_BY_CHANNEL.instagram,
    'telegram',
    TELEGRAM_CAMPAIGN_SOURCE,
  ]);

  const [incomingMessages, telegramMessages, instagramMessages] = await Promise.all([
    targets.length > 0
      ? prisma.directMessage.findMany({
          where: {
            clientId: { in: targets.map((c) => c.id) },
            direction: 'incoming',
            source: { in: [...allSources] },
          },
          select: { clientId: true, source: true, receivedAt: true },
        })
      : Promise.resolve([]),
    allClientIds.length > 0
      ? prisma.directMessage.findMany({
          where: {
            clientId: { in: allClientIds },
            source: { in: ['telegram', TELEGRAM_CAMPAIGN_SOURCE] },
          },
          select: { clientId: true, direction: true, source: true, receivedAt: true },
        })
      : Promise.resolve([]),
    allClientIds.length > 0
      ? prisma.directMessage.findMany({
          where: {
            clientId: { in: allClientIds },
            source: { in: [...DIRECT_MESSAGE_SOURCES_BY_CHANNEL.instagram] },
          },
          select: { clientId: true, direction: true, source: true, receivedAt: true },
        })
      : Promise.resolve([]),
  ]);

  type Bucket = { instagram: number; telegram: number; lastIg?: Date; lastTg?: Date };
  const statsByClient = new Map<string, Bucket>();

  for (const c of targets) {
    const joinedAt = new Date(c.lastCampaign!.joinedAt!);
    const baselines = new Map([[c.id, joinedAt]]);
    const channels = c.lastCampaign!.channels ?? ['instagram', 'telegram'];
    const { perClient } = countIncomingSinceBaseline(incomingMessages, baselines, channels);
    statsByClient.set(c.id, perClient.get(c.id) ?? { instagram: 0, telegram: 0 });
  }

  const allTimeBaseline = new Map(allClientIds.map((id) => [id, null]));
  const allTimeTelegram = countTelegramMessages(telegramMessages, allTimeBaseline);
  const allTimeInstagram = countInstagramMessages(instagramMessages, allTimeBaseline);

  return clients.map((c) => {
    const lc = c.lastCampaign;
    const allTime = allTimeTelegram.get(c.id) ?? emptyTelegramBucket();
    const allTimeIg = allTimeInstagram.get(c.id) ?? emptyInstagramBucket();

    if (!lc?.joinedAt || !lc.campaignId) {
      return {
        ...c,
        ...emptyCampaignChatStats(),
        telegramIncomingCount: allTime.incoming,
        telegramOutgoingSystemCount: allTime.outgoingSystem,
        telegramOutgoingManualCount: allTime.outgoingManual,
        instagramIncomingCount: allTimeIg.incoming,
        instagramOutgoingCount: allTimeIg.outgoing,
      };
    }

    const joinedAt = new Date(lc.joinedAt);
    const bucket = statsByClient.get(c.id) ?? { instagram: 0, telegram: 0 };
    const lastIg = bucket.lastIg;
    const lastTg = bucket.lastTg;
    const channels = lc.channels ?? ['instagram', 'telegram'];
    const useCampaignTelegram = channels.includes('telegram');
    const useCampaignInstagram = channels.includes('instagram');
    const campaignTelegram = useCampaignTelegram
      ? countTelegramMessages(
          telegramMessages.filter((m) => m.clientId === c.id),
          new Map([[c.id, joinedAt]])
        ).get(c.id) ?? emptyTelegramBucket()
      : emptyTelegramBucket();
    const campaignInstagram = useCampaignInstagram
      ? countInstagramMessages(
          instagramMessages.filter((m) => m.clientId === c.id),
          new Map([[c.id, joinedAt]])
        ).get(c.id) ?? emptyInstagramBucket()
      : emptyInstagramBucket();

    const campaignNeedsAttentionInstagram = needsAttentionSinceJoin(
      lastIg,
      joinedAt,
      c.chatStatusId ?? undefined,
      c.chatStatusCheckedAt,
      c.chatStatusSetAt
    );
    const campaignNeedsAttentionTelegram = needsAttentionSinceJoin(
      lastTg,
      joinedAt,
      c.telegramChatStatusId ?? undefined,
      c.telegramChatStatusCheckedAt,
      c.telegramChatStatusSetAt
    );

    const telegramCounts = useCampaignTelegram
      ? {
          telegramIncomingCount: campaignTelegram.incoming,
          telegramOutgoingSystemCount: campaignTelegram.outgoingSystem,
          telegramOutgoingManualCount: campaignTelegram.outgoingManual,
        }
      : {
          telegramIncomingCount: allTime.incoming,
          telegramOutgoingSystemCount: allTime.outgoingSystem,
          telegramOutgoingManualCount: allTime.outgoingManual,
        };

    const instagramCounts = useCampaignInstagram
      ? {
          instagramIncomingCount: campaignInstagram.incoming,
          instagramOutgoingCount: campaignInstagram.outgoing,
        }
      : {
          instagramIncomingCount: allTimeIg.incoming,
          instagramOutgoingCount: allTimeIg.outgoing,
        };

    return {
      ...c,
      campaignIncomingInstagram: bucket.instagram,
      campaignIncomingTelegram: bucket.telegram,
      campaignOutgoingInstagram: campaignInstagram.outgoing,
      campaignOutgoingSystemTelegram: campaignTelegram.outgoingSystem,
      campaignOutgoingManualTelegram: campaignTelegram.outgoingManual,
      campaignResponded: bucket.instagram + bucket.telegram > 0,
      campaignLastIncomingInstagram: lastIg ? lastIg.toISOString() : null,
      campaignLastIncomingTelegram: lastTg ? lastTg.toISOString() : null,
      campaignNeedsAttentionInstagram,
      campaignNeedsAttentionTelegram,
      ...telegramCounts,
      ...instagramCounts,
    };
  });
}

export async function attachClientsToCampaignAudience(
  campaignId: string,
  clientIds: string[]
): Promise<number> {
  const uniqueIds = [...new Set(clientIds.filter((id) => typeof id === 'string' && id.trim()))].map((id) =>
    id.trim()
  );
  if (uniqueIds.length === 0) return 0;

  const campaign = await prisma.inactiveBaseCampaign.findUnique({
    where: { id: campaignId },
    select: { bodyTemplate: true, linkLabel: true, linkUrl: true },
  });
  if (!campaign) return 0;

  const clients = await prisma.directClient.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (clients.length === 0) return 0;

  const run = await prisma.inactiveBaseCampaignRun.create({
    data: {
      campaignId,
      channel: INACTIVE_BASE_AUDIENCE_CHANNEL,
      selectedCount: clients.length,
    },
  });

  const { renderPersonalizedCampaignBody } = await import('@/lib/inactive-base/campaign-link-tracking');
  const deliveries = [];
  for (const c of clients) {
    const personalizedBody = await renderPersonalizedCampaignBody({
      template: campaign.bodyTemplate,
      fields: c,
      campaignId,
      clientId: c.id,
      link: { linkLabel: campaign.linkLabel, linkUrl: campaign.linkUrl },
      format: 'plain',
    });
    deliveries.push({
      runId: run.id,
      clientId: c.id,
      status: 'audience',
      personalizedBody,
    });
  }

  await prisma.inactiveBaseCampaignDelivery.createMany({ data: deliveries });

  return clients.length;
}

export async function getLastCampaignByClientIds(
  clientIds: string[]
): Promise<Map<string, LastCampaignInfo | null>> {
  const map = new Map<string, LastCampaignInfo | null>();
  if (clientIds.length === 0) return map;

  const deliveries = await prisma.inactiveBaseCampaignDelivery.findMany({
    where: { clientId: { in: clientIds } },
    include: {
      run: {
        include: {
          campaign: { select: { id: true, name: true, channels: true, createdAt: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const pending = new Map<
    string,
    { campaignId: string; name: string; at: string; channels: DirectChatChannel[]; createdAt: string }
  >();

  for (const d of deliveries) {
    if (map.has(d.clientId)) continue;
    if (d.run.channel === INACTIVE_BASE_UNGROUPED_CHANNEL) {
      map.set(d.clientId, null);
      continue;
    }
    if (isInactiveBaseSystemCampaign(d.run.campaign.name)) {
      map.set(d.clientId, null);
      continue;
    }
    pending.set(d.clientId, {
      campaignId: d.run.campaign.id,
      name: d.run.campaign.name,
      at: d.run.startedAt.toISOString(),
      channels: parseInactiveBaseCampaignChannels(d.run.campaign.channels),
      createdAt: d.run.campaign.createdAt.toISOString(),
    });
  }

  if (pending.size === 0) return map;

  const campaignIds = [...new Set([...pending.values()].map((p) => p.campaignId))];
  const audienceRows = await prisma.inactiveBaseCampaignDelivery.findMany({
    where: {
      status: INACTIVE_BASE_AUDIENCE_CHANNEL,
      run: { campaignId: { in: campaignIds }, channel: INACTIVE_BASE_AUDIENCE_CHANNEL },
      clientId: { in: [...pending.keys()] },
    },
    select: { clientId: true, createdAt: true, run: { select: { campaignId: true } } },
  });

  const joinMap = new Map<string, Date>();
  for (const row of audienceRows) {
    const key = `${row.clientId}:${row.run.campaignId}`;
    const prev = joinMap.get(key);
    if (!prev || row.createdAt > prev) joinMap.set(key, row.createdAt);
  }

  for (const [clientId, p] of pending) {
    const joined =
      joinMap.get(`${clientId}:${p.campaignId}`) ?? new Date(p.at);
    map.set(clientId, {
      campaignId: p.campaignId,
      name: p.name,
      at: p.at,
      channels: p.channels,
      createdAt: p.createdAt,
      joinedAt: joined.toISOString(),
    });
  }

  return map;
}

async function getOrCreateUngroupedCampaign() {
  const existing = await prisma.inactiveBaseCampaign.findFirst({
    where: { name: INACTIVE_BASE_UNGROUPED_CAMPAIGN_INTERNAL_NAME },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.inactiveBaseCampaign.create({
    data: {
      name: INACTIVE_BASE_UNGROUPED_CAMPAIGN_INTERNAL_NAME,
      bodyTemplate: '',
      channels: [],
    },
    select: { id: true },
  });
}

/** Зняти клієнтів з поточної групи (останній запис — ungrouped, у таблиці без кампанії). */
export async function removeClientsFromCampaignGroups(clientIds: string[]): Promise<number> {
  const uniqueIds = [...new Set(clientIds.filter((id) => typeof id === 'string' && id.trim()))].map((id) =>
    id.trim()
  );
  if (uniqueIds.length === 0) return 0;

  const clients = await prisma.directClient.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true },
  });
  if (clients.length === 0) return 0;

  const campaign = await getOrCreateUngroupedCampaign();
  const run = await prisma.inactiveBaseCampaignRun.create({
    data: {
      campaignId: campaign.id,
      channel: INACTIVE_BASE_UNGROUPED_CHANNEL,
      selectedCount: clients.length,
    },
  });

  await prisma.inactiveBaseCampaignDelivery.createMany({
    data: clients.map((c) => ({
      runId: run.id,
      clientId: c.id,
      status: INACTIVE_BASE_UNGROUPED_CHANNEL,
      personalizedBody: null,
    })),
  });

  return clients.length;
}

export async function hasAnyInactiveBaseCampaigns(): Promise<boolean> {
  const rows = await prisma.inactiveBaseCampaign.findMany({ select: { name: true } });
  return rows.some((r) => !isInactiveBaseSystemCampaign(r.name));
}

/** Унікальні клієнти кампанії (усі run, включно з audience). */
export async function getClientIdsForCampaign(campaignId: string): Promise<Set<string>> {
  const groups = await prisma.inactiveBaseCampaignDelivery.groupBy({
    by: ['clientId'],
    where: { run: { campaignId } },
  });
  return new Set(groups.map((g) => g.clientId));
}

export async function getCampaignAudienceCounts(
  campaignIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (campaignIds.length === 0) return map;

  const deliveries = await prisma.inactiveBaseCampaignDelivery.findMany({
    where: { run: { campaignId: { in: campaignIds } } },
    select: { clientId: true, run: { select: { campaignId: true } } },
  });

  const perCampaign = new Map<string, Set<string>>();
  for (const d of deliveries) {
    const cid = d.run.campaignId;
    if (!perCampaign.has(cid)) perCampaign.set(cid, new Set());
    perCampaign.get(cid)!.add(d.clientId);
  }
  for (const [cid, set] of perCampaign) {
    map.set(cid, set.size);
  }
  return map;
}

/** Скільки клієнтів кампанії мають активність у Telegram після join (не сума повідомлень). */
export async function getCampaignTelegramActiveClientCounts(
  campaignIds: string[]
): Promise<Map<string, CampaignTelegramActiveClientCounts>> {
  const result = new Map<string, CampaignTelegramActiveClientCounts>();
  if (campaignIds.length === 0) return result;

  const campaigns = await prisma.inactiveBaseCampaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, channels: true },
  });
  const channelsById = new Map(
    campaigns.map((c) => [c.id, parseInactiveBaseCampaignChannels(c.channels)])
  );

  const baselineEntries: Array<{ campaignId: string; clientId: string; joinedAt: Date }> = [];
  const allClientIds = new Set<string>();

  for (const campaignId of campaignIds) {
    const channels = channelsById.get(campaignId) ?? ['instagram', 'telegram'];
    if (!channels.includes('telegram')) {
      result.set(campaignId, emptyTelegramActiveClientCounts());
      continue;
    }
    const baselines = await getAudienceJoinBaselinesForCampaign(campaignId);
    for (const [clientId, joinedAt] of baselines) {
      allClientIds.add(clientId);
      baselineEntries.push({ campaignId, clientId, joinedAt });
    }
    if (!result.has(campaignId)) {
      result.set(campaignId, emptyTelegramActiveClientCounts());
    }
  }

  if (allClientIds.size === 0 || baselineEntries.length === 0) return result;

  const messages = await prisma.directMessage.findMany({
    where: {
      clientId: { in: [...allClientIds] },
      source: { in: ['telegram', TELEGRAM_CAMPAIGN_SOURCE] },
    },
    select: { clientId: true, direction: true, source: true, receivedAt: true },
  });

  const messagesByClient = new Map<string, TelegramMsgRow[]>();
  for (const m of messages) {
    const list = messagesByClient.get(m.clientId);
    if (list) list.push(m);
    else messagesByClient.set(m.clientId, [m]);
  }

  const entriesByCampaign = new Map<string, typeof baselineEntries>();
  for (const entry of baselineEntries) {
    const list = entriesByCampaign.get(entry.campaignId);
    if (list) list.push(entry);
    else entriesByCampaign.set(entry.campaignId, [entry]);
  }

  for (const [campaignId, entries] of entriesByCampaign) {
    const perClient = new Map<string, TelegramCounterBucket>();
    for (const { clientId, joinedAt } of entries) {
      const bucket =
        countTelegramMessages(messagesByClient.get(clientId) ?? [], new Map([[clientId, joinedAt]])).get(
          clientId
        ) ?? emptyTelegramBucket();
      perClient.set(clientId, bucket);
    }
    result.set(campaignId, aggregateTelegramActiveClientCounts(perClient));
  }

  return result;
}

/** Чи можна відправити кампанію в Telegram (хоча б один клієнт з telegramChatId). */
export async function getCampaignTelegramSendReadiness(
  campaignIds: string[]
): Promise<Map<string, CampaignTelegramSendReadiness>> {
  const map = new Map<string, CampaignTelegramSendReadiness>();
  if (campaignIds.length === 0) return map;

  const campaigns = await prisma.inactiveBaseCampaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, channels: true },
  });

  const telegramCampaignIds = campaigns
    .filter((c) => parseInactiveBaseCampaignChannels(c.channels).includes('telegram'))
    .map((c) => c.id);

  for (const campaignId of campaignIds) {
    if (!telegramCampaignIds.includes(campaignId)) {
      map.set(campaignId, {
        canSend: false,
        audienceCount: 0,
        withTelegramCount: 0,
        withoutTelegramCount: 0,
      });
    }
  }

  if (telegramCampaignIds.length === 0) return map;

  const audienceByCampaign = await Promise.all(
    telegramCampaignIds.map(async (campaignId) => {
      const clientIds = [...(await getClientIdsForCampaign(campaignId))];
      return { campaignId, clientIds };
    })
  );

  const allClientIds = [...new Set(audienceByCampaign.flatMap((a) => a.clientIds))];
  const clients =
    allClientIds.length > 0
      ? await prisma.directClient.findMany({
          where: { id: { in: allClientIds } },
          select: { id: true, telegramChatId: true },
        })
      : [];
  const telegramById = new Map(clients.map((c) => [c.id, c.telegramChatId]));

  for (const { campaignId, clientIds } of audienceByCampaign) {
    let withTelegramCount = 0;
    for (const id of clientIds) {
      if (clientCanReceiveTelegramSystemMessage({ telegramChatId: telegramById.get(id) ?? null })) {
        withTelegramCount++;
      }
    }
    const audienceCount = clientIds.length;
    const withoutTelegramCount = audienceCount - withTelegramCount;
    map.set(campaignId, {
      canSend: audienceCount > 0 && withTelegramCount > 0,
      audienceCount,
      withTelegramCount,
      withoutTelegramCount,
    });
  }

  return map;
}
