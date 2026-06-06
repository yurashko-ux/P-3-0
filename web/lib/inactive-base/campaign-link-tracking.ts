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

const LINK_PLACEHOLDER_RE = /\{\{\s*посилання\s*\}\}/gi;

export type CampaignLinkConfig = {
  linkLabel?: string | null;
  linkUrl?: string | null;
};

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
  campaignLinkClicked: boolean;
  campaignLinkClickedAt: string | null;
  campaignLinkClickCount: number;
  campaignHasTrackableLink: boolean;
};

export async function enrichClientsWithLinkClickMeta<
  T extends { id: string; lastCampaign?: { campaignId?: string } | null },
>(clients: T[], campaignsWithLink: Map<string, boolean>): Promise<(T & LinkClickMeta)[]> {
  const pairs = clients
    .map((c) => ({
      clientId: c.id,
      campaignId: c.lastCampaign?.campaignId,
    }))
    .filter((p): p is { clientId: string; campaignId: string } => Boolean(p.campaignId));

  if (pairs.length === 0) {
    return clients.map((c) => ({
      ...c,
      campaignLinkClicked: false,
      campaignLinkClickedAt: null,
      campaignLinkClickCount: 0,
      campaignHasTrackableLink: false,
    }));
  }

  const tokens = await prisma.inactiveBaseCampaignLinkToken.findMany({
    where: {
      OR: pairs.map((p) => ({ campaignId: p.campaignId, clientId: p.clientId })),
    },
    select: {
      campaignId: true,
      clientId: true,
      firstClickedAt: true,
      lastClickedAt: true,
      clickCount: true,
    },
  });

  const byKey = new Map(tokens.map((t) => [`${t.campaignId}:${t.clientId}`, t]));

  return clients.map((c) => {
    const campaignId = c.lastCampaign?.campaignId;
    const hasLink = campaignId ? (campaignsWithLink.get(campaignId) ?? false) : false;
    if (!campaignId || !hasLink) {
      return {
        ...c,
        campaignLinkClicked: false,
        campaignLinkClickedAt: null,
        campaignLinkClickCount: 0,
        campaignHasTrackableLink: false,
      };
    }
    const row = byKey.get(`${campaignId}:${c.id}`);
    const clickedAt = row?.lastClickedAt ?? row?.firstClickedAt ?? null;
    return {
      ...c,
      campaignLinkClicked: (row?.clickCount ?? 0) > 0,
      campaignLinkClickedAt: clickedAt ? clickedAt.toISOString() : null,
      campaignLinkClickCount: row?.clickCount ?? 0,
      campaignHasTrackableLink: true,
    };
  });
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
