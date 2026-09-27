// Додаткові метрики щоденного звіту: активна база, пропущені дзвінки (ПІБ), F4-записи.

import { prisma } from "@/lib/prisma";
import { getKyivDayUtcBounds, getPreviousKyivDay } from "@/lib/direct-stats-config";
import { clientMatchesF4NewPaidInUtcInterval } from "@/lib/direct-f4-client-match";
import type { DirectClient } from "@/lib/direct-types";
import {
  calculateDirectActiveBaseSnapshot,
  computeActiveBaseDayDeltaClientIds,
} from "@/lib/direct-active-base-snapshot";

const SUCCESS_DISPOSITIONS = new Set(["ANSWER", "VM-SUCCESS", "SUCCESS"]);

export type RemovedActiveBaseClient = {
  id: string;
  name: string;
};

export type ActiveBaseDailyMetrics = {
  activeBaseCount: number;
  removedFromActiveBaseCount: number;
  /** @deprecated використовуйте removedFromActiveBaseClients */
  removedFromActiveBaseNames: string[];
  removedFromActiveBaseClients: RemovedActiveBaseClient[];
};

export function formatClientDisplayName(client: {
  firstName?: string | null;
  lastName?: string | null;
  instagramUsername?: string | null;
}): string {
  const fullName = [client.firstName, client.lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  const username = String(client.instagramUsername || "").trim();
  if (username) return username.startsWith("@") ? username : `@${username}`;
  return "—";
}

function truncateNameList(names: string[], maxItems = 8): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length <= maxItems) return unique.join(", ");
  return `${unique.slice(0, maxItems).join(", ")} +${unique.length - maxItems}`;
}

export function countF4RecordsCreatedOnDay(clients: DirectClient[], kyivDay: string): number {
  const { startUtc, endUtc } = getKyivDayUtcBounds(kyivDay);
  return clients.filter((client) =>
    clientMatchesF4NewPaidInUtcInterval(client, startUtc, endUtc),
  ).length;
}

export async function getActiveBaseDailyMetrics(kyivDay: string): Promise<ActiveBaseDailyMetrics> {
  const [todaySnapshot, prevDay] = await Promise.all([
    calculateDirectActiveBaseSnapshot(kyivDay),
    Promise.resolve(getPreviousKyivDay(kyivDay)),
  ]);
  const prevSnapshot = await calculateDirectActiveBaseSnapshot(prevDay);

  const { removedClientIds } = await computeActiveBaseDayDeltaClientIds(
    prevSnapshot.kyivDay,
    todaySnapshot.kyivDay,
    prevSnapshot.activeClientIds,
    todaySnapshot.activeClientIds,
  );

  let removedFromActiveBaseClients: RemovedActiveBaseClient[] = [];
  if (removedClientIds.length > 0) {
    const clients = await prisma.directClient.findMany({
      where: { id: { in: removedClientIds } },
      select: { id: true, firstName: true, lastName: true, instagramUsername: true },
    });
    const byId = new Map(clients.map((client) => [client.id, client]));
    removedFromActiveBaseClients = removedClientIds.map((id) => ({
      id,
      name: formatClientDisplayName(byId.get(id) ?? {}),
    }));
  }

  return {
    activeBaseCount: todaySnapshot.activeBaseCount,
    removedFromActiveBaseCount: removedClientIds.length,
    removedFromActiveBaseNames: removedFromActiveBaseClients.map((client) => client.name),
    removedFromActiveBaseClients,
  };
}

export async function getBinotelIncomingMissedOnKyivDay(kyivDay: string): Promise<{
  count: number;
  names: string[];
}> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kyivDay)) return { count: 0, names: [] };

  try {
    const rows = await prisma.$queryRaw<
      Array<{ clientId: string; callType: string; disposition: string }>
    >`
      WITH day_calls AS (
        SELECT "clientId", "callType", "disposition", "startTime"
        FROM "direct_client_binotel_calls"
        WHERE "clientId" IS NOT NULL
          AND to_char(("startTime" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM-DD') = ${kyivDay}
      ),
      latest_on_day AS (
        SELECT DISTINCT ON ("clientId") "clientId", "callType", "disposition"
        FROM day_calls
        ORDER BY "clientId", "startTime" DESC
      )
      SELECT "clientId", "callType", "disposition" FROM latest_on_day
    `;

    const missedClientIds = rows
      .filter(
        (row) =>
          row.clientId &&
          row.callType === "incoming" &&
          !SUCCESS_DISPOSITIONS.has(row.disposition),
      )
      .map((row) => row.clientId);

    if (missedClientIds.length === 0) return { count: 0, names: [] };

    const clients = await prisma.directClient.findMany({
      where: { id: { in: missedClientIds } },
      select: { id: true, firstName: true, lastName: true, instagramUsername: true },
    });
    const byId = new Map(clients.map((client) => [client.id, client]));
    const names = missedClientIds.map((id) => formatClientDisplayName(byId.get(id) ?? {}));
    return { count: missedClientIds.length, names };
  } catch (err) {
    console.warn("[reports/daily-ops-extras] getBinotelIncomingMissedOnKyivDay:", err);
    return { count: 0, names: [] };
  }
}

export function formatNameListForTelegram(names: string[]): string {
  const text = truncateNameList(names);
  return text ? ` (${text})` : "";
}

const DIRECT_APP_ORIGIN = "https://p-3-0.vercel.app";

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Посилання на картку(и) клієнта в Direct: /admin/direct?clientIds=… */
export function buildDirectClientsHref(clientIds: string[], opts?: {
  day?: string;
  activeBaseChange?: "removed" | "added" | "returned" | "new";
}): string {
  const params = new URLSearchParams();
  params.set("clientIds", [...new Set(clientIds.filter(Boolean))].join(","));
  if (opts?.activeBaseChange) params.set("activeBaseChange", opts.activeBaseChange);
  if (opts?.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day)) params.set("day", opts.day);
  return `${DIRECT_APP_ORIGIN}/admin/direct?${params.toString()}`;
}

/** href для Telegram HTML: & → &amp; (інакше parse_mode ламає посилання). */
export function toTelegramHtmlHref(href: string): string {
  return href.replace(/&/g, "&amp;");
}

export function formatTelegramHtmlLink(href: string, label: string): string {
  return `<a href="${toTelegramHtmlHref(href)}">${escapeTelegramHtml(label)}</a>`;
}

/** Список імен як HTML-посилання в Telegram.
 * Якщо передано sharedHref — усі імена ведуть на один спільний список клієнтів.
 */
export function formatClientLinksForTelegram(
  clients: RemovedActiveBaseClient[],
  opts?: {
    day?: string;
    activeBaseChange?: "removed" | "added" | "returned" | "new";
    /** Спільне посилання для всіх імен (усі вибулі за день). */
    sharedHref?: string;
    maxItems?: number;
  },
): string {
  const maxItems = opts?.maxItems ?? 8;
  const unique = clients.filter((client) => client?.id && client?.name);
  if (unique.length === 0) return "";

  const shown = unique.slice(0, maxItems);
  const links = shown.map((client) => {
    const href =
      opts?.sharedHref
      || buildDirectClientsHref([client.id], {
        day: opts?.day,
        activeBaseChange: opts?.activeBaseChange,
      });
    return formatTelegramHtmlLink(href, client.name);
  });
  const suffix = unique.length > maxItems ? ` +${unique.length - maxItems}` : "";
  return ` (${links.join(", ")}${suffix})`;
}
