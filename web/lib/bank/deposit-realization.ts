// Класифікація зведених завдатків: active (запис у майбутньому) vs realized (запис уже був).

import {
  findNearestRecordAfterPayment,
} from "@/lib/altegio/deposit-attribution";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { fetchIncomingPaymentsWithDocumentNumbers } from "@/lib/altegio/incoming-payments";
import { getClientRecords, type ClientRecord } from "@/lib/altegio/records";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import type { DepositIncomingMatchRecord } from "@/lib/bank/deposit-incoming-reconcile";
import type { IncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import { isCashReconcileAccount } from "@/lib/bank/incoming-reconcile-matching";

export type DepositRealizationStatus = "active" | "realized";

export type DepositRealizationMeta = {
  recordAt: string | null;
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

function resolveCompanyId(): number {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для класифікації завдатків");
  }
  return Number(companyId);
}

function parseRecordDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function recordDateFromRecords(
  records: ClientRecord[],
  recordId: number | null | undefined,
): string | null {
  if (!recordId) return null;
  const found = records.find((record) => record.record_id === recordId);
  return found?.date ?? null;
}

/** Чи рядок — зведений безготівковий завдаток (без готівкових рахунків). */
export function isReconciledNonCashDepositRow(row: DepositSplitAccountRow): boolean {
  if (!accountRowIsDeposit(row)) return false;

  const titles = [
    row.altegioAccount?.accountTitle,
    row.bankGroup?.accountTitle,
    row.bankGroup?.altegioAccountTitle,
  ].filter((title): title is string => Boolean(title?.trim()));

  if (titles.some((title) => isCashReconcileAccount(title))) return false;
  if (!row.bankGroup?.rows.length) return false;
  return true;
}

export function accountRowIsDeposit(row: DepositSplitAccountRow): boolean {
  if (row.isDepositMatch) return true;
  return row.altegioAccount?.clients.some((client) =>
    client.items.some((item) => isDepositTopUpPaymentPurpose(item.paymentPurpose || "")),
  ) ?? false;
}

/** Класифікація за датою запису відносно «зараз» (Kyiv не потрібен — порівнюємо UTC timestamps). */
export function classifyDepositRealization(
  recordAt: Date | null,
  now: Date = new Date(),
): DepositRealizationStatus {
  if (!recordAt || Number.isNaN(recordAt.getTime())) return "active";
  return recordAt.getTime() > now.getTime() ? "active" : "realized";
}

/** Пріоритет: appointmentAt → дата запису за recordId → findNearestRecordAfterPayment. */
export function resolveDepositRecordAt(sources: {
  appointmentAt?: string | null;
  recordDateFromId?: string | null;
  paymentOperationTime?: string | null;
  clientRecords?: ClientRecord[];
}): Date | null {
  const fromAppointment = parseRecordDate(sources.appointmentAt);
  if (fromAppointment) return fromAppointment;

  const fromRecordId = parseRecordDate(sources.recordDateFromId);
  if (fromRecordId) return fromRecordId;

  if (sources.paymentOperationTime && sources.clientRecords?.length) {
    const paymentDate = parseRecordDate(sources.paymentOperationTime);
    if (paymentDate) {
      return findNearestRecordAfterPayment(sources.clientRecords, paymentDate);
    }
  }

  return null;
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

function metaFromRecordAt(recordAt: Date | null, now: Date): DepositRealizationMeta {
  return {
    recordAt: recordAt?.toISOString() ?? null,
    status: classifyDepositRealization(recordAt, now),
  };
}

function filterDepositRows(days: DepositSplitDay[]): DepositSplitDay[] {
  return days
    .map((day) => {
      const accountRows = day.accountRows.filter(isReconciledNonCashDepositRow);
      if (accountRows.length === 0) return null;
      return { ...day, accountRows };
    })
    .filter((day): day is DepositSplitDay => day != null);
}

function classifyRow(
  row: DepositSplitAccountRow,
  index: DepositRealizationIndex,
  depositMatchByAltegioId: Map<number, DepositIncomingMatchRecord>,
  now: Date,
): DepositRealizationStatus {
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
    clientRecords: undefined,
  });

  return classifyDepositRealization(recordAt, now);
}

/** Ділить зведені deposit-рядки на active/realized; дні можуть мати рядки в обох секціях. */
export function splitReconciledDepositRows(
  days: DepositSplitDay[],
  realizationIndex: DepositRealizationIndex,
  depositMatches: DepositIncomingMatchRecord[],
  now: Date = new Date(),
): { activeDays: DepositSplitDay[]; realizedDays: DepositSplitDay[] } {
  const depositOnlyDays = filterDepositRows(days);
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

function buildRecordIdByAltegioId(
  preview: IncomingReconciliationPreview,
): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (const payer of preview.altegio.byPayer) {
    for (const item of payer.items) {
      map.set(item.altegioId, item.recordId ?? null);
    }
  }
  return map;
}

/** Збагачення API: дата запису та статус для зведених безготівкових завдатків. */
export async function buildDepositRealizationForPreview(params: {
  preview: IncomingReconciliationPreview;
  depositMatches: DepositIncomingMatchRecord[];
  reconciledBankItemIds: Set<string>;
}): Promise<DepositRealizationIndex> {
  const { preview, depositMatches, reconciledBankItemIds } = params;
  const now = new Date();
  const byMatchKey: Record<string, DepositRealizationMeta> = {};
  const byAltegioId: Record<number, DepositRealizationMeta> = {};
  const recordIdByAltegioId = buildRecordIdByAltegioId(preview);

  const relevantMatches = depositMatches.filter(
    (match) =>
      !isCashReconcileAccount(match.accountTitle || "")
      && Boolean(match.bankStatementItemId)
      && reconciledBankItemIds.has(match.bankStatementItemId),
  );

  const clientIdByAltegioId = new Map<number, number>();
  for (const match of relevantMatches) {
    if (match.clientId) clientIdByAltegioId.set(match.altegioTransactionId, match.clientId);
  }

  const missingClientIds = new Set<number>();
  for (const match of relevantMatches) {
    if (!match.clientId && !clientIdByAltegioId.has(match.altegioTransactionId)) {
      missingClientIds.add(match.altegioTransactionId);
    }
  }

  if (missingClientIds.size > 0) {
    try {
      const companyId = String(resolveCompanyId());
      const payments = await fetchIncomingPaymentsWithDocumentNumbers({
        dateFrom: preview.dateFrom,
        dateTo: preview.dateTo,
        companyId,
        includeCashboxAccounts: false,
      });
      for (const payment of payments) {
        if (payment.clientId) {
          clientIdByAltegioId.set(payment.transactionId, payment.clientId);
        }
      }
    } catch (error) {
      console.warn("[deposit-realization] Не вдалося отримати clientId:", error);
    }
  }

  const uniqueClientIds = [
    ...new Set(
      relevantMatches
        .map((match) => match.clientId ?? clientIdByAltegioId.get(match.altegioTransactionId))
        .filter((id): id is number => id != null),
    ),
  ];

  const recordsCache = new Map<number, ClientRecord[]>();
  if (uniqueClientIds.length > 0) {
    const companyId = resolveCompanyId();
    const batchSize = 5;
    const delayMs = 200;
    for (let index = 0; index < uniqueClientIds.length; index += batchSize) {
      const batch = uniqueClientIds.slice(index, index + batchSize);
      await Promise.all(
        batch.map(async (clientId) => {
          try {
            recordsCache.set(clientId, await getClientRecords(companyId, clientId));
          } catch (error) {
            console.warn(`[deposit-realization] getClientRecords clientId=${clientId}:`, error);
            recordsCache.set(clientId, []);
          }
        }),
      );
      if (index + batchSize < uniqueClientIds.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  function resolveMetaForDeposit(params: {
    matchKey: string;
    altegioTransactionId: number;
    appointmentAt: string | null;
    operationTime: string | null;
    clientId: number | null;
  }): DepositRealizationMeta {
    const recordId = recordIdByAltegioId.get(params.altegioTransactionId) ?? null;
    const clientRecords = params.clientId != null ? recordsCache.get(params.clientId) ?? [] : [];
    const recordDateFromId = recordDateFromRecords(clientRecords, recordId);

    const recordAt = resolveDepositRecordAt({
      appointmentAt: params.appointmentAt,
      recordDateFromId,
      paymentOperationTime: params.operationTime,
      clientRecords,
    });

    const meta = metaFromRecordAt(recordAt, now);
    byMatchKey[params.matchKey] = meta;
    byAltegioId[params.altegioTransactionId] = meta;
    return meta;
  }

  for (const match of relevantMatches) {
    const clientId = match.clientId ?? clientIdByAltegioId.get(match.altegioTransactionId) ?? null;
    resolveMetaForDeposit({
      matchKey: `deposit|${match.id}`,
      altegioTransactionId: match.altegioTransactionId,
      appointmentAt: match.appointmentAt,
      operationTime: match.operationTime,
      clientId,
    });
  }

  for (const payer of preview.altegio.byPayer) {
    for (const item of payer.items) {
      if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
      if (isCashReconcileAccount(item.accountTitle)) continue;
      if (byAltegioId[item.altegioId]) continue;

      const clientId = clientIdByAltegioId.get(item.altegioId) ?? null;
      const clientRecords = clientId != null ? recordsCache.get(clientId) ?? [] : [];
      const recordDateFromId = recordDateFromRecords(clientRecords, item.recordId);

      const recordAt = resolveDepositRecordAt({
        appointmentAt: null,
        recordDateFromId,
        paymentOperationTime: item.operationTime,
        clientRecords,
      });

      byAltegioId[item.altegioId] = metaFromRecordAt(recordAt, now);
    }
  }

  return { byMatchKey, byAltegioId };
}
