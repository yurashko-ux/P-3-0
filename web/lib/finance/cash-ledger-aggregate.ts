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
  posted: boolean;
  appointmentId?: string | null;
};

/** Номер запису Altegio і запис журналу Креско, якщо він там є. */
export type CashLedgerRecordLink = { recordId: number; appointmentId: string | null };

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
 * Один клієнт, один рахунок і один напрямок за день — один рядок (призначення через кому:
 * «Продаж товарів, Надання послуг»). Рядки без клієнта (переміщення, витрати) — окремо за призначенням.
 * Викликати вже в межах одного kyivDay (як у вкладці «Готівка»).
 */
export function aggregateCashLedgerDayRows<T extends CashLedgerAggregateSource>(
  dayRows: T[],
): Array<T & { recordLinks: CashLedgerRecordLink[] }> {
  const groups = new Map<
    string,
    T & { signed: number; times: Set<string>; records: Map<number, string | null>; titles: Set<string> }
  >();
  for (const row of dayRows) {
    const client = row.clientName.trim();
    const purpose = row.title.trim();
    const key = `${client}\0${row.accountTitle}\0${row.currency}\0${row.direction}\0${client ? "" : purpose}`;
    const signed = row.direction === "out" ? -row.amount : row.amount;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...row,
        clientName: client,
        signed,
        times: new Set([timeLabelKyiv(row.occurredAt)]),
        records: new Map(row.recordId ? [[row.recordId, row.appointmentId ?? null]] : []),
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
    if (row.recordId && !current.records.get(row.recordId)) {
      current.records.set(row.recordId, row.appointmentId ?? null);
    }
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
        recordId: group.records.size === 1 ? [...group.records.keys()][0] : null,
        // Рядок із кількох записів показує всі номери, а не тире.
        recordLinks: [...group.records].map(([recordId, appointmentId]) => ({ recordId, appointmentId })),
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
