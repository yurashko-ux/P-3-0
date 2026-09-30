import { prisma } from "@/lib/prisma";
import { altegioFetch } from "@/lib/altegio/client";
import { ALTEGIO_ENV } from "@/lib/altegio/env";
import {
  ALTEGIO_FINANCE_SYNC_START_DATE,
  syncAltegioFinanceTransactions,
} from "@/lib/altegio/finance-transactions-sync";
import { resolveAltegioPaymentPurposeFromRaw } from "@/lib/altegio/payment-purpose-import";
import { isEncashmentPaymentPurpose } from "@/lib/altegio/incoming-payments";
import {
  fetchIncomingPaymentsWithDocumentNumbers,
  type IncomingPaymentWithDocument,
} from "@/lib/altegio/incoming-payments";

export type IncomingBankRowKind = "universal_bank_aggregate" | "named_incoming" | "unknown";

export type NormalizedAltegioIncomeRow = {
  altegioId: number;
  documentId: number | null;
  recordId: number | null;
  /** ID клієнта Altegio — для підстановки імені без documents/records. */
  clientId: number | null;
  accountTitle: string;
  accountId: string | null;
  payerName: string;
  amountKop: bigint;
  paymentPurpose: string | null;
  paymentMethodUnknown: boolean;
  kyivDay: string;
  operationTime: string;
  source: "db" | "live";
};

export type AltegioIncomingItem = {
  altegioId: number;
  documentId: number | null;
  recordId: number | null;
  accountTitle: string;
  amountKop: string;
  operationTime: string;
  paymentPurpose: string | null;
};

export type AltegioPayerAggregate = {
  payerName: string;
  totalKop: string;
  transactionCount: number;
  items: AltegioIncomingItem[];
};

export type IncomingAccountDayGroup<TItem> = {
  accountTitle: string;
  accountId: string | null;
  /** Назва рахунку в Altegio — для звірки з колонкою «Рахунок» у платежах. */
  altegioAccountTitle: string | null;
  totalKop: string;
  items: TItem[];
};

export type IncomingDayGroup<TItem> = {
  kyivDay: string;
  dayLabel: string;
  totalKop: string;
  byAccount: IncomingAccountDayGroup<TItem>[];
};

export type BankIncomingItem = {
  id: string;
  time: string;
  amountKop: string;
  description: string;
  comment: string | null;
  counterName: string | null;
  kind: IncomingBankRowKind;
  commissionKop: string | null;
  commissionRaw: string | null;
};

export type IncomingReconciliationPreview = {
  dateFrom: string;
  dateTo: string;
  altegio: {
    totalKop: string;
    source: "db" | "live" | "mixed";
    byPayer: AltegioPayerAggregate[];
    stats?: {
      liveRows: number;
      dbRows: number;
      mergedRows: number;
      droppedMirrors?: number;
    };
  };
  bank: {
    totalKop: string;
    byDay: IncomingDayGroup<BankIncomingItem>[];
  };
  hints: {
    bankTypicallyNextDay: boolean;
    commissionPercent: number | null;
  };
};

type RawRecord = Record<string, unknown>;

const NO_PAYER_LABEL = "— без платника —";
const UNRESOLVED_ACCOUNT_LABEL = "— рахунок невизначено —";
const NO_ACCOUNT_LABEL = "— без рахунку —";
const PLACEHOLDER_ACCOUNT_TITLES = new Set([UNRESOLVED_ACCOUNT_LABEL, NO_ACCOUNT_LABEL]);

function isPlaceholderAccountTitle(accountTitle: string): boolean {
  return PLACEHOLDER_ACCOUNT_TITLES.has(accountTitle.trim());
}

function payerNamesMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aTokens = a.split(/\s+/).filter((token) => token.length >= 3);
  const bTokens = new Set(b.split(/\s+/).filter((token) => token.length >= 3));
  return aTokens.some((token) => bTokens.has(token));
}

function copyAccountFields(
  target: NormalizedAltegioIncomeRow,
  source: NormalizedAltegioIncomeRow,
): NormalizedAltegioIncomeRow {
  return {
    ...target,
    accountTitle: source.accountTitle,
    accountId: source.accountId,
  };
}

function sumRowsByAccount(
  rows: NormalizedAltegioIncomeRow[],
): Map<string, { accountTitle: string; accountId: string | null; totalKop: bigint }> {
  const byAccount = new Map<string, { accountTitle: string; accountId: string | null; totalKop: bigint }>();
  for (const row of rows) {
    const key = row.accountId || row.accountTitle;
    const existing = byAccount.get(key);
    if (!existing) {
      byAccount.set(key, {
        accountTitle: row.accountTitle,
        accountId: row.accountId,
        totalKop: row.amountKop,
      });
      continue;
    }
    existing.totalKop += row.amountKop;
  }
  return byAccount;
}

/** Підставляє рахунок з інших finance_transactions для рядків без account. */
function enrichPlaceholderAccounts(rows: NormalizedAltegioIncomeRow[]): NormalizedAltegioIncomeRow[] {
  const financeRows = rows.filter((row) => !isPlaceholderAccountTitle(row.accountTitle));
  if (financeRows.length === 0) return rows;

  let enriched = 0;

  const result = rows.map((row) => {
    if (!isPlaceholderAccountTitle(row.accountTitle)) return row;

    const exactPayerMatches = financeRows.filter(
      (financeRow) =>
        financeRow.kyivDay === row.kyivDay
        && financeRow.amountKop === row.amountKop
        && payerNamesMatch(financeRow.payerName, row.payerName),
    );
    if (exactPayerMatches.length === 1) {
      enriched += 1;
      return copyAccountFields(row, exactPayerMatches[0]);
    }

    const exactAmountMatches = financeRows.filter(
      (financeRow) => financeRow.kyivDay === row.kyivDay && financeRow.amountKop === row.amountKop,
    );
    if (exactAmountMatches.length === 1) {
      enriched += 1;
      return copyAccountFields(row, exactAmountMatches[0]);
    }

    const payerDayRows = financeRows.filter(
      (financeRow) =>
        financeRow.kyivDay === row.kyivDay
        && (payerNamesMatch(financeRow.payerName, row.payerName) || financeRow.payerName === NO_PAYER_LABEL),
    );
    const payerDayByAccount = sumRowsByAccount(payerDayRows);
    for (const accountTotal of payerDayByAccount.values()) {
      if (accountTotal.totalKop === row.amountKop) {
        enriched += 1;
        return {
          ...row,
          accountTitle: accountTotal.accountTitle,
          accountId: accountTotal.accountId,
        };
      }
    }

    const dayRows = financeRows.filter((financeRow) => financeRow.kyivDay === row.kyivDay);
    const dayByAccount = sumRowsByAccount(dayRows);
    const matchingAccounts = Array.from(dayByAccount.values()).filter(
      (accountTotal) => accountTotal.totalKop === row.amountKop,
    );
    if (matchingAccounts.length === 1) {
      enriched += 1;
      return {
        ...row,
        accountTitle: matchingAccounts[0].accountTitle,
        accountId: matchingAccounts[0].accountId,
      };
    }

    return row;
  });

  if (enriched > 0) {
    console.log("[incoming-altegio-aggregate] Підставлено рахунки з finance_transactions", {
      enriched,
      total: rows.length,
    });
  }

  return result;
}

type FinanceAccountIndex = {
  rows: NormalizedAltegioIncomeRow[];
  byDocumentId: Map<number, { accountTitle: string; accountId: string | null }>;
};

function buildFinanceAccountIndex(rows: NormalizedAltegioIncomeRow[]): FinanceAccountIndex {
  const financeRows = rows.filter((row) => !isPlaceholderAccountTitle(row.accountTitle));
  const byDocumentId = new Map<number, { accountTitle: string; accountId: string | null }>();

  for (const row of financeRows) {
    if (row.documentId) {
      byDocumentId.set(row.documentId, {
        accountTitle: row.accountTitle,
        accountId: row.accountId,
      });
    }
  }

  return { rows: financeRows, byDocumentId };
}

function resolveAccountForAggregatedPayment(
  index: FinanceAccountIndex,
  payerName: string,
  kyivDay: string,
  amountKop: bigint,
  documentId: number | null,
): { accountTitle: string; accountId: string | null } | null {
  if (documentId && index.byDocumentId.has(documentId)) {
    return index.byDocumentId.get(documentId)!;
  }

  const probe: NormalizedAltegioIncomeRow = {
    altegioId: 0,
    documentId,
    recordId: null,
    clientId: null,
    accountTitle: UNRESOLVED_ACCOUNT_LABEL,
    accountId: null,
    payerName,
    amountKop,
    paymentPurpose: null,
    paymentMethodUnknown: true,
    kyivDay,
    operationTime: `${kyivDay}T12:00:00.000Z`,
    source: "live",
  };
  const [enriched] = enrichPlaceholderAccounts([probe, ...index.rows]);
  if (!isPlaceholderAccountTitle(enriched.accountTitle)) {
    return { accountTitle: enriched.accountTitle, accountId: enriched.accountId };
  }

  return null;
}

function pickAggregatedAccountTitle(
  dayRows: NormalizedAltegioIncomeRow[],
  financeIndex: FinanceAccountIndex | null,
  payerName: string,
  amountKop: bigint,
  documentId: number | null,
): { accountTitle: string; accountId: string | null } {
  const realRows = dayRows.filter((row) => !isPlaceholderAccountTitle(row.accountTitle));
  const realTitles = Array.from(new Set(realRows.map((row) => row.accountTitle)));
  if (realTitles.length === 1) {
    const sample = realRows.find((row) => row.accountTitle === realTitles[0]);
    return { accountTitle: realTitles[0], accountId: sample?.accountId ?? null };
  }
  if (realTitles.length > 1) {
    return { accountTitle: realTitles.join(", "), accountId: null };
  }

  if (financeIndex) {
    const resolved = resolveAccountForAggregatedPayment(
      financeIndex,
      payerName,
      dayRows[0]?.kyivDay || "",
      amountKop,
      documentId,
    );
    if (resolved) return resolved;
  }

  return {
    accountTitle: dayRows[0]?.accountTitle || UNRESOLVED_ACCOUNT_LABEL,
    accountId: dayRows[0]?.accountId ?? null,
  };
}

function normalizeDocumentVerifiedPayment(
  payment: IncomingPaymentWithDocument,
): NormalizedAltegioIncomeRow | null {
  if (
    payment.amount <= 0
    || isEncashmentPaymentPurpose(payment.paymentPurpose)
    || isTransferPurpose(payment.paymentPurpose)
  ) {
    return null;
  }

  const timing = resolveIncomeTiming({ dateText: payment.date || null });
  return {
    altegioId: payment.transactionId,
    documentId: payment.documentId,
    recordId: payment.recordId,
    clientId: payment.clientId ?? null,
    accountTitle: payment.accountTitle || NO_ACCOUNT_LABEL,
    accountId: payment.accountId,
    payerName: payment.payerName || NO_PAYER_LABEL,
    amountKop: BigInt(Math.round(payment.amount * 100)),
    paymentPurpose: payment.paymentPurpose || null,
    paymentMethodUnknown: false,
    kyivDay: timing.kyivDay,
    operationTime: timing.operationTime,
    source: "live",
  };
}

async function fetchDocumentVerifiedIncomeRows(
  dateFrom: string,
  dateTo: string,
): Promise<NormalizedAltegioIncomeRow[]> {
  const payments = await fetchIncomingPaymentsWithDocumentNumbers({
    dateFrom,
    dateTo,
    includeCashboxAccounts: true,
  });

  const rows = payments
    .map(normalizeDocumentVerifiedPayment)
    .filter((row): row is NormalizedAltegioIncomeRow => row != null);

  if (rows.length > 0) {
    console.log("[incoming-altegio-aggregate] GET /transactions + records/documents", {
      dateFrom,
      dateTo,
      rows: rows.length,
    });
  }

  return rows;
}

/** Початок періоду вхідних у розділі «Платежі». */
export const INCOMING_RANGE_START_DATE = "2026-06-10";

function getKyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function kyivDayFromDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseAltegioDateTime(value: unknown): Date {
  const text = cleanText(value);
  if (!text) return new Date(0);

  if (/^\d{8}$/.test(text)) {
    const ymd = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    return new Date(`${ymd}T12:00:00.000+03:00`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T12:00:00.000+03:00`);
  }

  const euMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (euMatch) {
    const day = euMatch[1];
    const month = euMatch[2];
    const yearRaw = euMatch[3];
    const hour = euMatch[4] ?? "12";
    const minute = euMatch[5] ?? "00";
    const second = euMatch[6] ?? "00";
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000+03:00`);
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) {
    const normalized = text.replace(" ", "T");
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
      const kyivAssumed = new Date(`${normalized}+03:00`);
      if (!Number.isNaN(kyivAssumed.getTime())) return kyivAssumed;
    }
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function isValidIncomeKyivDay(kyivDay: string, dateFrom: string, dateTo: string): boolean {
  if (!kyivDay || kyivDay === "1970-01-01") return false;
  return kyivDay >= dateFrom && kyivDay <= dateTo;
}

function resolveIncomeTiming(params: {
  raw?: RawRecord;
  operationDate?: Date;
  kyivDay?: string | null;
  dateText?: string | null;
}): { kyivDay: string; operationTime: string } {
  const date = params.operationDate
    ?? (params.kyivDay ? parseAltegioDateTime(params.kyivDay) : null)
    ?? (params.dateText ? parseAltegioDateTime(params.dateText) : null)
    ?? (params.raw
      ? parseAltegioDateTime(
          params.raw.date
            ?? params.raw.created_at
            ?? params.raw.datetime
            ?? params.raw.operation_date
            ?? params.raw.operationDate,
        )
      : new Date(0));

  return {
    kyivDay: params.kyivDay?.trim() || kyivDayFromDate(date),
    operationTime: date.toISOString(),
  };
}

function formatKyivDayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  if (!year || !month || !day) return kyivDay;
  return `${day}.${month}.${year}`;
}

function accountGroupKey(accountId: string | null, accountTitle: string): string {
  return `${accountId || ""}|${accountTitle}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildDateChunks(dateFrom: string, dateTo: string, chunkDays = 7): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let from = dateFrom;
  while (from <= dateTo) {
    let to = addDaysYmd(from, chunkDays - 1);
    if (to > dateTo) to = dateTo;
    chunks.push({ from, to });
    from = addDaysYmd(to, 1);
  }
  return chunks;
}

/** Altegio GET /transactions очікує дати у форматі YYYYMMDD. */
function toAltegioApiYmdDate(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function resolveCompanyId(): string {
  const fromEnv = process.env.ALTEGIO_COMPANY_ID?.trim();
  const fallback = ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  const companyId = fromEnv || fallback;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID is required for incoming aggregation");
  }
  return companyId;
}

function cleanText(value: unknown): string | null {
  const text = String(value || "").trim();
  return text || null;
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function toMoneyNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function kopToString(value: bigint): string {
  return value.toString();
}

function sumKop(values: bigint[]): bigint {
  return values.reduce((acc, value) => acc + value, 0n);
}

export function kyivDayUtcRange(ymd: string): { from: Date; to: Date } {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const offsetHours = hour - 12;
  const from = new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0, 0, 0));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { from, to };
}

export function parseBankCommission(text: string): { kopiykas: bigint | null; raw: string | null } {
  const match = text.match(/Комісія\s+банку\s+([\d\s]+(?:[,.]\d{1,2})?)\s*грн/i);
  if (!match) return { kopiykas: null, raw: null };
  const amountText = match[1].replace(/\s+/g, "").replace(",", ".");
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return { kopiykas: null, raw: match[0] };
  return { kopiykas: BigInt(Math.round(amount * 100)), raw: match[0] };
}

/** Altegio інколи віддає client як [] або [{...}] замість об'єкта. */
function coerceClientRecord(value: unknown): RawRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const asObj = asRecord(item);
      if (asObj) return asObj;
    }
    return null;
  }
  return asRecord(value);
}

function getClientIdFromRaw(raw: unknown): number | null {
  const record = asRecord(raw);
  if (!record) return null;
  const client = coerceClientRecord(record.client) ?? coerceClientRecord(record.customer);
  const visit = asRecord(record.visit);
  const document = asRecord(record.document);
  const appointment = asRecord(record.appointment);
  const nestedRecord = asRecord(record.record);
  return (
    toInt(record.client_id)
    ?? toInt(record.clientId)
    ?? toInt(client?.id)
    ?? toInt(client?.client_id)
    ?? toInt(nestedRecord?.client_id)
    ?? toInt(asRecord(nestedRecord?.client)?.id)
    ?? toInt(visit?.client_id)
    ?? toInt(asRecord(visit?.client)?.id)
    ?? toInt(document?.client_id)
    ?? toInt(asRecord(document?.client)?.id)
    ?? toInt(appointment?.client_id)
    ?? toInt(asRecord(appointment?.client)?.id)
  );
}

function formatDirectClientName(row: { firstName: string | null; lastName: string | null; instagramUsername: string }): string | null {
  const full = [row.lastName, row.firstName].filter(Boolean).join(" ").trim();
  if (full) return full;
  const nick = row.instagramUsername?.trim();
  return nick || null;
}

async function fetchAltegioClientNamesByIds(clientIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (clientIds.length === 0) return result;

  const companyId = resolveCompanyId();
  const batchSize = 50;
  // Обмежуємо, щоб «Оновити»/«Звести» знову не тонули в Altegio.
  const maxIds = 150;
  const ids = clientIds.slice(0, maxIds);

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    try {
      const response = await altegioFetch<unknown>(`/company/${companyId}/clients/search`, {
        method: "POST",
        body: JSON.stringify({
          filters: [{ field: "id", operation: "in", value: batch }],
          fields: ["id", "name", "display_name", "fullname", "lastname", "first_name", "last_name"],
        }),
      });
      const pageRows = unwrapArray(response);
      for (const raw of pageRows) {
        const id = toInt(raw.id);
        if (!id) continue;
        const name =
          cleanText(raw.name)
          || cleanText(raw.display_name)
          || [cleanText(raw.lastname ?? raw.last_name), cleanText(raw.firstname ?? raw.first_name)]
            .filter(Boolean)
            .join(" ")
            .trim()
          || null;
        if (name) result.set(id, name);
      }
    } catch (error) {
      console.warn("[incoming-altegio-aggregate] clients/search для імен не вдався", {
        batchSize: batch.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/** Підставляє імена з Direct (+ легкий clients/search) — без documents/records. */
async function enrichMissingPayersFromDirectClients(
  rows: NormalizedAltegioIncomeRow[],
): Promise<NormalizedAltegioIncomeRow[]> {
  const missingIds = Array.from(
    new Set(
      rows
        .filter((row) => row.payerName === NO_PAYER_LABEL && row.clientId != null)
        .map((row) => row.clientId as number),
    ),
  );
  if (missingIds.length === 0) return rows;

  const clients = await (prisma as any).directClient.findMany({
    where: { altegioClientId: { in: missingIds } },
    select: { altegioClientId: true, firstName: true, lastName: true, instagramUsername: true },
  });
  const nameByAltegioId = new Map<number, string>();
  for (const client of clients) {
    if (client.altegioClientId == null) continue;
    const name = formatDirectClientName(client);
    if (name) nameByAltegioId.set(client.altegioClientId, name);
  }

  const stillMissing = missingIds.filter((id) => !nameByAltegioId.has(id));
  if (stillMissing.length > 0) {
    const fromAltegio = await fetchAltegioClientNamesByIds(stillMissing);
    for (const [id, name] of fromAltegio) nameByAltegioId.set(id, name);
  }

  if (nameByAltegioId.size === 0) {
    console.log("[incoming-altegio-aggregate] Немає імен для clientId без платника", {
      missingIds: missingIds.length,
    });
    return rows;
  }

  let enriched = 0;
  const next = rows.map((row) => {
    if (row.payerName !== NO_PAYER_LABEL || row.clientId == null) return row;
    const name = nameByAltegioId.get(row.clientId);
    if (!name) return row;
    enriched += 1;
    return { ...row, payerName: name };
  });

  console.log("[incoming-altegio-aggregate] Підставлено імена платників", {
    missingIds: missingIds.length,
    foundInDirect: missingIds.length - stillMissing.length,
    foundInAltegioSearch: nameByAltegioId.size - (missingIds.length - stillMissing.length),
    enrichedRows: enriched,
  });
  return next;
}

/**
 * Легке дотягування імені з record (один path, без storage documents).
 * Лише для рядків «без платника» з recordId — інакше знову 404-шторм.
 */
async function enrichMissingPayersFromRecords(
  rows: NormalizedAltegioIncomeRow[],
): Promise<NormalizedAltegioIncomeRow[]> {
  const missingRecordIds = Array.from(
    new Set(
      rows
        .filter((row) => row.payerName === NO_PAYER_LABEL && row.recordId != null)
        .map((row) => row.recordId as number),
    ),
  ).slice(0, 40);
  if (missingRecordIds.length === 0) return rows;

  const companyId = resolveCompanyId();
  const nameByRecordId = new Map<number, string>();
  const clientIdByRecordId = new Map<number, number>();
  const batchSize = 5;

  // Робочий path у проєкті: /records/{company}/{id}; fallback — company/.../records.
  const recordPaths = (recordId: number) => [
    `/records/${companyId}/${recordId}`,
    `/company/${companyId}/records/${recordId}`,
  ];

  for (let i = 0; i < missingRecordIds.length; i += batchSize) {
    const batch = missingRecordIds.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (recordId) => {
        for (const path of recordPaths(recordId)) {
          try {
            const raw = await altegioFetch<unknown>(path, {}, 1, 150, 5_000);
            const payload = asRecord(raw);
            const data = asRecord(payload?.data) ?? payload;
            if (!data) continue;
            const client = asRecord(data.client) ?? asRecord(asRecord(data.data)?.client);
            const name =
              cleanText(client?.name)
              || cleanText(client?.display_name)
              || cleanText(client?.full_name)
              || cleanText(data.client_name)
              || [cleanText(client?.surname ?? client?.last_name), cleanText(client?.firstname ?? client?.first_name)]
                .filter(Boolean)
                .join(" ")
                .trim()
              || null;
            const clientId = toInt(data.client_id) ?? toInt(client?.id) ?? toInt(client?.client_id);
            if (name) nameByRecordId.set(recordId, name);
            if (clientId) clientIdByRecordId.set(recordId, clientId);
            if (name || clientId) break;
          } catch {
            // records часто 404 — пробуємо наступний path
          }
        }
      }),
    );
  }

  if (nameByRecordId.size === 0 && clientIdByRecordId.size === 0) {
    console.log("[incoming-altegio-aggregate] Records: імен не знайдено", {
      tried: missingRecordIds.length,
    });
    return rows;
  }

  let enriched = 0;
  const next = rows.map((row) => {
    if (row.payerName !== NO_PAYER_LABEL || row.recordId == null) return row;
    const name = nameByRecordId.get(row.recordId);
    const clientId = clientIdByRecordId.get(row.recordId) ?? row.clientId;
    if (!name && clientId === row.clientId) return row;
    enriched += 1;
    return {
      ...row,
      payerName: name || row.payerName,
      clientId,
    };
  });

  console.log("[incoming-altegio-aggregate] Records: підставлено імена", {
    tried: missingRecordIds.length,
    named: nameByRecordId.size,
    enrichedRows: enriched,
  });
  return next;
}

/**
 * Дотягування імені/clientId з GET /finance_transactions/{company}/{id}.
 * Лише для «без платника» без clientId (або все ще без імені) — ліміт, щоб не тонути.
 * Безготівкові рахунки мають пріоритет (вони впливають на зведення з monobank).
 */
async function enrichMissingPayersFromFinanceTransactions(
  rows: NormalizedAltegioIncomeRow[],
): Promise<NormalizedAltegioIncomeRow[]> {
  // Лише безготівка без імені — готівку з monobank не зводимо, не ганяємо зайві Altegio-запити.
  const candidates = rows
    .filter(
      (row) =>
        row.payerName === NO_PAYER_LABEL
        && !isCashAltegioAccountTitle(row.accountTitle),
    )
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay))
    .slice(0, 20);

  if (candidates.length === 0) return rows;

  const companyId = resolveCompanyId();
  const patchById = new Map<number, { payerName?: string; clientId?: number; recordId?: number }>();
  const batchSize = 5;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const raw = await altegioFetch<unknown>(
            `/finance_transactions/${companyId}/${row.altegioId}`,
            {},
            1,
            150,
            5_000,
          );
          const payload = asRecord(raw);
          const data = asRecord(payload?.data) ?? payload;
          if (!data) return;

          const name = getPayerNameFromRaw(data, null);
          const clientId = getClientIdFromRaw(data);
          const recordId =
            toInt(data.record_id)
            ?? toInt(data.recordId)
            ?? toInt(asRecord(data.record)?.id)
            ?? toInt(data.appointment_id)
            ?? null;
          const purpose =
            getSalePurposeText(data)
            || resolveAltegioPaymentPurposeFromRaw(data)
            || null;

          // Якщо клієнта немає (типові «Продаж товарів») — показуємо призначення замість «без платника».
          const fallbackLabel =
            purpose && purpose.trim() && purpose.trim().toLowerCase() !== "надання послуг"
              ? purpose.trim()
              : null;

          if (
            (name && name !== NO_PAYER_LABEL)
            || clientId != null
            || recordId != null
            || fallbackLabel
          ) {
            patchById.set(row.altegioId, {
              payerName:
                (name && name !== NO_PAYER_LABEL ? name : undefined)
                || fallbackLabel
                || undefined,
              clientId: clientId ?? undefined,
              recordId: recordId ?? undefined,
            });
          }
        } catch {
          // 404/timeout — тихо; лишаємо «без платника»
        }
      }),
    );
  }

  if (patchById.size === 0) {
    console.log("[incoming-altegio-aggregate] finance_transactions: імен не знайдено", {
      tried: candidates.length,
    });
    return rows;
  }

  let enriched = 0;
  const next = rows.map((row) => {
    if (row.payerName !== NO_PAYER_LABEL) return row;
    const patch = patchById.get(row.altegioId);
    if (!patch) return row;
    enriched += 1;
    return {
      ...row,
      payerName: patch.payerName || row.payerName,
      clientId: patch.clientId ?? row.clientId,
      recordId: patch.recordId ?? row.recordId,
    };
  });

  console.log("[incoming-altegio-aggregate] finance_transactions: підставлено", {
    tried: candidates.length,
    patched: patchById.size,
    enrichedRows: enriched,
  });
  return next;
}

function getPayerNameFromRaw(raw: unknown, counterpartyName: string | null): string {
  if (counterpartyName) return counterpartyName;
  const record = asRecord(raw);
  if (!record) return NO_PAYER_LABEL;

  const client = coerceClientRecord(record.client) ?? coerceClientRecord(record.customer);
  const payer = asRecord(record.payer) ?? asRecord(record.recipient);
  const visit = asRecord(record.visit);
  const visitClient = coerceClientRecord(visit?.client);
  const document = asRecord(record.document);
  const documentClient = coerceClientRecord(document?.client);
  const candidates = [
    record.client_name,
    record.clientName,
    record.customer_name,
    record.customerName,
    record.payer_name,
    record.payerName,
    record.recipient_name,
    record.recipientName,
    record.counterparty_name,
    record.counterpartyName,
    client?.name,
    client?.title,
    client?.display_name,
    client?.full_name,
    // Прізвище+ім'я з вкладеного client (часто є без name).
    [cleanText(client?.surname ?? client?.last_name), cleanText(client?.firstname ?? client?.first_name)]
      .filter(Boolean)
      .join(" ")
      .trim() || null,
    client?.surname,
    payer?.name,
    payer?.title,
    visitClient?.name,
    visitClient?.title,
    documentClient?.name,
    documentClient?.title,
    asRecord(record.record)?.client_name,
    asRecord(asRecord(record.record)?.client)?.name,
    asRecord(asRecord(record.visit)?.client)?.name,
    asRecord(asRecord(record.visit)?.client)?.title,
    asRecord(asRecord(record.appointment)?.client)?.name,
  ];
  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (text) return text;
  }
  return NO_PAYER_LABEL;
}

function hasExpenseId(raw: RawRecord): boolean {
  return toInt(raw.expense_id ?? raw.expenseId ?? asRecord(raw.expense)?.id) != null;
}

function hasDocumentId(raw: RawRecord): boolean {
  return toInt(
    raw.document_id
      ?? raw.documentId
      ?? raw.doc_id
      ?? raw.sale_id
      ?? raw.storage_operation_id
      ?? asRecord(raw.document)?.id
      ?? asRecord(raw.document)?.document_id
      ?? asRecord(raw.sale)?.id
      ?? asRecord(raw.storage_operation)?.id,
  ) != null;
}

function getSalePurposeText(raw: RawRecord): string | null {
  const fromExpense = resolveAltegioPaymentPurposeFromRaw(raw);
  if (fromExpense) return fromExpense;

  return cleanText(
    raw.payment_purpose
      ?? raw.paymentPurpose
      ?? raw.purpose
      ?? raw.comment
      ?? raw.title
      ?? raw.service_name
      ?? raw.category
      ?? raw.category_title
      ?? raw.operation_type
      ?? raw.operation_type_title
      ?? asRecord(raw.category)?.title
      ?? asRecord(raw.category)?.name
      ?? asRecord(raw.expense)?.title
      ?? asRecord(raw.expense)?.name,
  );
}

function detectDirectionFromRaw(raw: RawRecord, amountKop: bigint): string {
  const type = String(raw.type || "").toLowerCase();
  const typeId = String(raw.type_id || "").toLowerCase();
  if (isTransferPurpose(getSalePurposeText(raw))) return "transfer";

  const expenseTitle = cleanText(asRecord(raw.expense)?.title ?? asRecord(raw.expense)?.name)?.toLowerCase() || "";
  if (expenseTitle.includes("переміщ") || expenseTitle.includes("перевод") || expenseTitle.includes("transfer")) {
    return "transfer";
  }

  const operationType = cleanText(
    raw.operation_type_title
      ?? raw.operation_type
      ?? asRecord(raw.operation_type)?.title
      ?? asRecord(raw.operation_type)?.name,
  )?.toLowerCase() || "";
  if (operationType.includes("переміщ") || operationType.includes("перевод") || operationType.includes("transfer")) {
    return "transfer";
  }

  if (type.includes("transfer") || type.includes("переміщ") || type.includes("перевод")) return "transfer";
  if (type.includes("income") || typeId === "1") return "in";
  // document_id = оплата клієнта/продаж; expense_id у Altegio часто лише «стаття», не витрата.
  if (hasDocumentId(raw)) return "in";
  if (type.includes("expense") || typeId === "2") return "out";
  // Витрата без документа: expense_id без document_id.
  if (hasExpenseId(raw) && !hasDocumentId(raw)) return "out";
  if (amountKop < 0n) return "out";
  if (amountKop > 0n) return "in";
  return "unknown";
}

function isEncashmentRaw(raw: RawRecord): boolean {
  return isEncashmentPaymentPurpose(getSalePurposeText(raw) || "");
}

function collectPaymentTypeTexts(raw: RawRecord): string[] {
  const paymentType = asRecord(raw.payment_type) ?? asRecord(raw.payed_type) ?? asRecord(raw.pay_type);
  const texts = [
    raw.payment_type,
    raw.payment_type_title,
    raw.payed_type,
    raw.pay_type,
    raw.payment_method,
    raw.payment_method_title,
    paymentType?.title,
    paymentType?.name,
    paymentType?.slug,
  ]
    .map((value) => cleanText(value)?.toLowerCase())
    .filter((value): value is string => Boolean(value));

  for (const key of ["payment_methods", "paymentMethods", "payment_method", "paymentMethod"]) {
    const direct = raw[key];
    const methods = Array.isArray(direct) ? direct : direct ? [direct] : [];
    for (const method of methods) {
      const record = asRecord(method);
      if (!record) continue;
      for (const field of [record.title, record.name, record.slug, record.type]) {
        const text = cleanText(field)?.toLowerCase();
        if (text) texts.push(text);
      }
    }
  }

  return texts;
}

function hasPaymentTypeHint(raw: RawRecord): boolean {
  return collectPaymentTypeTexts(raw).length > 0;
}

function getAccountInfoFromRaw(raw: RawRecord): { accountTitle: string; accountId: string | null } {
  const accountRecord =
    asRecord(raw.account) ??
    asRecord(raw.cashbox) ??
    asRecord(raw.cash_box) ??
    asRecord(raw.cash_desk) ??
    asRecord(raw.storage);
  const accountTitle =
    cleanText(
      accountRecord?.title ??
        accountRecord?.name ??
        raw.account_title ??
        raw.cashbox_title ??
        raw.cash_box_title ??
        raw.cash_desk_title,
    ) || "— без рахунку —";
  const accountId = toInt(
    raw.account_id ??
      raw.cashbox_id ??
      raw.cash_box_id ??
      raw.cash_desk_id ??
      accountRecord?.id,
  );
  return {
    accountTitle,
    accountId: accountId != null ? String(accountId) : null,
  };
}

function isAltegioPaymentRow(raw: RawRecord, amountKop: bigint): boolean {
  if (amountKop <= 0n) return false;
  // Не відсікати expense_id: у вхідних оплатах клієнтів це стаття прибутку.
  // Інакше skipDocumentEnrichment дає liveRows=0 (усі транзакції зникають).
  if (isEncashmentRaw(raw)) return false;

  const direction = detectDirectionFromRaw(raw, amountKop);
  if (direction === "out" || direction === "transfer") return false;

  return true;
}

function normalizeIncomeRow(raw: RawRecord, source: "db" | "live"): NormalizedAltegioIncomeRow | null {
  const altegioId = toInt(raw.id ?? raw.transaction_id ?? raw.finance_transaction_id);
  if (!altegioId) return null;

  const amountKop = BigInt(
    Math.round(Math.abs(toMoneyNumber(raw.amount ?? raw.sum ?? raw.paid_sum ?? raw.cost)) * 100),
  );
  if (!isAltegioPaymentRow(raw, amountKop)) return null;

  const { accountTitle, accountId } = getAccountInfoFromRaw(raw);
  const clientRecord = asRecord(raw.client) ?? asRecord(raw.customer);
  const counterpartyName = cleanText(
    clientRecord?.name ??
      clientRecord?.title ??
      clientRecord?.display_name ??
      clientRecord?.full_name ??
      raw.client_name ??
      raw.clientName ??
      raw.customer_name ??
      raw.counterparty_name ??
      raw.counterpartyName,
  );
  const timing = resolveIncomeTiming({ raw });

  return {
    altegioId,
    documentId: toInt(raw.document_id ?? raw.documentId ?? asRecord(raw.document)?.id),
    recordId: toInt(
      raw.record_id
        ?? raw.recordId
        ?? asRecord(raw.record)?.id
        ?? raw.appointment_id
        ?? asRecord(raw.appointment)?.id,
    ),
    clientId: getClientIdFromRaw(raw),
    accountTitle,
    accountId,
    payerName: getPayerNameFromRaw(raw, counterpartyName),
    amountKop,
    paymentPurpose: getSalePurposeText(raw),
    paymentMethodUnknown: !hasPaymentTypeHint(raw),
    kyivDay: timing.kyivDay,
    operationTime: timing.operationTime,
    source,
  };
}

function normalizeDbRow(row: {
  altegioId: number;
  documentId: number | null;
  accountTitle: string | null;
  accountId: string | null;
  counterpartyName: string | null;
  amountKopiykas: bigint;
  paymentPurpose: string | null;
  direction: string;
  expenseId: number | null;
  operationDate: Date;
  kyivDay: string;
  rawData: unknown;
}): NormalizedAltegioIncomeRow | null {
  const rawRecord = asRecord(row.rawData) ?? {};
  const timing = resolveIncomeTiming({
    raw: rawRecord,
    operationDate: row.operationDate,
    kyivDay: row.kyivDay,
  });
  const fromRaw = normalizeIncomeRow(rawRecord, "db");

  if (fromRaw) {
    return {
      ...fromRaw,
      altegioId: row.altegioId,
      clientId: fromRaw.clientId ?? getClientIdFromRaw(row.rawData),
      accountTitle: row.accountTitle?.trim() || fromRaw.accountTitle,
      accountId: row.accountId ?? fromRaw.accountId,
      payerName:
        fromRaw.payerName !== NO_PAYER_LABEL
          ? fromRaw.payerName
          : getPayerNameFromRaw(row.rawData, row.counterpartyName),
      paymentPurpose: row.paymentPurpose ?? fromRaw.paymentPurpose ?? resolveAltegioPaymentPurposeFromRaw(rawRecord),
      kyivDay: timing.kyivDay,
      operationTime: timing.operationTime,
      source: "db",
    };
  }

  const amountKop = row.amountKopiykas < 0n ? -row.amountKopiykas : row.amountKopiykas;
  if (amountKop <= 0n || row.expenseId) return null;
  if (row.direction === "out" || row.direction === "transfer") return null;
  if (isTransferPurpose(row.paymentPurpose)) return null;

  const accountTitle = row.accountTitle?.trim() || "— без рахунку —";

  return {
    altegioId: row.altegioId,
    documentId: row.documentId,
    recordId: toInt(
      rawRecord.record_id
        ?? rawRecord.recordId
        ?? asRecord(rawRecord.record)?.id
        ?? rawRecord.appointment_id,
    ),
    clientId: getClientIdFromRaw(row.rawData),
    accountTitle,
    accountId: row.accountId,
    payerName: getPayerNameFromRaw(row.rawData, row.counterpartyName),
    amountKop,
    paymentPurpose: row.paymentPurpose ?? resolveAltegioPaymentPurposeFromRaw(rawRecord),
    paymentMethodUnknown: !hasPaymentTypeHint(rawRecord),
    kyivDay: timing.kyivDay,
    operationTime: timing.operationTime,
    source: "db",
  };
}

function unwrapArray(raw: unknown): RawRecord[] {
  if (Array.isArray(raw)) return raw.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
  const payload = asRecord(raw);
  if (!payload) return [];
  for (const key of ["data", "transactions", "items", "records"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
    }
    const nested = asRecord(value);
    if (nested) {
      for (const nestedKey of ["data", "items", "transactions"]) {
        const nestedValue = nested[nestedKey];
        if (Array.isArray(nestedValue)) {
          return nestedValue.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null);
        }
      }
    }
  }
  return [];
}

function incomeRowKey(row: NormalizedAltegioIncomeRow): string {
  return `${row.altegioId}|${row.accountId || ""}|${row.kyivDay}|${row.amountKop.toString()}`;
}

function upsertIncomeRow(
  byId: Map<string, NormalizedAltegioIncomeRow>,
  candidate: NormalizedAltegioIncomeRow | null,
): void {
  if (!candidate) return;
  const key = incomeRowKey(candidate);
  const existing = byId.get(key);
  if (!existing) {
    byId.set(key, candidate);
    return;
  }
  // Live без імені не повинен затирати БД з платником (після skipDocumentEnrichment).
  const liveImprovesPayer =
    existing.payerName === NO_PAYER_LABEL && candidate.payerName !== NO_PAYER_LABEL;
  const liveImprovesMethod =
    existing.paymentMethodUnknown
    && !candidate.paymentMethodUnknown
    && !(existing.payerName !== NO_PAYER_LABEL && candidate.payerName === NO_PAYER_LABEL);
  const liveNewerSameOrBetter =
    existing.source === "db"
    && candidate.source === "live"
    && (candidate.payerName !== NO_PAYER_LABEL || existing.payerName === NO_PAYER_LABEL);
  const preferCandidate = liveImprovesPayer || liveImprovesMethod || liveNewerSameOrBetter;
  if (preferCandidate) {
    const keepExistingAccount =
      isPlaceholderAccountTitle(candidate.accountTitle) && !isPlaceholderAccountTitle(existing.accountTitle);
    byId.set(key, {
      ...existing,
      ...candidate,
      clientId: candidate.clientId ?? existing.clientId,
      payerName: candidate.payerName !== NO_PAYER_LABEL ? candidate.payerName : existing.payerName,
      accountTitle: keepExistingAccount ? existing.accountTitle : candidate.accountTitle,
      accountId: keepExistingAccount ? existing.accountId : (candidate.accountId ?? existing.accountId),
      paymentPurpose: candidate.paymentPurpose ?? existing.paymentPurpose,
      source: existing.source === "db" && candidate.source === "live" ? "live" : existing.source,
    });
    return;
  }

  // Live «без платника» поверх БД з іменем — лише доповнюємо clientId/рахунок, ім'я лишаємо.
  if (existing.source === "db" && candidate.source === "live") {
    byId.set(key, {
      ...existing,
      clientId: existing.clientId ?? candidate.clientId,
      accountTitle:
        isPlaceholderAccountTitle(existing.accountTitle) && !isPlaceholderAccountTitle(candidate.accountTitle)
          ? candidate.accountTitle
          : existing.accountTitle,
      accountId: existing.accountId ?? candidate.accountId,
      paymentPurpose: existing.paymentPurpose ?? candidate.paymentPurpose,
    });
    return;
  }

  if (candidate.paymentPurpose && !existing.paymentPurpose) {
    byId.set(key, { ...existing, paymentPurpose: candidate.paymentPurpose });
  }
}

function isTransferPurpose(purpose: string | null): boolean {
  const text = (purpose || "").toLowerCase();
  return (
    text.includes("переміщ")
    || text.includes("перевод")
    || text.includes("transfer")
    || text.includes("інкас")
  );
}

function isTransferIncomeRow(row: NormalizedAltegioIncomeRow): boolean {
  return isTransferPurpose(row.paymentPurpose);
}

/** Прибирає переміщення між рахунками — у вхідні не потрапляють. */
function excludeTransferIncomeRows(rows: NormalizedAltegioIncomeRow[]): {
  rows: NormalizedAltegioIncomeRow[];
  dropped: number;
} {
  const filtered = rows.filter((row) => !isTransferIncomeRow(row));
  const dropped = rows.length - filtered.length;
  if (dropped > 0) {
    console.log("[incoming-altegio-aggregate] Прибрано переміщення", {
      before: rows.length,
      after: filtered.length,
      dropped,
    });
  }
  return { rows: filtered, dropped };
}

function operationMinuteKey(operationTime: string): string {
  return operationTime.slice(0, 16);
}

/** Прибирає дзеркальні переміщення між рахунками (Каса↔ФОП з однаковою сумою і часом). */
function dropMirroredInternalTransfers(rows: NormalizedAltegioIncomeRow[]): {
  rows: NormalizedAltegioIncomeRow[];
  dropped: number;
} {
  const dropKeys = new Set<string>();

  for (const row of rows) {
    if (row.documentId) continue;
    if (row.payerName !== NO_PAYER_LABEL) continue;

    const minuteKey = operationMinuteKey(row.operationTime);
    const mirrors = rows.filter(
      (other) =>
        other.altegioId !== row.altegioId
        && !other.documentId
        && other.payerName === NO_PAYER_LABEL
        && other.kyivDay === row.kyivDay
        && other.amountKop === row.amountKop
        && operationMinuteKey(other.operationTime) === minuteKey
        && other.accountId !== row.accountId,
    );
    if (mirrors.length > 0) {
      dropKeys.add(incomeRowKey(row));
      for (const mirror of mirrors) dropKeys.add(incomeRowKey(mirror));
    }
  }

  if (dropKeys.size === 0) return { rows, dropped: 0 };

  const filtered = rows.filter((row) => !dropKeys.has(incomeRowKey(row)));
  console.log("[incoming-altegio-aggregate] Прибрано дзеркальні переміщення", {
    before: rows.length,
    after: filtered.length,
    dropped: dropKeys.size,
  });
  return { rows: filtered, dropped: dropKeys.size };
}

function isVerifiedClientPaymentRow(row: NormalizedAltegioIncomeRow): boolean {
  // Без documents/records ім'я часто порожнє, але client_id/record_id є — такі рядки раніше зникали з UI.
  return (
    row.documentId != null
    || row.recordId != null
    || row.clientId != null
    || row.payerName !== NO_PAYER_LABEL
  );
}

async function fetchTransactionsApiIncomeRows(dateFrom: string, dateTo: string): Promise<NormalizedAltegioIncomeRow[]> {
  const companyId = resolveCompanyId();
  const count = 1000;
  const maxPages = 30;
  const byId = new Map<string, NormalizedAltegioIncomeRow>();

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({
        start_date: toAltegioApiYmdDate(dateFrom),
        end_date: toAltegioApiYmdDate(dateTo),
        balance_is: "1",
        deleted: "0",
        count: String(count),
        page: String(page),
      });
      const raw = await altegioFetch<unknown>(`/transactions/${companyId}?${params.toString()}`);
      const pageRows = unwrapArray(raw);
      let normalized = 0;
      for (const pageRow of pageRows) {
        const row = normalizeIncomeRow(pageRow, "live");
        if (row) normalized += 1;
        upsertIncomeRow(byId, row);
      }
      console.log("[incoming-altegio-aggregate] GET /transactions page", {
        dateFrom,
        dateTo,
        page,
        rawRows: pageRows.length,
        normalized,
        kept: byId.size,
      });
      if (pageRows.length < count) break;
    }

    const allNormalized = Array.from(byId.values());
    const rows = allNormalized.filter(isVerifiedClientPaymentRow);
    console.log("[incoming-altegio-aggregate] GET /transactions", {
      dateFrom,
      dateTo,
      dateFormat: "YYYYMMDD",
      normalized: allNormalized.length,
      verified: rows.length,
      droppedUnverified: allNormalized.length - rows.length,
    });
    return rows;
  } catch (error) {
    console.warn("[incoming-altegio-aggregate] GET /transactions не вдався", {
      dateFrom,
      dateTo,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fetchLiveIncomeRowsRange(
  dateFrom: string,
  dateTo: string,
  options?: { skipDocumentEnrichment?: boolean },
): Promise<{
  rows: NormalizedAltegioIncomeRow[];
  droppedMirrors: number;
}> {
  const byId = new Map<string, NormalizedAltegioIncomeRow>();
  const chunks = buildDateChunks(dateFrom, dateTo, 7);
  // Паралельно по кілька тижнів — інакше «Звести»/GET б’ють 120s на всьому періоді з червня.
  const concurrency = 3;
  // documents/records дають сотні 404 і з’їдають весь timeout кнопки «Звести».
  // Для UI/зведення достатньо GET /transactions (+ БД); document-enrich — лише повний режим.
  const skipDocumentEnrichment = options?.skipDocumentEnrichment === true;

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchRows = await Promise.all(
      batch.map(async (chunk) => {
        const collected: NormalizedAltegioIncomeRow[] = [];
        try {
          const transactionRows = await fetchTransactionsApiIncomeRows(chunk.from, chunk.to);
          collected.push(...transactionRows);
        } catch (error) {
          console.warn("[incoming-altegio-aggregate] GET /transactions chunk не вдався", {
            dateFrom: chunk.from,
            dateTo: chunk.to,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (!skipDocumentEnrichment) {
          try {
            const documentRows = await fetchDocumentVerifiedIncomeRows(chunk.from, chunk.to);
            collected.push(...documentRows);
          } catch (error) {
            console.warn("[incoming-altegio-aggregate] transactions+records chunk не вдався", {
              dateFrom: chunk.from,
              dateTo: chunk.to,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return collected;
      }),
    );

    for (const rows of batchRows) {
      for (const row of rows) upsertIncomeRow(byId, row);
    }
  }

  const validRows = Array.from(byId.values()).filter((row) => isValidIncomeKyivDay(row.kyivDay, dateFrom, dateTo));
  const { rows: withoutTransfers, dropped: droppedTransfers } = excludeTransferIncomeRows(validRows);
  const { rows, dropped: droppedMirrors } = dropMirroredInternalTransfers(withoutTransfers);

  console.log("[incoming-altegio-aggregate] Live fetch сумарно", {
    dateFrom,
    dateTo,
    chunks: chunks.length,
    concurrency,
    skipDocumentEnrichment,
    rows: rows.length,
    droppedInvalidDates: byId.size - validRows.length,
    droppedTransfers,
    droppedMirrors,
  });

  return { rows, droppedMirrors: droppedTransfers + droppedMirrors };
}

async function fetchDbIncomeRowsRange(dateFrom: string, dateTo: string): Promise<NormalizedAltegioIncomeRow[]> {
  const companyId = resolveCompanyId();
  // expense_id у Altegio ≠ витрата: оплати клієнтів часто мають статтю + document_id.
  const dbRows = await (prisma as any).altegioFinanceTransaction.findMany({
    where: {
      companyId,
      kyivDay: { gte: dateFrom, lte: dateTo },
      deletedInAltegio: false,
      amountKopiykas: { gt: 0 },
      direction: { notIn: ["out", "transfer"] },
      OR: [{ expenseId: null }, { documentId: { not: null } }],
    },
    select: {
      altegioId: true,
      documentId: true,
      accountTitle: true,
      accountId: true,
      counterpartyName: true,
      amountKopiykas: true,
      paymentPurpose: true,
      direction: true,
      expenseId: true,
      operationDate: true,
      kyivDay: true,
      rawData: true,
    },
    orderBy: [{ operationDate: "desc" }],
  });

  const normalized: NormalizedAltegioIncomeRow[] = [];
  for (const row of dbRows) {
    const item = normalizeDbRow(row);
    if (item && isValidIncomeKyivDay(item.kyivDay, dateFrom, dateTo)) normalized.push(item);
  }
  return normalized;
}

function detectIncomeSource(rows: NormalizedAltegioIncomeRow[]): "db" | "live" | "mixed" {
  let sawDb = false;
  let sawLive = false;
  for (const row of rows) {
    if (row.source === "db") sawDb = true;
    if (row.source === "live") sawLive = true;
  }
  if (sawDb && sawLive) return "mixed";
  if (sawLive) return "live";
  return "db";
}

function groupIncomeRowsByDayAndAccount<TItem, TRow extends {
  kyivDay: string;
  operationTime: string;
  accountId: string | null;
  accountTitle: string;
  altegioAccountTitle?: string | null;
}>(
  rows: TRow[],
  toItem: (row: TRow) => TItem,
  sumRowKop: (row: TRow) => bigint,
): IncomingDayGroup<TItem>[] {
  const sorted = [...rows].sort((a, b) => b.operationTime.localeCompare(a.operationTime));
  const dayMap = new Map<string, Map<string, TRow[]>>();
  const dayOrder: string[] = [];

  for (const row of sorted) {
    if (!dayMap.has(row.kyivDay)) {
      dayMap.set(row.kyivDay, new Map());
      dayOrder.push(row.kyivDay);
    }
    const accountKey = accountGroupKey(row.accountId, row.accountTitle);
    const accountMap = dayMap.get(row.kyivDay)!;
    if (!accountMap.has(accountKey)) accountMap.set(accountKey, []);
    accountMap.get(accountKey)!.push(row);
  }

  return dayOrder.map((kyivDay) => {
    const accountMap = dayMap.get(kyivDay)!;
    const byAccount: IncomingAccountDayGroup<TItem>[] = [];
    let dayTotal = 0n;

    for (const accountRows of accountMap.values()) {
      const sample = accountRows[0];
      const accountTotal = sumKop(accountRows.map(sumRowKop));
      dayTotal += accountTotal;
      byAccount.push({
        accountTitle: sample.accountTitle,
        accountId: sample.accountId,
        altegioAccountTitle: sample.altegioAccountTitle ?? null,
        totalKop: kopToString(accountTotal),
        items: accountRows.map(toItem),
      });
    }

    return {
      kyivDay,
      dayLabel: formatKyivDayLabel(kyivDay),
      totalKop: kopToString(dayTotal),
      byAccount,
    };
  });
}

function isCashAltegioAccountTitle(accountTitle: string): boolean {
  const normalized = accountTitle.trim().toLowerCase();
  if (normalized === "каса" || normalized.startsWith("каса ")) return true;
  if (normalized.includes("долар") || normalized.includes("dollar")) return true;
  if (normalized.includes("євро") || normalized.includes("евро") || normalized.includes("euro")) return true;
  return false;
}

function payerDayAccountBucketKey(row: NormalizedAltegioIncomeRow): string {
  const dayKey = row.kyivDay || kyivDayFromDate(new Date(row.operationTime));
  const base = `${dayKey}|${accountGroupKey(row.accountId, row.accountTitle)}`;
  // «Без платника» не зливаємо в один рядок — інакше губимо окремі суми для
  // еквайринг-підмножин і індивідуальні recordId/clientId для дотягування імені.
  if (row.payerName === NO_PAYER_LABEL) {
    return `${base}|nopayer:${row.altegioId}`;
  }
  return base;
}

/** Один рядок на клієнта + день + рахунок (різні рахунки — окремі рядки). */
function aggregatePayerRowsByKyivDay(
  rows: NormalizedAltegioIncomeRow[],
  financeIndex: FinanceAccountIndex | null = null,
  payerName = NO_PAYER_LABEL,
): AltegioIncomingItem[] {
  const bucketMap = new Map<string, NormalizedAltegioIncomeRow[]>();

  for (const row of rows) {
    const bucketKey = payerDayAccountBucketKey(row);
    if (!bucketMap.has(bucketKey)) bucketMap.set(bucketKey, []);
    bucketMap.get(bucketKey)!.push(row);
  }

  const aggregated: AltegioIncomingItem[] = [];

  for (const bucketRows of bucketMap.values()) {
    bucketRows.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
    const amountKop = sumKop(bucketRows.map((row) => row.amountKop));
    const documentId = bucketRows.length === 1 ? bucketRows[0].documentId : bucketRows[0]?.documentId ?? null;
    const { accountTitle } = pickAggregatedAccountTitle(
      bucketRows,
      financeIndex,
      payerName,
      amountKop,
      documentId,
    );

    aggregated.push({
      altegioId: bucketRows[0].altegioId,
      documentId: bucketRows.length === 1 ? bucketRows[0].documentId : null,
      recordId: bucketRows.length === 1 ? bucketRows[0].recordId : bucketRows[0]?.recordId ?? null,
      accountTitle,
      amountKop: kopToString(amountKop),
      operationTime: bucketRows[0].operationTime,
      paymentPurpose:
        bucketRows.length > 1
          ? `${bucketRows.length} оплат за день`
          : bucketRows[0].paymentPurpose,
    });
  }

  aggregated.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
  return aggregated;
}

export function groupAltegioIncomeByPayer(
  rows: NormalizedAltegioIncomeRow[],
  financeIndex: FinanceAccountIndex | null = null,
): AltegioPayerAggregate[] {
  const payerMap = new Map<string, NormalizedAltegioIncomeRow[]>();

  for (const row of rows) {
    const payerKey = row.payerName.trim().toLowerCase() || NO_PAYER_LABEL.toLowerCase();
    if (!payerMap.has(payerKey)) payerMap.set(payerKey, []);
    payerMap.get(payerKey)!.push(row);
  }

  const byPayer: AltegioPayerAggregate[] = [];

  for (const payerRows of payerMap.values()) {
    payerRows.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
    const payerName = payerRows[0]?.payerName || NO_PAYER_LABEL;
    const items = aggregatePayerRowsByKyivDay(payerRows, financeIndex, payerName);
    const totalKop = sumKop(items.map((item) => BigInt(item.amountKop)));
    byPayer.push({
      payerName,
      totalKop: kopToString(totalKop),
      transactionCount: items.length,
      items,
    });
  }

  byPayer.sort((a, b) => {
    const aNoPayer = a.payerName === NO_PAYER_LABEL;
    const bNoPayer = b.payerName === NO_PAYER_LABEL;
    if (aNoPayer !== bNoPayer) return aNoPayer ? 1 : -1;

    const latestA = a.items[0]?.operationTime || "";
    const latestB = b.items[0]?.operationTime || "";
    const timeDiff = latestB.localeCompare(latestA);
    if (timeDiff !== 0) return timeDiff;

    return a.payerName.localeCompare(b.payerName, "uk");
  });

  return byPayer;
}

type BankIncomingTimedRow = BankIncomingItem & {
  kyivDay: string;
  operationTime: string;
  accountId: string;
  accountTitle: string;
  altegioAccountTitle: string | null;
};

function groupBankIncomeByDay(rows: BankIncomingTimedRow[]): IncomingDayGroup<BankIncomingItem>[] {
  return groupIncomeRowsByDayAndAccount(
    rows,
    (row) => ({
      id: row.id,
      time: row.time,
      amountKop: row.amountKop,
      description: row.description,
      comment: row.comment,
      counterName: row.counterName,
      kind: row.kind,
      commissionKop: row.commissionKop,
      commissionRaw: row.commissionRaw,
    }),
    (row) => BigInt(row.amountKop),
  );
}

export function classifyIncomingBankRow(params: {
  description: string;
  comment: string | null;
  counterName: string | null;
}): IncomingBankRowKind {
  const text = `${params.description} ${params.comment || ""} ${params.counterName || ""}`.toLowerCase();
  if (
    (text.includes("універсал") || text.includes("universal")) &&
    (text.includes("покриття") || text.includes("транзакц") || text.includes("еквайр"))
  ) {
    return "universal_bank_aggregate";
  }
  if (/від:\s*[\p{L}'\s.-]{3,}/iu.test(text) || (params.counterName && !params.counterName.toLowerCase().includes("банк"))) {
    return "named_incoming";
  }
  return "unknown";
}

function bankAccountLabel(account: {
  id: string;
  altegioAccountTitle: string | null;
  maskedPan: string | null;
  iban: string | null;
  connection?: { clientName: string | null; name: string | null } | null;
}): string {
  const last4 = (account.maskedPan || account.iban || "").replace(/\s+/g, "").slice(-4);
  const fop = account.connection?.clientName || account.connection?.name || account.altegioAccountTitle || "Рахунок";
  return last4 ? `${fop} (${last4})` : fop;
}

async function fetchBankIncomingByDayRange(dateFrom: string, dateTo: string): Promise<{
  byDay: IncomingDayGroup<BankIncomingItem>[];
  totalKop: bigint;
}> {
  const { from } = kyivDayUtcRange(dateFrom);
  const { to } = kyivDayUtcRange(dateTo);
  const statements = await prisma.bankStatementItem.findMany({
    where: {
      time: { gte: from, lte: to },
      amount: { gt: 0n },
      account: { includeInOperationsTable: true },
    },
    include: {
      account: {
        select: {
          id: true,
          altegioAccountTitle: true,
          maskedPan: true,
          iban: true,
          connection: { select: { clientName: true, name: true } },
        },
      },
    },
    orderBy: [{ time: "desc" }],
  });

  const timedRows: BankIncomingTimedRow[] = [];
  let totalKop = 0n;

  for (const statement of statements) {
    const accountLabel = bankAccountLabel(statement.account);
    const text = `${statement.description || ""} ${statement.comment || ""}`;
    const commission = parseBankCommission(text);
    const operationTime = statement.time.toISOString();
    const amountKop = statement.amount.toString();
    totalKop += statement.amount;
    timedRows.push({
      id: statement.id,
      time: operationTime,
      amountKop,
      description: statement.description,
      comment: statement.comment,
      counterName: statement.counterName,
      kind: classifyIncomingBankRow({
        description: statement.description,
        comment: statement.comment,
        counterName: statement.counterName,
      }),
      commissionKop: commission.kopiykas != null ? commission.kopiykas.toString() : null,
      commissionRaw: commission.raw,
      kyivDay: kyivDayFromDate(statement.time),
      operationTime,
      accountId: statement.account.id,
      accountTitle: accountLabel,
      altegioAccountTitle: statement.account.altegioAccountTitle,
    });
  }

  return {
    byDay: groupBankIncomeByDay(timedRows),
    totalKop,
  };
}

function mergeIncomeRows(liveRows: NormalizedAltegioIncomeRow[], dbRows: NormalizedAltegioIncomeRow[]): NormalizedAltegioIncomeRow[] {
  const byId = new Map<string, NormalizedAltegioIncomeRow>();
  for (const row of dbRows) byId.set(incomeRowKey(row), row);
  for (const row of liveRows) upsertIncomeRow(byId, row);
  return Array.from(byId.values());
}

export async function buildIncomingReconciliationPreview(options?: {
  /**
   * Скільки останніх днів тягнути live з Altegio.
   * Решта періоду — з БД (швидкий GET «Оновити»).
   * Без опції / 0 — live на весь період (повільніше).
   */
  liveLookbackDays?: number;
  /**
   * Не тягнути documents/records по кожній транзакції (сотні 404 у Vercel).
   * Для GET/«Звести» — true: лише /transactions + БД.
   */
  skipDocumentEnrichment?: boolean;
}): Promise<IncomingReconciliationPreview> {
  const dateFrom = INCOMING_RANGE_START_DATE;
  const dateTo = getKyivTodayYmd();
  const liveLookbackDays =
    typeof options?.liveLookbackDays === "number" && options.liveLookbackDays > 0
      ? Math.floor(options.liveLookbackDays)
      : null;
  const liveFrom = liveLookbackDays
    ? addDaysYmd(dateTo, -(liveLookbackDays - 1))
    : dateFrom;
  const effectiveLiveFrom = liveFrom < dateFrom ? dateFrom : liveFrom;
  const skipDocumentEnrichment = options?.skipDocumentEnrichment !== false;

  const [liveFetch, dbRows, bankAgg] = await Promise.all([
    fetchLiveIncomeRowsRange(effectiveLiveFrom, dateTo, { skipDocumentEnrichment }),
    fetchDbIncomeRowsRange(dateFrom, dateTo),
    fetchBankIncomingByDayRange(dateFrom, dateTo),
  ]);
  const liveRows = liveFetch.rows;
  // Завжди мержимо з БД: частковий live більше не «з’їдає» історію і не дає порожній екран.
  const mergedRows = mergeIncomeRows(liveRows, dbRows);
  const withDirectPayers = await enrichMissingPayersFromDirectClients(mergedRows);
  const withRecords = await enrichMissingPayersFromRecords(withDirectPayers);
  // Окремі транзакції без clientId/імені — легкий GET по id (пріоритет безготівки).
  const withFinanceDetails = await enrichMissingPayersFromFinanceTransactions(withRecords);
  // Після records/finance_transactions могли з’явитись нові clientId — ще раз Direct/search.
  const withPayersFinal = await enrichMissingPayersFromDirectClients(withFinanceDetails);
  // Якщо клієнта так і немає — показуємо призначення («Продаж товарів»), а не «без платника».
  const withPurposeFallback = withPayersFinal.map((row) => {
    if (row.payerName !== NO_PAYER_LABEL) return row;
    const purpose = row.paymentPurpose?.trim() || "";
    if (!purpose) return row;
    if (purpose.toLowerCase() === "надання послуг") return row;
    if (/^\d+\s+оплат/i.test(purpose)) return row;
    return { ...row, payerName: purpose };
  });

  const incomeRows = enrichPlaceholderAccounts(
    excludeTransferIncomeRows(
      withPurposeFallback.filter((row) =>
        isValidIncomeKyivDay(row.kyivDay, dateFrom, dateTo),
      ),
    ).rows,
  );
  const financeIndex = buildFinanceAccountIndex(incomeRows);
  const altegioByPayer = groupAltegioIncomeByPayer(incomeRows, financeIndex);
  const altegioTotalKop = sumKop(incomeRows.map((row) => row.amountKop));
  const altegioSource = detectIncomeSource(incomeRows);

  const commissionPercentRaw = process.env.ALTEGIO_ACQUIRING_COMMISSION_PERCENT?.trim();
  const commissionPercent = commissionPercentRaw ? Number(commissionPercentRaw) : null;

  console.log("[incoming-altegio-aggregate] Preview", {
    dateFrom,
    dateTo,
    liveFrom: effectiveLiveFrom,
    liveLookbackDays,
    skipDocumentEnrichment,
    liveRows: liveRows.length,
    dbRows: dbRows.length,
    mergedRows: incomeRows.length,
    altegioPayers: altegioByPayer.length,
    bankDays: bankAgg.byDay.length,
    source: altegioSource,
    syncStartDate: ALTEGIO_FINANCE_SYNC_START_DATE,
  });

  return {
    dateFrom,
    dateTo,
    altegio: {
      totalKop: kopToString(altegioTotalKop),
      source: altegioSource,
      byPayer: altegioByPayer,
      stats: {
        liveRows: liveRows.length,
        dbRows: dbRows.length,
        mergedRows: incomeRows.length,
        droppedMirrors: liveFetch.droppedMirrors,
      },
    },
    bank: {
      totalKop: kopToString(bankAgg.totalKop),
      byDay: bankAgg.byDay,
    },
    hints: {
      bankTypicallyNextDay: true,
      commissionPercent: Number.isFinite(commissionPercent) ? commissionPercent : null,
    },
  };
}

export type RefreshIncomingAltegioDayResult = {
  kyivDay: string;
  syncedFromSearch: number;
  liveRows: number;
  dbRowsBeforeEnrich: number;
  upsertedToDb: number;
  withPayerName: number;
  withoutPayerName: number;
};

/**
 * Підтягнути вхідні Altegio лише за один календарний день (Europe/Kyiv):
 * finance search → БД, live /transactions + documents/records, enrich імен, upsert у БД.
 * Для кнопки «Підтягнути» біля дати в «Не зведені» — без повного періоду й timeout.
 */
export async function refreshIncomingAltegioForKyivDay(
  kyivDay: string,
): Promise<RefreshIncomingAltegioDayResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kyivDay)) {
    throw new Error("Невірний формат дати (очікується YYYY-MM-DD)");
  }
  const today = getKyivTodayYmd();
  if (kyivDay < INCOMING_RANGE_START_DATE || kyivDay > today) {
    throw new Error(`Дата поза періодом вхідних (${INCOMING_RANGE_START_DATE}…${today})`);
  }

  const companyId = resolveCompanyId();
  const startedAt = Date.now();

  const syncResult = await syncAltegioFinanceTransactions({
    dateFrom: kyivDay,
    dateTo: kyivDay,
    maxPages: 10,
    syncPurposes: false,
  });

  // Один день — можна з documents/records (на повному періоді це 404-шторм).
  const liveFetch = await fetchLiveIncomeRowsRange(kyivDay, kyivDay, {
    skipDocumentEnrichment: false,
  });
  const dbRows = await fetchDbIncomeRowsRange(kyivDay, kyivDay);
  const merged = mergeIncomeRows(liveFetch.rows, dbRows);

  let rows = await enrichMissingPayersFromDirectClients(merged);
  rows = await enrichMissingPayersFromRecords(rows);
  rows = await enrichMissingPayersFromFinanceTransactions(rows);
  rows = await enrichMissingPayersFromDirectClients(rows);
  rows = rows.map((row) => {
    if (row.payerName !== NO_PAYER_LABEL) return row;
    const purpose = row.paymentPurpose?.trim() || "";
    if (!purpose) return row;
    if (purpose.toLowerCase() === "надання послуг") return row;
    if (/^\d+\s+оплат/i.test(purpose)) return row;
    return { ...row, payerName: purpose };
  });

  let upsertedToDb = 0;
  for (const row of rows) {
    if (row.kyivDay !== kyivDay) continue;
    const operationDate = parseAltegioDateTime(row.operationTime);
    const counterpartyName = row.payerName === NO_PAYER_LABEL ? null : row.payerName;
    const accountTitle =
      !row.accountTitle || row.accountTitle === "— без рахунку —" ? null : row.accountTitle;

    const existing = await (prisma as any).altegioFinanceTransaction.findUnique({
      where: { companyId_altegioId: { companyId, altegioId: row.altegioId } },
      select: { rawData: true },
    });
    const prevRaw = asRecord(existing?.rawData) ?? {};
    const nextRaw = {
      ...prevRaw,
      id: row.altegioId,
      client_id: row.clientId ?? prevRaw.client_id ?? null,
      record_id: row.recordId ?? prevRaw.record_id ?? null,
      document_id: row.documentId ?? prevRaw.document_id ?? null,
      payment_purpose: row.paymentPurpose ?? prevRaw.payment_purpose ?? null,
      ...(counterpartyName
        ? {
            client: {
              ...(asRecord(prevRaw.client) ?? {}),
              id: row.clientId ?? asRecord(prevRaw.client)?.id ?? null,
              name: counterpartyName,
            },
            client_name: counterpartyName,
          }
        : {}),
      refreshedByIncomingDay: new Date().toISOString(),
    };

    await (prisma as any).altegioFinanceTransaction.upsert({
      where: { companyId_altegioId: { companyId, altegioId: row.altegioId } },
      create: {
        altegioId: row.altegioId,
        companyId,
        accountId: row.accountId,
        accountTitle,
        documentId: row.documentId,
        expenseId: null,
        operationDate,
        kyivDay: row.kyivDay,
        amountKopiykas: row.amountKop,
        direction: "in",
        paymentPurpose: row.paymentPurpose,
        counterpartyName,
        sourceEndpoint: "incoming-refresh-day",
        rawData: nextRaw,
        deletedInAltegio: false,
        syncedAt: new Date(),
      },
      update: {
        accountId: row.accountId ?? undefined,
        accountTitle: accountTitle ?? undefined,
        documentId: row.documentId ?? undefined,
        operationDate,
        kyivDay: row.kyivDay,
        amountKopiykas: row.amountKop,
        paymentPurpose: row.paymentPurpose ?? undefined,
        ...(counterpartyName ? { counterpartyName } : {}),
        sourceEndpoint: "incoming-refresh-day",
        rawData: nextRaw,
        deletedInAltegio: false,
        syncedAt: new Date(),
      },
    });
    upsertedToDb += 1;
  }

  const withPayerName = rows.filter((row) => row.payerName !== NO_PAYER_LABEL).length;
  const result: RefreshIncomingAltegioDayResult = {
    kyivDay,
    syncedFromSearch: syncResult.upserted,
    liveRows: liveFetch.rows.length,
    dbRowsBeforeEnrich: dbRows.length,
    upsertedToDb,
    withPayerName,
    withoutPayerName: rows.length - withPayerName,
  };

  console.log("[incoming-altegio-aggregate] Підтягнуто Altegio за день", {
    ...result,
    ms: Date.now() - startedAt,
  });

  return result;
}
