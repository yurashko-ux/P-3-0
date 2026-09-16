import type { DirectClient } from "@/lib/direct-types";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

/** Мінімальний DirectClient для модалки історії дзвінків. */
export function inactiveBaseRowToDirectClient(client: InactiveBaseClientRow): DirectClient {
  return {
    id: client.id,
    altegioClientId: client.altegioClientId ?? null,
    instagramUsername: client.instagramUsername,
    firstName: client.firstName,
    lastName: client.lastName,
    phone: client.phone,
    spent: client.spent ?? null,
    visits: client.visits ?? null,
    callStatusId: client.callStatusId ?? null,
    callStatusName: client.callStatusName ?? null,
    callStatusBadgeKey: client.callStatusBadgeKey ?? null,
    statusId: client.statusId || "",
    statusSetAt: client.statusSetAt ?? undefined,
  } as DirectClient;
}

/** DirectClient для колонки «Статус» (той самий DirectStatusCell, що в Direct). */
export function inactiveBaseRowToStatusCellClient(client: InactiveBaseClientRow): DirectClient {
  const fallbackDate = client.statusSetAt || new Date().toISOString();
  return {
    id: client.id,
    instagramUsername: client.instagramUsername,
    firstName: client.firstName ?? undefined,
    lastName: client.lastName ?? undefined,
    firstContactDate: fallbackDate,
    createdAt: fallbackDate,
    updatedAt: fallbackDate,
    source: "instagram",
    visitedSalon: false,
    signedUpForPaidService: true,
    statusId: client.statusId || "",
    statusSetAt: client.statusSetAt ?? undefined,
    altegioClientId: client.altegioClientId ?? undefined,
  };
}
