// Побудова рядків таблиці з групами кампаній (акордеон).

import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";
import type { CampaignAudienceCounts } from "./InactiveBaseCampaignAudienceBadges";

export type DisplayRow =
  | { kind: "solo"; client: InactiveBaseClientRow }
  | {
      kind: "campaignLeader";
      client: InactiveBaseClientRow;
      campaignId: string;
      campaignName: string;
      memberCount: number;
    }
  | { kind: "campaignMember"; client: InactiveBaseClientRow; campaignId: string };

function campaignIdOf(client: InactiveBaseClientRow): string | null {
  return client.lastCampaign?.campaignId?.trim() || null;
}

/** Усі клієнти згруповані по останній кампанії; згорнуто — лише лідер-ряд. */
export function buildDisplayRows(
  clients: InactiveBaseClientRow[],
  expandedCampaignIds: Set<string>,
  enableGrouping: boolean
): DisplayRow[] {
  if (!enableGrouping) {
    return clients.map((client) => ({ kind: "solo" as const, client }));
  }

  const memberCounts = new Map<string, number>();
  const membersByCampaign = new Map<string, InactiveBaseClientRow[]>();

  for (const client of clients) {
    const cid = campaignIdOf(client);
    if (!cid || !client.lastCampaign) continue;
    memberCounts.set(cid, (memberCounts.get(cid) ?? 0) + 1);
    const list = membersByCampaign.get(cid);
    if (list) list.push(client);
    else membersByCampaign.set(cid, [client]);
  }

  // Порядок груп — за найменшим індексом учасника у вихідному списку (стабільно між групами).
  const campaignOrder = new Map<string, number>();
  for (let i = 0; i < clients.length; i++) {
    const cid = campaignIdOf(clients[i]!);
    if (!cid || !clients[i]!.lastCampaign) continue;
    const prev = campaignOrder.get(cid);
    if (prev === undefined || i < prev) campaignOrder.set(cid, i);
  }

  const rows: DisplayRow[] = [];

  const sortedCampaignIds = Array.from(membersByCampaign.keys()).sort(
    (a, b) => (campaignOrder.get(a) ?? 0) - (campaignOrder.get(b) ?? 0)
  );

  for (const cid of sortedCampaignIds) {
    const members = membersByCampaign.get(cid) ?? [];
    const leader = members[0]!;
    rows.push({
      kind: "campaignLeader",
      client: leader,
      campaignId: cid,
      campaignName: leader.lastCampaign!.name,
      memberCount: memberCounts.get(cid) ?? members.length,
    });

    if (expandedCampaignIds.has(cid)) {
      for (let i = 1; i < members.length; i++) {
        rows.push({
          kind: "campaignMember",
          client: members[i]!,
          campaignId: cid,
        });
      }
    }
  }

  for (const client of clients) {
    const cid = campaignIdOf(client);
    if (cid && client.lastCampaign) continue;
    rows.push({ kind: "solo", client });
  }

  return rows;
}

export type NumberedDisplayRow = DisplayRow & {
  /** Порядковий номер групи кампанії (1, 2, 3…). */
  groupNumber?: number;
  /** Номер клієнта всередині групи (1, 2, 3…), лише коли група розгорнута. */
  clientNumberInGroup?: number;
  /** Номер клієнта поза групами. */
  soloNumber?: number;
};

/** Окрема нумерація груп, клієнтів у групі та solo-рядків. */
export function assignDisplayRowNumbers(rows: DisplayRow[]): NumberedDisplayRow[] {
  let groupNumber = 0;
  let soloNumber = 0;
  let clientNumberInGroup = 0;

  return rows.map((row) => {
    if (row.kind === "solo") {
      soloNumber += 1;
      clientNumberInGroup = 0;
      return { ...row, soloNumber, groupNumber: undefined, clientNumberInGroup: undefined };
    }
    if (row.kind === "campaignLeader") {
      groupNumber += 1;
      clientNumberInGroup = 1;
      return { ...row, groupNumber, clientNumberInGroup: 1 };
    }
    clientNumberInGroup += 1;
    return { ...row, groupNumber: undefined, clientNumberInGroup };
  });
}

export type CampaignTelegramActiveClientCounts = {
  outgoingManualCount: number;
  outgoingSystemCount: number;
  incomingCount: number;
};

export type CampaignInstagramActiveClientCounts = {
  incomingCount: number;
  outgoingCount: number;
};

function clientUsesCampaignTelegram(client: InactiveBaseClientRow): boolean {
  const ch = client.lastCampaign?.channels;
  if (!ch?.length) return true;
  return ch.includes("telegram");
}

function clientUsesCampaignInstagram(client: InactiveBaseClientRow): boolean {
  const ch = client.lastCampaign?.channels;
  if (!ch?.length) return true;
  return ch.includes("instagram");
}

/** Аудиторія кампанії: усього / з telegramChatId / без. */
export function computeCampaignAudienceCountsByCampaignId(
  clients: InactiveBaseClientRow[]
): Map<string, CampaignAudienceCounts> {
  const map = new Map<string, { total: number; activated: number }>();

  for (const client of clients) {
    const campaignId = client.lastCampaign?.campaignId?.trim();
    if (!campaignId || !clientUsesCampaignTelegram(client)) continue;

    let bucket = map.get(campaignId);
    if (!bucket) {
      bucket = { total: 0, activated: 0 };
      map.set(campaignId, bucket);
    }
    bucket.total += 1;
    if (client.telegramChatId != null) bucket.activated += 1;
  }

  const result = new Map<string, CampaignAudienceCounts>();
  for (const [campaignId, bucket] of map) {
    result.set(campaignId, {
      total: bucket.total,
      activated: bucket.activated,
      nonActivated: bucket.total - bucket.activated,
    });
  }
  return result;
}

/** У згорнутій групі: скільки клієнтів мають хоча б одне повідомлення кожного типу (не сума повідомлень). */
export function computeCampaignTelegramActiveClientCounts(
  clients: InactiveBaseClientRow[]
): Map<string, CampaignTelegramActiveClientCounts> {
  const map = new Map<string, CampaignTelegramActiveClientCounts>();

  for (const client of clients) {
    const campaignId = client.lastCampaign?.campaignId?.trim();
    if (!campaignId || !clientUsesCampaignTelegram(client)) continue;

    let bucket = map.get(campaignId);
    if (!bucket) {
      bucket = { outgoingManualCount: 0, outgoingSystemCount: 0, incomingCount: 0 };
      map.set(campaignId, bucket);
    }

    if ((client.telegramOutgoingManualCount ?? 0) > 0) bucket.outgoingManualCount += 1;
    if ((client.telegramOutgoingSystemCount ?? 0) > 0) bucket.outgoingSystemCount += 1;
    if ((client.telegramIncomingCount ?? 0) > 0) bucket.incomingCount += 1;
  }

  return map;
}

/** У згорнутій групі: скільки клієнтів мають хоча б одне повідомлення кожного типу (не сума повідомлень). */
export function computeCampaignInstagramActiveClientCounts(
  clients: InactiveBaseClientRow[]
): Map<string, CampaignInstagramActiveClientCounts> {
  const map = new Map<string, CampaignInstagramActiveClientCounts>();

  for (const client of clients) {
    const campaignId = client.lastCampaign?.campaignId?.trim();
    if (!campaignId || !clientUsesCampaignInstagram(client)) continue;

    let bucket = map.get(campaignId);
    if (!bucket) {
      bucket = { incomingCount: 0, outgoingCount: 0 };
      map.set(campaignId, bucket);
    }

    if ((client.instagramIncomingCount ?? 0) > 0) bucket.incomingCount += 1;
    if ((client.instagramOutgoingCount ?? 0) > 0) bucket.outgoingCount += 1;
  }

  return map;
}

/** У згорнутій групі: скільки клієнтів перейшли по посиланню кампанії (хоча б 1 клік). */
export function computeCampaignLinkClickedClientCounts(
  clients: InactiveBaseClientRow[]
): Map<string, number> {
  const map = new Map<string, number>();

  for (const client of clients) {
    const campaignId = client.lastCampaign?.campaignId?.trim();
    if (
      !campaignId ||
      !client.campaignHasTrackableLink ||
      !client.campaignLinkClickedInCurrentCampaign
    ) {
      continue;
    }

    map.set(campaignId, (map.get(campaignId) ?? 0) + 1);
  }

  return map;
}

/** У згорнутій групі: сума всіх дзвінків Binotel учасників (вхідні + вихідні, будь-який статус). */
export function computeCampaignBinotelTotalCallCounts(
  clients: InactiveBaseClientRow[]
): Map<string, number> {
  const map = new Map<string, number>();

  for (const client of clients) {
    const campaignId = client.lastCampaign?.campaignId?.trim();
    if (!campaignId) continue;

    const calls = client.binotelCallsCount ?? 0;
    if (calls <= 0) continue;

    map.set(campaignId, (map.get(campaignId) ?? 0) + calls);
  }

  return map;
}

export function collectClientIdsForCampaign(
  clients: InactiveBaseClientRow[],
  campaignId: string
): string[] {
  return clients.filter((c) => c.lastCampaign?.campaignId === campaignId).map((c) => c.id);
}

/** id клієнтів: окремі галочки + згорнуті групи (галочка лідера = уся група). */
export function expandSelectedClientIds(
  clients: InactiveBaseClientRow[],
  selectedClientIds: Iterable<string>,
  selectedCollapsedCampaignIds: Iterable<string>
): string[] {
  const set = new Set<string>();
  for (const id of selectedClientIds) set.add(id);
  for (const campaignId of selectedCollapsedCampaignIds) {
    for (const id of collectClientIdsForCampaign(clients, campaignId)) set.add(id);
  }
  return Array.from(set);
}

/** Стан галочки рядка: згорнута група — вся група; розгорнута — лише клієнт рядка. */
export function isDisplayRowChecked(
  row: DisplayRow,
  expandedCampaignIds: Set<string>,
  selectedClientIds: Set<string>,
  selectedCollapsedCampaignIds: Set<string>
): boolean {
  if (row.kind === "campaignLeader" && !expandedCampaignIds.has(row.campaignId)) {
    return selectedCollapsedCampaignIds.has(row.campaignId);
  }
  return selectedClientIds.has(row.client.id);
}
