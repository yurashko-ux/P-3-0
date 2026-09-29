// Форматування щоденного звіту для Telegram.

import type { DailyOpsReportData } from "@/lib/reports/daily-ops";
import {
  buildDirectClientsHref,
  formatClientLinksForTelegram,
  formatNameListForTelegram,
  formatTelegramHtmlLink,
} from "@/lib/reports/daily-ops-extras";

function formatKyivDateLabel(kyivDay: string): string {
  const [, m, d] = kyivDay.split("-");
  return `${d}.${m}.${kyivDay.slice(0, 4)}`;
}

function formatMoneyUah(amount: number): string {
  return `${Math.round(amount).toLocaleString("uk-UA")} ₴`;
}

function formatRemovedFromActiveBase(data: DailyOpsReportData): string {
  const count = data.removedFromActiveBaseCount;
  if (count <= 0) return "<b>0</b>";

  const clients = data.removedFromActiveBaseClients || [];
  const clientIds = clients.map((client) => client.id).filter(Boolean);
  if (clientIds.length === 0) {
    return `<b>${count}</b>${formatClientLinksForTelegram(clients)}`;
  }

  // Спільне посилання на всіх вибулих за день — і на числі, і на кожному імені.
  const allHref = buildDirectClientsHref(clientIds, {
    day: data.kyivDay,
    activeBaseChange: "removed",
  });
  const countLink = formatTelegramHtmlLink(allHref, String(count));
  const nameLinks = formatClientLinksForTelegram(clients, {
    sharedHref: allHref,
  });
  return `<b>${countLink}</b>${nameLinks}`;
}

export function formatDailyReportTelegram(data: DailyOpsReportData): string {
  const missedNames = formatNameListForTelegram(data.callsMissedNames);

  return [
    `<b>📊 Щоденний звіт · ${formatKyivDateLabel(data.kyivDay)}</b>`,
    "────────────────",
    `👤 Ліди Агенція 1: <b>${data.newLeadsAgency1Count}</b>`,
    `👤 Ліди Агенція 2*: <b>${data.newLeadsAgency2Count}</b>`,
    `Записалось на консультацію: <b>${data.leadsRecordsCount}</b>`,
    `Прийшло на консультацію: <b>${data.consultationRealized}</b>`,
    `Нові клієнти: <b>${data.newClientsCount}</b>`,
    `📅 Консультації на дату: <b>${data.consultationBookedToday}</b>`,
    `💇 Перезаписи: <b>${data.rebookingsCount}</b>`,
    `Записи створено: <b>${data.recordsCreatedCount}</b>`,
    `Записів відбулось: <b>${data.recordsRealizedCountToday}</b>`,
    `💰 Оборот: <b>${formatMoneyUah(data.turnoverToday)}</b>`,
    `💳 Завдатки: <b>${formatMoneyUah(data.depositsToday)}</b>`,
    `🏦 Незведені платежі: вх. <b>${data.incomingUnmatched}</b> · вих. <b>${data.outgoingUnmatched}</b>`,
    `📞 Дзвінки: вх. <b>${data.callsIncoming}</b> / вих. <b>${data.callsOutgoing}</b> · пропущ. <b>${data.callsMissed}</b>${missedNames}`,
    `Активна база: <b>${data.activeBaseCount}</b>`,
    `З активної бази вибуло: ${formatRemovedFromActiveBase(data)}`,
  ].join("\n");
}
