// Класифікація зведених завдатків (клієнт-безпечні утиліти, без серверних імпортів).

import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { isCashReconcileAccount } from "@/lib/bank/incoming-reconcile-matching";

export type DepositRealizationStatus = "active" | "realized";

export type DepositRealizationMeta = {
  recordAt: string | null;
  recordId: number | null;
  status: DepositRealizationStatus;
};

export type DepositRealizationIndex = {
  byMatchKey: Record<string, DepositRealizationMeta>;
  byAltegioId: Record<number, DepositRealizationMeta>;
};

export type DepositSplitAccountRow = {
  matchKey: string;
  isDepositMatch?: boolean;
  altegioAccount?: {
    accountTitle: string;
    clients: Array<{
      items: Array<{
        altegioId: number;
        paymentPurpose?: string | null;
        operationTime: string;
        recordId?: number | null;
      }>;
    }>;
  } | null;
  bankGroup?: {
    accountTitle: string;
    altegioAccountTitle: string | null;
    rows: unknown[];
  } | null;
};

export type DepositSplitDay = {
  kyivDay: string;
  dayLabel: string;
  accountRows: DepositSplitAccountRow[];
  altegio?: unknown;
  bank?: unknown;
};

/** Мінімальний тип матчу завдатку для клієнтської класифікації. */
export type DepositMatchForRealization = {
  altegioTransactionId: number;
  appointmentAt: string | null;
  operationTime: string | null;
};

function parseRecordDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Безготівковий завдаток (зведений або ні). */
export function isNonCashDepositRow(row: DepositSplitAccountRow): boolean {
  if (!accountRowIsDeposit(row)) return false;

  const titles = [
    row.altegioAccount?.accountTitle,
    row.bankGroup?.accountTitle,
    row.bankGroup?.altegioAccountTitle,
  ].filter((title): title is string => Boolean(title?.trim()));

  if (titles.some((title) => isCashReconcileAccount(title))) return false;
  return true;
}

/** Чи рядок — зведений безготівковий завдаток з банківською парою. */
export function isReconciledNonCashDepositRow(row: DepositSplitAccountRow): boolean {
  return isNonCashDepositRow(row) && Boolean(row.bankGroup?.rows.length);
}

export function depositRowAltegioId(row: DepositSplitAccountRow): number | null {
  return primaryAltegioIdFromRow(row);
}

/** Усі deposit-рядки для вкладки: зведені + незведені (без дублікатів за altegioId). */
export function buildDepositTabSourceDays(
  linkedDays: DepositSplitDay[],
  openDays: DepositSplitDay[],
): DepositSplitDay[] {
  const seenAltegioIds = new Set<number>();
  const seenMatchKeys = new Set<string>();
  const byDay = new Map<string, { dayLabel: string; accountRows: DepositSplitAccountRow[] }>();

  function tryAdd(day: DepositSplitDay, row: DepositSplitAccountRow): void {
    if (!isNonCashDepositRow(row)) return;

    const altegioId = primaryAltegioIdFromRow(row);
    if (altegioId != null) {
      if (seenAltegioIds.has(altegioId)) return;
      seenAltegioIds.add(altegioId);
    } else {
      if (seenMatchKeys.has(row.matchKey)) return;
      seenMatchKeys.add(row.matchKey);
    }

    const bucket = byDay.get(day.kyivDay) ?? { dayLabel: day.dayLabel, accountRows: [] };
    bucket.accountRows.push(row);
    byDay.set(day.kyivDay, bucket);
  }

  for (const day of linkedDays) {
    for (const row of day.accountRows) tryAdd(day, row);
  }
  for (const day of openDays) {
    for (const row of day.accountRows) tryAdd(day, row);
  }

  return Array.from(byDay.entries())
    .map(([kyivDay, { dayLabel, accountRows }]) => ({
      kyivDay,
      dayLabel,
      accountRows,
      altegio: null,
      bank: null,
    }))
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}

export function accountRowIsDeposit(row: DepositSplitAccountRow): boolean {
  if (row.isDepositMatch) return true;
  return row.altegioAccount?.clients.some((client) =>
    client.items.some((item) => isDepositTopUpPaymentPurpose(item.paymentPurpose || "")),
  ) ?? false;
}

/** Класифікація за датою запису відносно «зараз». */
export function classifyDepositRealization(
  recordAt: Date | null,
  now: Date = new Date(),
): DepositRealizationStatus {
  if (!recordAt || Number.isNaN(recordAt.getTime())) return "active";
  return recordAt.getTime() > now.getTime() ? "active" : "realized";
}

/** Пріоритет: appointmentAt → дата запису за recordId (fallback #3 — лише на сервері). */
export function resolveDepositRecordAt(sources: {
  appointmentAt?: string | null;
  recordDateFromId?: string | null;
  paymentOperationTime?: string | null;
}): Date | null {
  const fromAppointment = parseRecordDate(sources.appointmentAt);
  if (fromAppointment) return fromAppointment;
  return parseRecordDate(sources.recordDateFromId);
}

function primaryAltegioIdFromRow(row: DepositSplitAccountRow): number | null {
  for (const client of row.altegioAccount?.clients ?? []) {
    for (const item of client.items) {
      if (isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) return item.altegioId;
      if (row.isDepositMatch) return item.altegioId;
    }
  }
  return null;
}

function classifyRow(
  row: DepositSplitAccountRow,
  index: DepositRealizationIndex,
  depositMatchByAltegioId: Map<number, DepositMatchForRealization>,
  now: Date,
): DepositRealizationStatus {
  // Незведений завдаток без банку — завжди «на депозиті» (зверху).
  if (!row.bankGroup?.rows?.length) return "active";

  const fromKey = index.byMatchKey[row.matchKey];
  if (fromKey) return fromKey.status;

  const altegioId = primaryAltegioIdFromRow(row);
  if (altegioId != null && index.byAltegioId[altegioId]) {
    return index.byAltegioId[altegioId].status;
  }

  const match = altegioId != null ? depositMatchByAltegioId.get(altegioId) : undefined;
  const depositItem = row.altegioAccount?.clients
    .flatMap((client) => client.items)
    .find((item) => isDepositTopUpPaymentPurpose(item.paymentPurpose || "") || row.isDepositMatch);

  const recordAt = resolveDepositRecordAt({
    appointmentAt: match?.appointmentAt,
    recordDateFromId: null,
    paymentOperationTime: depositItem?.operationTime ?? match?.operationTime,
  });

  return classifyDepositRealization(recordAt, now);
}

/** Ділить deposit-рядки на active/realized; дні можуть мати рядки в обох секціях. */
export function splitReconciledDepositRows(
  days: DepositSplitDay[],
  realizationIndex: DepositRealizationIndex,
  depositMatches: DepositMatchForRealization[],
  now: Date = new Date(),
): { activeDays: DepositSplitDay[]; realizedDays: DepositSplitDay[] } {
  const depositOnlyDays = days
    .map((day) => {
      const accountRows = day.accountRows.filter(isNonCashDepositRow);
      if (accountRows.length === 0) return null;
      return { ...day, accountRows };
    })
    .filter((day): day is DepositSplitDay => day != null);

  const depositMatchByAltegioId = new Map(
    depositMatches.map((match) => [match.altegioTransactionId, match]),
  );

  const activeByDay = new Map<string, DepositSplitAccountRow[]>();
  const realizedByDay = new Map<string, DepositSplitAccountRow[]>();
  const dayMeta = new Map<string, { dayLabel: string; altegio?: unknown; bank?: unknown }>();

  for (const day of depositOnlyDays) {
    dayMeta.set(day.kyivDay, {
      dayLabel: day.dayLabel,
      altegio: day.altegio,
      bank: day.bank,
    });

    for (const row of day.accountRows) {
      const status = classifyRow(row, realizationIndex, depositMatchByAltegioId, now);
      const bucket = status === "active" ? activeByDay : realizedByDay;
      if (!bucket.has(day.kyivDay)) bucket.set(day.kyivDay, []);
      bucket.get(day.kyivDay)!.push(row);
    }
  }

  function buildDays(bucket: Map<string, DepositSplitAccountRow[]>): DepositSplitDay[] {
    return Array.from(bucket.entries())
      .map(([kyivDay, accountRows]) => {
        const meta = dayMeta.get(kyivDay)!;
        return {
          kyivDay,
          dayLabel: meta.dayLabel,
          altegio: meta.altegio,
          bank: meta.bank,
          accountRows,
        };
      })
      .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  }

  return {
    activeDays: buildDays(activeByDay),
    realizedDays: buildDays(realizedByDay),
  };
}
