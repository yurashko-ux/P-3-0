// Аудиторія кампанії (виділені клієнти) та остання кампанія по клієнту.

import { prisma } from '@/lib/prisma';
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
};

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
          campaign: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

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
    map.set(d.clientId, {
      campaignId: d.run.campaign.id,
      name: d.run.campaign.name,
      at: d.run.startedAt.toISOString(),
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
