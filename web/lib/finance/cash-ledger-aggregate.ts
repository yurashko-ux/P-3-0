/** Спільна агрегація рядків готівки для плитки Каса і вкладки «Готівка». */

export type CashLedgerAggregateSource = {
  clientName: string;
  title: string;
  accountTitle: string;
  currency: string;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
  occurredAt: string;
  recordId: number | null;
  visitId?: number | null;
  posted: boolean;
};

function timeLabelKyiv(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Один клієнт, один запис, один рахунок і один напрямок за день — один рядок (призначення через кому:
 * «Продаж товарів, Надання послуг»). Записи одного візиту (кілька майстрів — Altegio ділить оплати між ними) — один рядок; два окремі візити — два рядки. Рядки без клієнта (переміщення, витрати) — окремо за призначенням.
 * Викликати вже в межах одного kyivDay (як у вкладці «Готівка»).
 */
export function aggregateCashLedgerDayRows<T extends CashLedgerAggregateSource>(
  dayRows: T[],
): T[] {
  const groups = new Map<
    string,
    T & { signed: number; times: Set<string>; records: Set<number>; titles: Set<string> }
  >();
  for (const [index, row] of dayRows.entries()) {
    const client = row.clientName.trim();
    const purpose = row.title.trim();
    const key = `${client}\0${client ? (row.visitId ? `v${row.visitId}` : row.recordId ?? "") : ""}\0${row.accountTitle}\0${row.currency}\0${row.direction}\0${client ? "" : purpose}\0${row.direction === "out" ? index : ""}`;
    // Вихідні не зливаємо: кожен розхід — окремий рядок зі своїм часом і коментарем
    const signed = row.direction === "out" ? -row.amount : row.amount;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...row,
        clientName: client,
        signed,
        times: new Set([timeLabelKyiv(row.occurredAt)]),
        records: new Set(row.recordId ? [row.recordId] : []),
        titles: new Set(row.title ? [row.title] : []),
      });
      continue;
    }
    current.signed += signed;
    current.posted = current.posted && row.posted;
    // Хоч одна частина за курсом — позначаємо весь рядок «≈ за курсом».
    const rowFx = (row as { fxRate?: number | null }).fxRate;
    if (rowFx && !(current as { fxRate?: number | null }).fxRate) {
      (current as { fxRate?: number | null }).fxRate = rowFx;
    }
    current.times.add(timeLabelKyiv(row.occurredAt));
    if (row.recordId) current.records.add(row.recordId);
    if (row.title) current.titles.add(row.title);
    if (row.occurredAt > current.occurredAt) current.occurredAt = row.occurredAt;
  }
  return [...groups.values()]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((group) => {
      const signed = Math.round(group.signed * 100) / 100;
      const incoming = signed >= 0;
      const times = [...group.times].filter(Boolean);
      return {
        ...group,
        direction: (incoming ? "in" : "out") as "in" | "out",
        amount: Math.abs(signed),
        title: [...group.titles].join(", ") || "—",
        // Візит із кількох записів — показуємо перший запис візиту
        recordId: group.records.size > 0 && (group.records.size === 1 || group.visitId) ? Math.min(...group.records) : null,
        occurredAt: times.length === 1 ? group.occurredAt : "",
      };
    });
}

/** Агрегація відкритих рядків по днях — як лічильник «Не зведені» у Готівці. */
export function aggregateOpenCashLedgerRows<T extends CashLedgerAggregateSource>(
  rows: T[],
): T[] {
  const byDay = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byDay.get(row.kyivDay) || [];
    bucket.push(row);
    byDay.set(row.kyivDay, bucket);
  }
  const aggregated: T[] = [];
  for (const dayRows of byDay.values()) {
    aggregated.push(...aggregateCashLedgerDayRows(dayRows));
  }
  return aggregated;
}
