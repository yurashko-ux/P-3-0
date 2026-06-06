// Історія переходів по посиланнях кампаній неактивної бази для клієнта.

import { prisma } from '@/lib/prisma';
import { INACTIVE_BASE_AUDIENCE_CHANNEL } from '@/lib/inactive-base/campaign-audience';
import {
  normalizeDestinationUrl,
  renderPersonalizedCampaignBody,
} from '@/lib/inactive-base/campaign-link-tracking';

export type LinkClickHistoryItem = {
  id: string;
  clickedAt: string;
  campaignId: string;
  campaignName: string;
  linkLabel: string | null;
  linkUrl: string | null;
  messageBody: string;
  /** Агрегований клік до появи детальної історії */
  legacyAggregated?: boolean;
  legacyClickCount?: number;
};

/** Прибрати трекінг-URL, залишити читабельний текст посилання. */
export function formatMessageBodyForLinkHistory(body: string, linkLabel: string | null): string {
  const label = (linkLabel || '').trim();
  let text = body.trim();
  if (!text) return text;
  if (label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`${escaped}:\\s*https?://\\S+`, 'gi'), label);
    text = text.replace(
      new RegExp(`<a\\s+href="[^"]*/api/inactive-base/go/[^"]*"[^>]*>${escaped}</a>`, 'gi'),
      label
    );
  }
  text = text.replace(/https?:\/\/\S*\/api\/inactive-base\/go\/\S+/gi, label || 'посилання');
  return text;
}

async function getPersonalizedBodiesByCampaign(
  clientId: string,
  campaignIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (campaignIds.length === 0) return map;

  const deliveries = await prisma.inactiveBaseCampaignDelivery.findMany({
    where: {
      clientId,
      status: INACTIVE_BASE_AUDIENCE_CHANNEL,
      personalizedBody: { not: null },
      run: {
        campaignId: { in: campaignIds },
        channel: INACTIVE_BASE_AUDIENCE_CHANNEL,
      },
    },
    select: {
      personalizedBody: true,
      createdAt: true,
      run: { select: { campaignId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const d of deliveries) {
    const campaignId = d.run.campaignId;
    if (!map.has(campaignId) && d.personalizedBody) {
      map.set(campaignId, d.personalizedBody);
    }
  }
  return map;
}

function campaignHasTrackableLink(campaign: {
  linkLabel: string | null;
  linkUrl: string | null;
}): boolean {
  return (
    Boolean((campaign.linkLabel || '').trim()) &&
    Boolean(normalizeDestinationUrl(campaign.linkUrl || ''))
  );
}

async function resolveMessageBody(options: {
  clientId: string;
  campaignId: string;
  campaign: {
    bodyTemplate: string;
    linkLabel: string | null;
    linkUrl: string | null;
  };
  clientFields: { firstName: string | null; lastName: string | null };
  storedBody?: string;
}): Promise<string> {
  // Для кампаній з посиланням завжди збираємо текст з актуального шаблону —
  // у БД часто лежить старий personalizedBody без {{посилання}}.
  const useStored =
    !campaignHasTrackableLink(options.campaign) && Boolean(options.storedBody?.trim());

  if (useStored) {
    return formatMessageBodyForLinkHistory(options.storedBody!, options.campaign.linkLabel);
  }

  const rendered = await renderPersonalizedCampaignBody({
    template: options.campaign.bodyTemplate,
    fields: options.clientFields,
    campaignId: options.campaignId,
    clientId: options.clientId,
    link: { linkLabel: options.campaign.linkLabel, linkUrl: options.campaign.linkUrl },
    format: 'plain',
  });
  return formatMessageBodyForLinkHistory(rendered, options.campaign.linkLabel);
}

export type LinkClickHistoryResult = {
  items: LinkClickHistoryItem[];
  clientFound: boolean;
  tokensTotal: number;
  tokensWithClicks: number;
};

async function loadClicksByTokenId(
  tokenIds: string[]
): Promise<Map<string, Array<{ id: string; clickedAt: Date }>>> {
  const map = new Map<string, Array<{ id: string; clickedAt: Date }>>();
  if (tokenIds.length === 0) return map;

  try {
    const rows = await prisma.inactiveBaseCampaignLinkClick.findMany({
      where: { tokenId: { in: tokenIds } },
      orderBy: { clickedAt: 'desc' },
      select: { id: true, tokenId: true, clickedAt: true },
    });
    for (const row of rows) {
      const bucket = map.get(row.tokenId) ?? [];
      bucket.push({ id: row.id, clickedAt: row.clickedAt });
      map.set(row.tokenId, bucket);
    }
  } catch (error) {
    console.warn(
      '[link-click-history] Таблиця кліків недоступна, використовуємо агрегати токенів:',
      error instanceof Error ? error.message : error
    );
  }
  return map;
}

function tokenAggregateClickedAt(token: {
  lastClickedAt: Date | null;
  firstClickedAt: Date | null;
  createdAt: Date;
}): Date | null {
  return token.lastClickedAt ?? token.firstClickedAt ?? null;
}

/** Усі переходи клієнта по посиланнях (усі кампанії), від нових до старих. */
export async function getClientLinkClickHistory(clientId: string): Promise<LinkClickHistoryResult> {
  const client = await prisma.directClient.findUnique({
    where: { id: clientId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!client) {
    return { items: [], clientFound: false, tokensTotal: 0, tokensWithClicks: 0 };
  }

  const tokens = await prisma.inactiveBaseCampaignLinkToken.findMany({
    where: { clientId },
    select: {
      id: true,
      clickCount: true,
      firstClickedAt: true,
      lastClickedAt: true,
      createdAt: true,
      campaign: {
        select: {
          id: true,
          name: true,
          bodyTemplate: true,
          linkLabel: true,
          linkUrl: true,
        },
      },
    },
    orderBy: { lastClickedAt: 'desc' },
  });

  const clicksByTokenId = await loadClicksByTokenId(tokens.map((t) => t.id));
  const campaignIds = tokens.map((t) => t.campaign.id);
  const bodiesByCampaign = await getPersonalizedBodiesByCampaign(clientId, campaignIds);

  const items: LinkClickHistoryItem[] = [];

  for (const token of tokens) {
    const campaign = token.campaign;
    const storedBody = bodiesByCampaign.get(campaign.id);
    const messageBody = await resolveMessageBody({
      clientId,
      campaignId: campaign.id,
      campaign,
      clientFields: client,
      storedBody,
    });

    const base = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      linkLabel: campaign.linkLabel,
      linkUrl: campaign.linkUrl,
      messageBody,
    };

    const clickRows = clicksByTokenId.get(token.id) ?? [];
    if (clickRows.length > 0) {
      for (const click of clickRows) {
        const isLegacy = click.id.startsWith('legacy_');
        items.push({
          id: click.id,
          clickedAt: click.clickedAt.toISOString(),
          ...base,
          ...(isLegacy && token.clickCount > 1
            ? { legacyAggregated: true, legacyClickCount: token.clickCount }
            : {}),
        });
      }
      continue;
    }

    const aggregateAt = tokenAggregateClickedAt(token);
    if (token.clickCount > 0 && aggregateAt) {
      items.push({
        id: `legacy-token-${token.id}`,
        clickedAt: aggregateAt.toISOString(),
        ...base,
        legacyAggregated: token.clickCount > 1,
        legacyClickCount: token.clickCount > 1 ? token.clickCount : undefined,
      });
    }
  }

  items.sort((a, b) => new Date(b.clickedAt).getTime() - new Date(a.clickedAt).getTime());

  return {
    items,
    clientFound: true,
    tokensTotal: tokens.length,
    tokensWithClicks: tokens.filter((t) => t.clickCount > 0).length,
  };
}
