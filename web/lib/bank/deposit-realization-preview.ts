// Серверне збагачення depositRealization для API (не імпортувати з клієнтських компонентів).

import { findNearestRecordAfterPayment } from "@/lib/altegio/deposit-attribution";
import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import { fetchIncomingPaymentsWithDocumentNumbers } from "@/lib/altegio/incoming-payments";
import { getClientRecords, type ClientRecord } from "@/lib/altegio/records";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import type { DepositIncomingMatchRecord } from "@/lib/bank/deposit-incoming-reconcile";
import type { IncomingReconciliationPreview } from "@/lib/bank/incoming-altegio-aggregate";
import { isCashReconcileAccount } from "@/lib/bank/incoming-reconcile-matching";
import {
  classifyDepositRealization,
  type DepositRealizationIndex,
  type DepositRealizationMeta,
} from "@/lib/bank/deposit-realization";

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

function resolveDepositRecordAtServer(sources: {
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

function metaFromRecordAt(recordAt: Date | null, now: Date): DepositRealizationMeta {
  return {
    recordAt: recordAt?.toISOString() ?? null,
    status: classifyDepositRealization(recordAt, now),
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

  if (relevantMatches.some((match) => !match.clientId)) {
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
      console.warn("[deposit-realization-preview] Не вдалося отримати clientId:", error);
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
            console.warn(`[deposit-realization-preview] getClientRecords clientId=${clientId}:`, error);
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

    const recordAt = resolveDepositRecordAtServer({
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

      const recordAt = resolveDepositRecordAtServer({
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
