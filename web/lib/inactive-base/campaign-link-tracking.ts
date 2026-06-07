// Трекінг-кліки по посиланнях кампаній неактивної бази.

import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  campaignTemplateHasLinkPlaceholder,
  ensureLinkPlaceholderInTemplate,
  getClientFirstName,
  getClientFullName,
  getClientLastName,
  type CampaignNameFields,
} from '@/lib/inactive-base/campaign-template';
import { escapeHtml } from '@/lib/inactive-base/manual-telegram-outreach-marker';
import {
  getClientIdsForCampaign,
  INACTIVE_BASE_AUDIENCE_CHANNEL,
} from '@/lib/inactive-base/campaign-audience';

const LINK_PLACEHOLDER_RE = /\{\{\s*посилання\s*\}\}/gi;

export type CampaignLinkConfig = {
  linkLabel?: string | null;
  linkUrl?: string | null;
};

export function campaignHasLinkConfig(link?: CampaignLinkConfig): boolean {
  return (
    Boolean((link?.linkLabel || '').trim()) &&
    Boolean(normalizeDestinationUrl(link?.linkUrl || ''))
  );
}

export function normalizeDestinationUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function generateToken(): string {
  return randomBytes(9).toString('base64url');
}

export function getTrackingBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://p-3-0.vercel.app').replace(/\/$/, '');
}

export function buildTrackingUrl(token: string): string {
  return `${getTrackingBaseUrl()}/api/inactive-base/go/${encodeURIComponent(token)}`;
}

/** Унікальний токен на пару кампанія + клієнт. */
export async function ensureCampaignLinkToken(
  campaignId: string,
  clientId: string,
  destinationUrl: string
): Promise<string> {
  const dest = normalizeDestinationUrl(destinationUrl);
  if (!dest) throw new Error('Некоректний linkUrl');

  const existing = await prisma.inactiveBaseCampaignLinkToken.findUnique({
    where: { campaignId_clientId: { campaignId, clientId } },
    select: { token: true, destinationUrl: true },
  });
  if (existing) {
    if (existing.destinationUrl !== dest) {
      await prisma.inactiveBaseCampaignLinkToken.update({
        where: { campaignId_clientId: { campaignId, clientId } },
        data: { destinationUrl: dest },
      });
    }
    return existing.token;
  }

  let token = generateToken();
  for (let i = 0; i < 5; i++) {
    try {
      await prisma.inactiveBaseCampaignLinkToken.create({
        data: { token, campaignId, clientId, destinationUrl: dest },
      });
      return token;
    } catch {
      token = generateToken();
    }
  }
  throw new Error('Не вдалося створити токен посилання');
}

export async function recordCampaignLinkClick(token: string): Promise<{
  ok: boolean;
  destinationUrl?: string;
  error?: string;
}> {
  const row = await prisma.inactiveBaseCampaignLinkToken.findUnique({
    where: { token },
    select: { id: true, destinationUrl: true, clickCount: true },
  });
  if (!row) {
    return { ok: false, error: 'Токен не знайдено' };
  }

  const now = new Date();
  await prisma.inactiveBaseCampaignLinkToken.update({
    where: { id: row.id },
    data: {
      clickCount: row.clickCount + 1,
      firstClickedAt: row.clickCount === 0 ? now : undefined,
      lastClickedAt: now,
    },
  });

  try {
    await prisma.inactiveBaseCampaignLinkClick.create({
      data: { tokenId: row.id, clickedAt: now },
    });
  } catch (clickRowError) {
    console.warn(
      '[campaign-link-tracking] Не вдалося записати детальний клік (можливо немає міграції link_clicks):',
      clickRowError instanceof Error ? clickRowError.message : clickRowError
    );
  }

  console.log(
    `[campaign-link-tracking] click token=${token} count=${row.clickCount + 1} dest=${row.destinationUrl}`
  );

  return { ok: true, destinationUrl: row.destinationUrl };
}

function renderNamePlaceholders(template: string, fields: CampaignNameFields): string {
  const pib = getClientFullName(fields);
  const first = getClientFirstName(fields);
  const last = getClientLastName(fields);
  return template
    .replace(/\{\{\s*ПІБ\s*\}\}/gi, pib)
    .replace(/\{\{\s*імя\s*\}\}/gi, first)
    .replace(/\{\{\s*прізвище\s*\}\}/gi, last)
    .replace(/\{\{\s*name\s*\}\}/gi, pib)
    .replace(/\{\{\s*firstName\s*\}\}/gi, first)
    .replace(/\{\{\s*lastName\s*\}\}/gi, last);
}

/** Персональний текст кампанії з трекінг-посиланням у {{посилання}}. */
export async function renderPersonalizedCampaignBody(options: {
  template: string;
  fields: CampaignNameFields;
  campaignId: string;
  clientId: string;
  link?: CampaignLinkConfig;
  format: 'plain' | 'telegram_html';
}): Promise<string> {
  const label = (options.link?.linkLabel || '').trim();
  const dest = normalizeDestinationUrl(options.link?.linkUrl || '');
  const hasLinkConfig = Boolean(label && dest);
  const template = ensureLinkPlaceholderInTemplate(options.template, hasLinkConfig);

  let body = renderNamePlaceholders(template, options.fields);
  if (!campaignTemplateHasLinkPlaceholder(template)) return body;

  if (!hasLinkConfig) {
    return body.replace(LINK_PLACEHOLDER_RE, '');
  }

  const token = await ensureCampaignLinkToken(options.campaignId, options.clientId, dest);
  const trackUrl = buildTrackingUrl(token);
  const replacement =
    options.format === 'telegram_html'
      ? `<a href="${escapeHtml(trackUrl)}">${escapeHtml(label)}</a>`
      : `${label}: ${trackUrl}`;

  return body.replace(LINK_PLACEHOLDER_RE, replacement);
}

export type LinkClickMeta = {
  /** Є хоча б один перехід (поточна або попередня кампанія). */
  campaignLinkClicked: boolean;
  /** Перехід саме в актуальній кампанії клієнта (зелена галочка). */
  campaignLinkClickedInCurrentCampaign: boolean;
  campaignLinkClickedAt: string | null;
  campaignLinkClickCount: number;
  campaignHasTrackableLink: boolean;
};

export async function enrichClientsWithLinkClickMeta<
  T extends { id: string; lastCampaign?: { campaignId?: string } | null },
>(clients: T[], campaignsWithLink: Map<string, boolean>): Promise<(T & LinkClickMeta)[]> {
  const emptyMeta = (c: T): T & LinkClickMeta => ({
    ...c,
    campaignLinkClicked: false,
    campaignLinkClickedInCurrentCampaign: false,
    campaignLinkClickedAt: null,
    campaignLinkClickCount: 0,
    campaignHasTrackableLink: false,
  });

  if (clients.length === 0) return [];

  const clientIds = clients.map((c) => c.id);
  const clickedTokens = await prisma.inactiveBaseCampaignLinkToken.findMany({
    where: { clientId: { in: clientIds }, clickCount: { gt: 0 } },
    select: {
      campaignId: true,
      clientId: true,
      firstClickedAt: true,
      lastClickedAt: true,
      clickCount: true,
    },
  });

  const clicksByClientId = new Map<string, typeof clickedTokens>();
  for (const token of clickedTokens) {
    const bucket = clicksByClientId.get(token.clientId) ?? [];
    bucket.push(token);
    clicksByClientId.set(token.clientId, bucket);
  }

  return clients.map((c) => {
    const campaignId = c.lastCampaign?.campaignId;
    const hasLink = campaignId ? (campaignsWithLink.get(campaignId) ?? false) : false;
    const clientClicks = clicksByClientId.get(c.id) ?? [];

    const currentClick = campaignId
      ? clientClicks.find((t) => t.campaignId === campaignId)
      : undefined;
    const clickedInCurrent = (currentClick?.clickCount ?? 0) > 0;

    const otherClicks = clientClicks.filter((t) => t.campaignId !== campaignId);
    const clickedHistorical = !clickedInCurrent && otherClicks.length > 0;

    if (!clickedInCurrent && !clickedHistorical) {
      return {
        ...emptyMeta(c),
        campaignHasTrackableLink: hasLink,
      };
    }

    let displayClick = currentClick;
    if (!clickedInCurrent && otherClicks.length > 0) {
      displayClick = [...otherClicks].sort((a, b) => {
        const aAt = (a.lastClickedAt ?? a.firstClickedAt)?.getTime() ?? 0;
        const bAt = (b.lastClickedAt ?? b.firstClickedAt)?.getTime() ?? 0;
        return bAt - aAt;
      })[0];
    }

    const clickedAt = displayClick?.lastClickedAt ?? displayClick?.firstClickedAt ?? null;

    return {
      ...c,
      campaignLinkClicked: true,
      campaignLinkClickedInCurrentCampaign: clickedInCurrent,
      campaignLinkClickedAt: clickedAt ? clickedAt.toISOString() : null,
      campaignLinkClickCount: displayClick?.clickCount ?? 0,
      campaignHasTrackableLink: hasLink,
    };
  });
}

/** Створити трекінг-токени для клієнтів кампанії, у яких їх ще немає (незалежно від telegramChatId). */
export async function ensureLinkTokensForClientCampaignPairs(
  pairs: { clientId: string; campaignId: string }[]
): Promise<number> {
  if (pairs.length === 0) return 0;

  const campaignIds = [...new Set(pairs.map((p) => p.campaignId))];
  const campaigns = await prisma.inactiveBaseCampaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, bodyTemplate: true, linkLabel: true, linkUrl: true },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  const trackablePairs = pairs.filter((p) => {
    const camp = campaignMap.get(p.campaignId);
    return camp && campaignHasLinkConfig(camp);
  });
  if (trackablePairs.length === 0) return 0;

  const existing = await prisma.inactiveBaseCampaignLinkToken.findMany({
    where: { OR: trackablePairs.map((p) => ({ campaignId: p.campaignId, clientId: p.clientId })) },
    select: { campaignId: true, clientId: true },
  });
  const existingKeys = new Set(existing.map((t) => `${t.campaignId}:${t.clientId}`));

  const missingPairs = trackablePairs.filter(
    (p) => !existingKeys.has(`${p.campaignId}:${p.clientId}`)
  );
  if (missingPairs.length === 0) return 0;

  const clientIds = [...new Set(missingPairs.map((p) => p.clientId))];
  const clients = await prisma.directClient.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const clientMap = new Map(clients.map((c) => [c.id, c]));

  let ensured = 0;
  for (const pair of missingPairs) {
    const camp = campaignMap.get(pair.campaignId);
    const client = clientMap.get(pair.clientId);
    if (!camp || !client) continue;
    await renderPersonalizedCampaignBody({
      template: camp.bodyTemplate,
      fields: client,
      campaignId: pair.campaignId,
      clientId: pair.clientId,
      link: { linkLabel: camp.linkLabel, linkUrl: camp.linkUrl },
      format: 'plain',
    });
    ensured += 1;
  }

  if (ensured > 0) {
    console.log(
      `[campaign-link-tracking] Створено ${ensured} токенів посилання (усі клієнти кампанії, без привʼязки до telegramChatId)`
    );
  }
  return ensured;
}

/**
 * Оновити персональні посилання для всієї аудиторії кампанії
 * (після зміни шаблону / URL / тексту посилання).
 */
export async function syncCampaignAudienceLinkTracking(campaignId: string): Promise<{
  processed: number;
  updatedBodies: number;
}> {
  const campaign = await prisma.inactiveBaseCampaign.findUnique({
    where: { id: campaignId },
    select: { bodyTemplate: true, linkLabel: true, linkUrl: true },
  });
  if (!campaign || !campaignHasLinkConfig(campaign)) {
    return { processed: 0, updatedBodies: 0 };
  }

  const audienceIds = [...(await getClientIdsForCampaign(campaignId))];
  if (audienceIds.length === 0) return { processed: 0, updatedBodies: 0 };

  const clients = await prisma.directClient.findMany({
    where: { id: { in: audienceIds } },
    select: { id: true, firstName: true, lastName: true },
  });

  let updatedBodies = 0;
  for (const client of clients) {
    const personalizedBody = await renderPersonalizedCampaignBody({
      template: campaign.bodyTemplate,
      fields: client,
      campaignId,
      clientId: client.id,
      link: { linkLabel: campaign.linkLabel, linkUrl: campaign.linkUrl },
      format: 'plain',
    });

    const latestDelivery = await prisma.inactiveBaseCampaignDelivery.findFirst({
      where: {
        clientId: client.id,
        status: INACTIVE_BASE_AUDIENCE_CHANNEL,
        run: { campaignId, channel: INACTIVE_BASE_AUDIENCE_CHANNEL },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, personalizedBody: true },
    });
    if (latestDelivery && latestDelivery.personalizedBody !== personalizedBody) {
      await prisma.inactiveBaseCampaignDelivery.update({
        where: { id: latestDelivery.id },
        data: { personalizedBody },
      });
      updatedBodies += 1;
    }
  }

  console.log(
    `[campaign-link-tracking] Синхронізовано посилання кампанії ${campaignId}: клієнтів=${clients.length}, оновлено текстів=${updatedBodies}`
  );

  return { processed: clients.length, updatedBodies };
}

export async function getCampaignsWithTrackableLink(
  campaignIds: string[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (campaignIds.length === 0) return map;

  const rows = await prisma.inactiveBaseCampaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, linkLabel: true, linkUrl: true, bodyTemplate: true },
  });

  for (const r of rows) {
    const hasLinkConfig =
      Boolean((r.linkLabel || '').trim()) && Boolean(normalizeDestinationUrl(r.linkUrl || ''));
    const has =
      hasLinkConfig &&
      (campaignTemplateHasLinkPlaceholder(r.bodyTemplate) || hasLinkConfig);
    map.set(r.id, has);
  }
  return map;
}
