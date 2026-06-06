// Співставлення ручних вихідних Telegram (з телефона) з клієнтами кампанії за personalizedBody / ПІБ.

import { prisma } from '@/lib/prisma';
import { getClientFullName } from '@/lib/inactive-base/campaign-template';
import { parseInactiveBaseCampaignChannels } from '@/lib/inactive-base/campaign-audience';
import { buildNameSearchPairs } from '@/lib/inactive-base/telegram-name-match';
import {
  buildExpectedMatchBody,
  parseOutreachTrackingClientId,
  stripAdminPackHeader,
  stripOutreachTrackingCode,
} from '@/lib/inactive-base/manual-telegram-outreach-marker';
import type { TelegramMessage } from '@/lib/telegram/types';

export type ManualOutreachMatchCandidate = {
  clientId: string;
  personalizedBody: string;
  expectedMatchBody: string;
  bodyTemplate: string;
  campaignId: string;
  campaignName: string;
  firstName: string | null;
  lastName: string | null;
};

/** Нормалізація тексту для порівняння (пробіли, переноси). */
export function normalizeTextForManualMatch(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textsMatch(outgoing: string, expected: string): 'exact' | 'contains' | false {
  const a = normalizeTextForManualMatch(outgoing);
  const b = normalizeTextForManualMatch(expected);
  if (!a || !b) return false;
  if (a === b) return 'exact';
  if (a.length >= 20 && b.length >= 20 && (a.includes(b) || b.includes(a))) return 'contains';
  return false;
}

/** Останній personalizedBody на клієнта (кампанії з каналом Telegram, без telegramChatId). */
export async function loadManualOutreachMatchCandidates(): Promise<ManualOutreachMatchCandidate[]> {
  const deliveries = await prisma.inactiveBaseCampaignDelivery.findMany({
    where: {
      personalizedBody: { not: null },
      client: { telegramChatId: null },
    },
    orderBy: { createdAt: 'desc' },
    take: 800,
    select: {
      clientId: true,
      personalizedBody: true,
      run: {
        select: {
          campaignId: true,
          campaign: { select: { name: true, channels: true, bodyTemplate: true } },
        },
      },
      client: { select: { firstName: true, lastName: true } },
    },
  });

  const seen = new Set<string>();
  const result: ManualOutreachMatchCandidate[] = [];

  for (const d of deliveries) {
    if (seen.has(d.clientId)) continue;
    const channels = parseInactiveBaseCampaignChannels(d.run.campaign.channels);
    if (!channels.includes('telegram')) continue;
    const body = (d.personalizedBody || '').trim();
    if (!body) continue;
    seen.add(d.clientId);
    const fields = { firstName: d.client.firstName, lastName: d.client.lastName };
    result.push({
      clientId: d.clientId,
      personalizedBody: body,
      expectedMatchBody: buildExpectedMatchBody(
        body,
        d.run.campaign.bodyTemplate,
        d.clientId,
        fields
      ),
      bodyTemplate: d.run.campaign.bodyTemplate,
      campaignId: d.run.campaignId,
      campaignName: d.run.campaign.name,
      firstName: d.client.firstName,
      lastName: d.client.lastName,
    });
  }

  return result;
}

/** Пошук клієнта за ім'ям чату в межах аудиторії ручної розсилки. */
export async function resolveClientIdFromChatNameInManualOutreach(
  first: string,
  last: string
): Promise<string | null> {
  const candidates = await loadManualOutreachMatchCandidates();
  if (candidates.length === 0) return null;
  const audienceIds = new Set(candidates.map((c) => c.clientId));
  return findUniqueClientIdByNameInAudience(first, last, audienceIds);
}

async function findUniqueClientIdByNameInAudience(
  first: string,
  last: string,
  audienceIds: Set<string>
): Promise<string | null> {
  const pairs = buildNameSearchPairs(first, last);
  for (const [fn, ln] of pairs) {
    const rows = await prisma.directClient.findMany({
      where: {
        id: { in: [...audienceIds] },
        AND: [
          { firstName: { contains: fn, mode: 'insensitive' } },
          { lastName: { contains: ln, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 3,
    });
    if (rows.length === 1) return rows[0].id;
  }
  return null;
}

/**
 * Знайти clientId за текстом вихідного повідомлення (personalizedBody або ПІБ у тексті).
 * Повертає null при неоднозначному збігу.
 */
export async function resolveClientIdFromOutgoingManualText(
  text: string,
  message?: TelegramMessage
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const trackingClientId = parseOutreachTrackingClientId(trimmed);
  if (trackingClientId) {
    const row = await prisma.directClient.findUnique({
      where: { id: trackingClientId },
      select: { id: true, telegramChatId: true },
    });
    if (row && row.telegramChatId == null) {
      console.log(`[match-outgoing-manual] маркер dc: clientId=${trackingClientId}`);
      return trackingClientId;
    }
  }

  const candidates = await loadManualOutreachMatchCandidates();
  if (candidates.length === 0) return null;

  const audienceIds = new Set(candidates.map((c) => c.clientId));

  const bodyMatches = candidates
    .map((c) => {
      const pib = getClientFullName({ firstName: c.firstName, lastName: c.lastName });
      const stripped = stripAdminPackHeader(trimmed, pib);
      const kind = textsMatch(stripped, c.expectedMatchBody);
      return { c, kind };
    })
    .filter((x): x is { c: ManualOutreachMatchCandidate; kind: 'exact' | 'contains' } => Boolean(x.kind));

  const exact = bodyMatches.filter((x) => x.kind === 'exact').map((x) => x.c);
  if (exact.length === 1) {
    console.log(
      `[match-outgoing-manual] exact personalizedBody clientId=${exact[0].clientId} campaign=${exact[0].campaignName}`
    );
    return exact[0].clientId;
  }
  if (exact.length > 1) {
    console.log(`[match-outgoing-manual] ambiguous exact match count=${exact.length}`);
    return null;
  }

  const contains = bodyMatches.filter((x) => x.kind === 'contains').map((x) => x.c);
  if (contains.length === 1) {
    console.log(
      `[match-outgoing-manual] contains personalizedBody clientId=${contains[0].clientId} campaign=${contains[0].campaignName}`
    );
    return contains[0].clientId;
  }
  if (contains.length > 1) {
    console.log(`[match-outgoing-manual] ambiguous contains match count=${contains.length}`);
    return null;
  }

  const nameHits = candidates.filter((c) => {
    const name = getClientFullName({ firstName: c.firstName, lastName: c.lastName });
    return name.length >= 4 && name !== 'клієнте' && trimmed.includes(name);
  });
  if (nameHits.length === 1) {
    console.log(
      `[match-outgoing-manual] ПІБ у тексті clientId=${nameHits[0].clientId} campaign=${nameHits[0].campaignName}`
    );
    return nameHits[0].clientId;
  }
  if (nameHits.length > 1) {
    console.log(`[match-outgoing-manual] ambiguous ПІБ у тексті count=${nameHits.length}`);
    return null;
  }

  if (message?.chat) {
    const chatFn = (message.chat.first_name || '').trim();
    const chatLn = (message.chat.last_name || '').trim();
    if (chatFn && chatLn) {
      const byChatName = await findUniqueClientIdByNameInAudience(chatFn, chatLn, audienceIds);
      if (byChatName) {
        console.log(`[match-outgoing-manual] ім'я чату clientId=${byChatName}`);
        return byChatName;
      }
    }
  }

  return null;
}
