// Форматування щоденного звіту для Telegram.

import type { DailyOpsReportData } from "@/lib/reports/daily-ops";
import { formatNameListForTelegram } from "@/lib/reports/daily-ops-extras";

function formatKyivDateLabel(kyivDay: string): string {
  const [, m, d] = kyivDay.split("-");
  return `${d}.${m}.${kyivDay.slice(0, 4)}`;
}

function formatMoneyUah(amount: number): string {
  return `${Math.round(amount).toLocaleString("uk-UA")} ₴`;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://p-3-0.vercel.app").replace(/\/$/, "");
}

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function activeBaseListUrl(
  day: string,
  kind: "removed" | "returned",
  clientIds: string[],
): string {
  const params = new URLSearchParams();
  params.set("clientIds", clientIds.join(","));
  params.set("activeBaseChange", kind);
  params.set("day", day);
  return `${appBaseUrl()}/admin/direct?${params.toString()}`;
}

function formatLinkedNameList(names: string[], href: string, maxItems = 8): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0 || !href) return "";
  const safeHref = escapeTelegramHtml(href);
  const shown = unique.slice(0, maxItems);
  const linked = shown
    .map((name) => `<a href="${safeHref}">${escapeTelegramHtml(name)}</a>`)
    .join(", ");
  const extra = unique.length > maxItems ? ` +${unique.length - maxItems}` : "";
  return ` (${linked}${extra})`;
}

function formatActiveBasePeople(
  count: number,
  names: string[],
  clientIds: string[],
  day: string,
  kind: "removed" | "returned",
): string {
  if (count <= 0) return "<b>0</b>";
  const href = clientIds.length > 0 ? activeBaseListUrl(day, kind, clientIds) : "";
  const namesHtml = href
    ? formatLinkedNameList(names, href)
    : formatNameListForTelegram(names);
  const countHtml = href
    ? `<a href="${escapeTelegramHtml(href)}"><b>${count}</b></a>`
    : `<b>${count}</b>`;
  return `${countHtml}${namesHtml}`;
}

export function formatDailyReportTelegram(data: DailyOpsReportData): string {
  const missedNames = formatNameListForTelegram(data.callsMissedNames);

  return [
    `<b>📊 Щоденний звіт · ${formatKyivDateLabel(data.kyivDay)}</b>`,
    "────────────────",
    `👤 Ліди Агенція 1♥: <b>${data.newLeadsAgency1Count}</b>`,
    `👤 Ліди Агенція 2*: <b>${data.newLeadsAgency2Count}</b>`,
    `👤 Ліди Organic: <b>${data.newLeadsOrganicCount}</b>`,
    `Записалось на консультацію: <b>${data.leadsRecordsCount}</b>`,
    `Прийшло на консультацію: <b>${data.consultationRealized}</b>`,
    `Нові клієнти: <b>${data.newClientsCount}</b>`,
    ...(data.returnedToActiveBaseCount > 0
      ? [
          `Повернуті: ${formatActiveBasePeople(
            data.returnedToActiveBaseCount,
            data.returnedToActiveBaseNames,
            data.returnedToActiveBaseClientIds,
            data.kyivDay,
            "returned",
          )}`,
        ]
      : []),
    `📅 Консультації на дату: <b>${data.consultationBookedToday}</b>`,
    `💇 Перезаписи: <b>${data.rebookingsCount}</b>`,
    `Записи створено: <b>${data.recordsCreatedCount}</b>`,
    `Записів відбулось: <b>${data.recordsRealizedCountToday}</b>`,
    `💰 Оборот: <b>${formatMoneyUah(data.turnoverToday)}</b>`,
    `🏦 Незведені платежі: вх. <b>${data.incomingUnmatched}</b> · вих. <b>${data.outgoingUnmatched}</b>`,
    `📞 Дзвінки: вх. <b>${data.callsIncoming}</b> / вих. <b>${data.callsOutgoing}</b> · пропущ. <b>${data.callsMissed}</b>${missedNames}`,
    `Активна база: <b>${data.activeBaseCount}</b>`,
    `З активної бази вибуло: ${formatActiveBasePeople(
      data.removedFromActiveBaseCount,
      data.removedFromActiveBaseNames,
      data.removedFromActiveBaseClientIds,
      data.kyivDay,
      "removed",
    )}`,
  ].join("\n");
}
