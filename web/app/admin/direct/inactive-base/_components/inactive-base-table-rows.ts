// Побудова рядків таблиці з групами кампаній (акордеон).

import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

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
  for (const c of clients) {
    const cid = campaignIdOf(c);
    if (cid) memberCounts.set(cid, (memberCounts.get(cid) ?? 0) + 1);
  }

  const seenCampaigns = new Set<string>();
  const rows: DisplayRow[] = [];

  for (const client of clients) {
    const cid = campaignIdOf(client);
    if (!cid || !client.lastCampaign) {
      rows.push({ kind: "solo", client });
      continue;
    }

    if (!seenCampaigns.has(cid)) {
      seenCampaigns.add(cid);
      rows.push({
        kind: "campaignLeader",
        client,
        campaignId: cid,
        campaignName: client.lastCampaign.name,
        memberCount: memberCounts.get(cid) ?? 1,
      });
    } else if (expandedCampaignIds.has(cid)) {
      rows.push({ kind: "campaignMember", client, campaignId: cid });
    }
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
