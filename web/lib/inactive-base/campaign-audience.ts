// Аудиторія кампанії (виділені клієнти) та остання кампанія по клієнту.

import { prisma } from '@/lib/prisma';
import { renderCampaignBody } from '@/lib/inactive-base/campaign-template';

export const INACTIVE_BASE_AUDIENCE_CHANNEL = 'audience';

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
): Promise<Map<string, LastCampaignInfo>> {
  const map = new Map<string, LastCampaignInfo>();
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
    map.set(d.clientId, {
      campaignId: d.run.campaign.id,
      name: d.run.campaign.name,
      at: d.run.startedAt.toISOString(),
    });
  }
  return map;
}

export async function hasAnyInactiveBaseCampaigns(): Promise<boolean> {
  return (await prisma.inactiveBaseCampaign.count()) > 0;
}
