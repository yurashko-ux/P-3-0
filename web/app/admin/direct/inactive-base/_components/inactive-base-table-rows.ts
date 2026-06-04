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

export function collectClientIdsForCampaign(
  clients: InactiveBaseClientRow[],
  campaignId: string
): string[] {
  return clients.filter((c) => c.lastCampaign?.campaignId === campaignId).map((c) => c.id);
}
