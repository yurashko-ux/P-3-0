// Форматування щоденного звіту для Telegram.

import type { DailyOpsReportData } from "@/lib/reports/daily-ops";

function formatKyivDateLabel(kyivDay: string): string {
  const [y, m, d] = kyivDay.split("-");
  return `${d}.${m}.${y}`;
}

function formatMoneyUah(amount: number): string {
  return `${Math.round(amount).toLocaleString("uk-UA")} ₴`;
}

export function formatDailyReportTelegram(data: DailyOpsReportData): string {
  const consultOnDate = data.consultationBookedToday;
  const consultBreakdown = `✓${data.consultationRealized} ✗${data.consultationNoShow + data.consultationCancelled} ○${data.consultationPlanned}`;

  return [
    `<b>📊 Щоденний звіт · ${formatKyivDateLabel(data.kyivDay)}</b>`,
    "────────────────",
    `👤 Ліди: <b>${data.newLeadsCount}</b> · Нові клієнти: <b>${data.newClientsCount}</b>`,
    `📅 Консультації: створено <b>${data.consultationCreated}</b> · на дату <b>${consultOnDate}</b> (${consultBreakdown})`,
    `💇 Записи: створено <b>${data.recordsCreatedCount}</b> · на дату <b>${data.recordsPlannedCountToday}</b> (✓${data.recordsRealizedCountToday})`,
    `💰 Оборот: <b>${formatMoneyUah(data.turnoverToday)}</b>`,
    `🏦 Незведені: вх. <b>${data.incomingUnmatched}</b> · вих. <b>${data.outgoingUnmatched}</b>`,
    `📞 Дзвінки: вх. <b>${data.callsIncoming}</b> / вих. <b>${data.callsOutgoing}</b> · пропущ. <b>${data.callsMissed}</b>`,
  ].join("\n");
}
