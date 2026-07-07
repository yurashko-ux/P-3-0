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

function formatRemovedFromActiveBase(data: DailyOpsReportData): string {
  const count = data.removedFromActiveBaseCount;
  if (count <= 0) return "<b>0</b>";
  const names = formatNameListForTelegram(data.removedFromActiveBaseNames);
  return `<b>${count}</b>${names}`;
}

export function formatDailyReportTelegram(data: DailyOpsReportData): string {
  const missedNames = formatNameListForTelegram(data.callsMissedNames);

  return [
    `<b>📊 Щоденний звіт · ${formatKyivDateLabel(data.kyivDay)}</b>`,
    "────────────────",
    `👤 Ліди: <b>${data.newLeadsCount}</b>`,
    `Записалось на консультацію: <b>${data.leadsRecordsCount}</b>`,
    `Прийшло на консультацію: <b>${data.consultationRealized}</b>`,
    `Нові клієнти: <b>${data.newClientsCount}</b>`,
    `📅 Консультації на дату: <b>${data.consultationBookedToday}</b>`,
    `💇 Перезаписи: <b>${data.rebookingsCount}</b>`,
    `Записи створено: <b>${data.recordsCreatedCount}</b>`,
    `Записів відбулось: <b>${data.recordsRealizedCountToday}</b>`,
    `💰 Оборот: <b>${formatMoneyUah(data.turnoverToday)}</b>`,
    `🏦 Незведені платежі: вх. <b>${data.incomingUnmatched}</b> · вих. <b>${data.outgoingUnmatched}</b>`,
    `📞 Дзвінки: вх. <b>${data.callsIncoming}</b> / вих. <b>${data.callsOutgoing}</b> · пропущ. <b>${data.callsMissed}</b>${missedNames}`,
    `Активна база: <b>${data.activeBaseCount}</b>`,
    `З активної бази вибуло: ${formatRemovedFromActiveBase(data)}`,
  ].join("\n");
}
