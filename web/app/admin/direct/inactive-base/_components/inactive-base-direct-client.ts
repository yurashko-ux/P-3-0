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
  } as DirectClient;
}
