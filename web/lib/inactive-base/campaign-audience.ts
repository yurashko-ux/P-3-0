// Аудиторія кампанії (виділені клієнти) та остання кампанія по клієнту.

import { prisma } from '@/lib/prisma';
import {
  DIRECT_MESSAGE_SOURCES_BY_CHANNEL,
  isSourceForChannel,
  type DirectChatChannel,
} from '@/lib/direct-channel-chat';
import { renderCampaignBody } from '@/lib/inactive-base/campaign-template';

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
  campaignResponded: boolean;
  campaignLastIncomingInstagram: string | null;
  campaignLastIncomingTelegram: string | null;
  campaignNeedsAttentionInstagram: boolean;
  campaignNeedsAttentionTelegram: boolean;
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
    if (channels.includes('telegram')) sources.add('telegram');

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
  if (targets.length === 0) {
    return clients.map((c) => ({
      ...c,
      campaignIncomingInstagram: 0,
      campaignIncomingTelegram: 0,
      campaignResponded: false,
      campaignLastIncomingInstagram: null,
      campaignLastIncomingTelegram: null,
      campaignNeedsAttentionInstagram: false,
      campaignNeedsAttentionTelegram: false,
    }));
  }

  const clientIds = targets.map((c) => c.id);
  const allSources = new Set<string>([
    ...DIRECT_MESSAGE_SOURCES_BY_CHANNEL.instagram,
    'telegram',
  ]);

  const messages = await prisma.directMessage.findMany({
    where: {
      clientId: { in: clientIds },
      direction: 'incoming',
      source: { in: [...allSources] },
    },
    select: { clientId: true, source: true, receivedAt: true },
  });

  type Bucket = { instagram: number; telegram: number; lastIg?: Date; lastTg?: Date };
  const statsByClient = new Map<string, Bucket>();

  for (const c of targets) {
    const joinedAt = new Date(c.lastCampaign!.joinedAt!);
    const baselines = new Map([[c.id, joinedAt]]);
    const channels = c.lastCampaign!.channels ?? ['instagram', 'telegram'];
    const { perClient } = countIncomingSinceBaseline(messages, baselines, channels);
    statsByClient.set(c.id, perClient.get(c.id) ?? { instagram: 0, telegram: 0 });
  }

  return clients.map((c) => {
    const lc = c.lastCampaign;
    if (!lc?.joinedAt || !lc.campaignId) {
      return {
        ...c,
        campaignIncomingInstagram: 0,
        campaignIncomingTelegram: 0,
        campaignResponded: false,
        campaignLastIncomingInstagram: null,
        campaignLastIncomingTelegram: null,
        campaignNeedsAttentionInstagram: false,
        campaignNeedsAttentionTelegram: false,
      };
    }

    const joinedAt = new Date(lc.joinedAt);
    const bucket = statsByClient.get(c.id) ?? { instagram: 0, telegram: 0 };
    const lastIg = bucket.lastIg;
    const lastTg = bucket.lastTg;

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

    return {
      ...c,
      campaignIncomingInstagram: bucket.instagram,
      campaignIncomingTelegram: bucket.telegram,
      campaignResponded: bucket.instagram + bucket.telegram > 0,
      campaignLastIncomingInstagram: lastIg ? lastIg.toISOString() : null,
      campaignLastIncomingTelegram: lastTg ? lastTg.toISOString() : null,
      campaignNeedsAttentionInstagram,
      campaignNeedsAttentionTelegram,
    };
  });
}

export async function attachClientsToCampaignAudience(
  campaignId: string,
  clientIds: string[],
  bodyTemplate: string
): Promise<number> {
  const uniqueIds = [...new Set(clientIds.filter((id) => typeof id === 'string' && id.trim()))].map((id) =>
    id.trim()
  );
  if (uniqueIds.length === 0) return 0;

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

  await prisma.inactiveBaseCampaignDelivery.createMany({
    data: clients.map((c) => ({
      runId: run.id,
      clientId: c.id,
      status: 'audience',
      personalizedBody: renderCampaignBody(bodyTemplate, c),
    })),
  });

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
          campaign: { select: { id: true, name: true, channels: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const pending = new Map<string, { campaignId: string; name: string; at: string; channels: DirectChatChannel[] }>();

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
