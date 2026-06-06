import type { DirectClient } from "@/lib/direct-types";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

/** Мінімальний DirectClient для модалки історії дзвінків. */
export function inactiveBaseRowToDirectClient(client: InactiveBaseClientRow): DirectClient {
  return {
    id: client.id,
    instagramUsername: client.instagramUsername,
    firstName: client.firstName,
    lastName: client.lastName,
    phone: client.phone,
    callStatusId: client.callStatusId ?? null,
    callStatusName: client.callStatusName ?? null,
    callStatusBadgeKey: client.callStatusBadgeKey ?? null,
  } as DirectClient;
}
