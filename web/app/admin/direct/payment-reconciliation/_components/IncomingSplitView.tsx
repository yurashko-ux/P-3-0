"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEPOSIT_PAYMENT_LABEL,
  isDepositTopUpPaymentPurpose,
} from "@/lib/altegio/payment-purpose-labels";
import {
  accountsMatchForReconcile,
  bankRowIsAcquiringIncomingMatch,
  bankRowIsNamedIncomingMatch,
  evaluateIncomingAccountReconcile,
  evaluateOpenReconcilePairs,
  isCashReconcileAccount,
  isIncomingRowAcquiringForReconcile,
  normalizePersonName,
  personNamesMatch,
  type EvaluatedOpenReconcilePair,
} from "@/lib/bank/incoming-reconcile-matching";
import {
  buildAltegioRecordTimetableUrl,
  buildAltegioTransactionEditUrl,
} from "@/lib/altegio/web-urls";
import { buildBankStatementItemUrl } from "@/lib/bank/web-urls";
import {
  buildDepositBalanceLookup,
  type DepositBalancesPayload,
} from "@/lib/altegio/deposit-balance-lookup";
import { buildCashDepositTabDays } from "@/lib/bank/deposit-tab-cash-rows";
import {
  buildDepositTabSourceDays,
  depositRowAltegioId,
  splitReconciledDepositRows,
  type DepositRealizationIndex,
  type DepositRealizationMeta,
  type DepositRealizationStatus,
} from "@/lib/bank/deposit-realization";

type AltegioIncomingItem = {
  altegioId: number;
  documentId: number | null;
  recordId: number | null;
  accountTitle: string;
  amountKop: string;
  operationTime: string;
  paymentPurpose: string | null;
};

type DepositIncomingMatch = {
  id: string;
  altegioTransactionId: number;
  bankStatementItemId: string | null;
  paymentKyivDay: string;
  displayKyivDay: string;
  appointmentAt: string | null;
  clientId: number | null;
  payerName: string;
  amountKopiykas: string;
  accountTitle: string | null;
  operationTime: string | null;
  status: string;
  matchType: string;
  matchedAt: string;
  matchedBy: string | null;
  reviewNote: string | null;
};

type AltegioPayerAggregate = {
  payerName: string;
  totalKop: string;
  transactionCount: number;
  items: AltegioIncomingItem[];
};

type BankIncomingItem = {
  id: string;
  time: string;
  amountKop: string;
  description: string;
  comment: string | null;
  counterName: string | null;
  kind: "universal_bank_aggregate" | "named_incoming" | "unknown";
  commissionKop: string | null;
  commissionRaw: string | null;
};

type IncomingAccountDayGroup<TItem> = {
  accountTitle: string;
  accountId: string | null;
  altegioAccountTitle: string | null;
  totalKop: string;
  items: TItem[];
};

type IncomingDayGroup<TItem> = {
  kyivDay: string;
  dayLabel: string;
  totalKop: string;
  byAccount: IncomingAccountDayGroup<TItem>[];
};

type IncomingPreview = {
  ok: boolean;
  error?: string;
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
  reconciled?: {
    bankItemIds: string[];
    matches: Array<{
      id: string;
      bankStatementItemId: string;
      kyivDay: string;
      status: string;
      matchType: string;
      matchedAt: string;
      matchedBy: string | null;
      reviewNote: string | null;
      acquiringExpenseTransactionId: string | null;
    }>;
    depositMatches?: DepositIncomingMatch[];
    depositAltegioIds?: number[];
    depositBankItemIds?: string[];
  };
  depositRealization?: DepositRealizationIndex;
  depositBalances?: DepositBalancesPayload | null;
};

type DepositTabDataPayload = {
  ok: boolean;
  error?: string;
  depositBalances?: DepositBalancesPayload | null | {
    totalBalance?: number;
    source?: string;
    accounts?: DepositBalancesPayload["accounts"];
    deposits?: DepositBalancesPayload["accounts"];
  };
};

function normalizeDepositBalancesPayload(
  raw: DepositTabDataPayload["depositBalances"],
): DepositBalancesPayload | null {
  if (!raw) return null;
  const accounts = raw.accounts ?? (raw as { deposits?: DepositBalancesPayload["accounts"] }).deposits ?? [];
  return {
    totalBalance: raw.totalBalance ?? 0,
    source: raw.source ?? "unknown",
    accounts,
  };
}

const SPLIT_ROW_CLASS = "grid w-full grid-cols-[minmax(0,1fr)_minmax(84px,104px)_minmax(0,1fr)] items-stretch";
/** Середня колонка Δ — єдиний фон на всю висоту рядка. */
const DIFF_COLUMN_CLASS = "flex min-h-full self-stretch flex-col border-x border-gray-200 bg-amber-50/50";

function formatDepositBalanceUah(balance: number | null | undefined): string {
  if (balance == null || Number.isNaN(balance)) return "—";
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(balance);
}

function formatTotalDepositBalanceUah(total: number | null | undefined): string {
  if (total == null || Number.isNaN(total)) return "—";
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(total);
}

function AltegioColGroup({ showMetaColumns = false }: { showMetaColumns?: boolean }) {
  if (showMetaColumns) {
    return (
      <colgroup>
        <col className="w-4" />
        <col className="w-[22%]" />
        <col className="w-[9%]" />
        <col className="w-[9%]" />
        <col className="w-[9%]" />
        <col className="w-[26%]" />
        <col className="w-[15%]" />
      </colgroup>
    );
  }

  return (
    <colgroup>
      <col className="w-4" />
      <col className="w-[28%]" />
      <col className="w-[12%]" />
      <col className="w-[34%]" />
      <col className="w-[20%]" />
    </colgroup>
  );
}

function BankColGroup() {
  return (
    <colgroup>
      <col className="w-[22%]" />
      <col className="w-[11%]" />
      <col className="w-[28%]" />
      <col className="w-[11%]" />
      <col className="w-[9%]" />
      <col className="w-[10%]" />
      <col className="w-[9%]" />
    </colgroup>
  );
}

const ALT_TABLE_CLASS = "w-full table-fixed text-left";
const BANK_TABLE_CLASS = "w-full table-fixed text-left";

function formatMoney(kopiykas: string | null | undefined): string {
  const value = Number(kopiykas || 0) / 100;
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function kyivDayFromOperationTime(operationTime: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(operationTime));
}

function getKyivTodayYmd(): string {
  return kyivDayFromOperationTime(new Date().toISOString());
}

/** Незведені: не показувати платежі раніше цієї дати (Europe/Kyiv). */
const OPEN_INCOMING_MIN_KYIV_DAY = "2026-07-01";

function filterOpenIncomingDaysByMinDate(days: VisibleAlignedDayRow[]): VisibleAlignedDayRow[] {
  return days.filter((day) => day.kyivDay >= OPEN_INCOMING_MIN_KYIV_DAY);
}

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatKyivDayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  return `${day}.${month}.${year}`;
}

/** День групування банку: еквайринг зсуваємо на −1 день, дату в рядку не змінюємо. */
function bankGroupingKyivDay(item: BankIncomingItem): string {
  const actualDay = kyivDayFromOperationTime(item.time);
  if (isIncomingRowAcquiringForReconcile(item)) return addDaysYmd(actualDay, -1);
  return actualDay;
}

type BankDayItemRow = BankIncomingItem & {
  accountTitle: string;
  altegioAccountTitle: string | null;
  isDepositCashPlaceholder?: boolean;
};

type BankAccountGroup = {
  accountTitle: string;
  altegioAccountTitle: string | null;
  rows: BankDayItemRow[];
  totalKop: string;
};

type DayAccountAlignedRow = {
  matchKey: string;
  altegioAccount: AltegioDayAccountRow | null;
  bankGroup: BankAccountGroup | null;
  isDepositMatch?: boolean;
  /** Примітка з BankAltegioIncomingMatch / BankAltegioDepositMatch */
  reviewNote?: string | null;
  /** Дата найближчого активного запису (колонка «Запис») */
  zapisDateLabel?: string | null;
  /** Дата створення платежу-завдатку (колонка «Завдаток») */
  zavdatokPaymentDateLabel?: string | null;
  /** @deprecated використовуйте zapisDateLabel */
  zavdatokDateLabel?: string | null;
  /** День зведення в UI (день запису / kyivDay матчу) */
  displayKyivDay?: string;
  /** ID запису Altegio для посилання в колонці «Запис» */
  zapisRecordId?: number | null;
};

type IncomingReconciledMatch = NonNullable<IncomingPreview["reconciled"]>["matches"][number];

type BankDayFlat = {
  kyivDay: string;
  dayLabel: string;
  totalKop: string;
  commissionTotalKop: string;
  fullTotalKop: string;
  rows: BankDayItemRow[];
};

function sumBankRowsTotals(rows: BankDayItemRow[]): {
  totalKop: string;
  commissionTotalKop: string;
  fullTotalKop: string;
} {
  let totalKop = 0n;
  let commissionTotalKop = 0n;
  let fullTotalKop = 0n;

  for (const row of rows) {
    totalKop += BigInt(row.amountKop || 0);
    commissionTotalKop += bankCommissionKop(row);
    fullTotalKop += bankFullAmountKop(row);
  }

  return {
    totalKop: totalKop.toString(),
    commissionTotalKop: commissionTotalKop.toString(),
    fullTotalKop: fullTotalKop.toString(),
  };
}

/** Підсумки банку за день — лише з рядків, що реально показані у вкладці. */
function summarizeVisibleBankForDay(
  kyivDay: string,
  dayLabel: string,
  accountRows: DayAccountAlignedRow[],
): BankDayFlat | null {
  const bankRows: BankDayItemRow[] = [];
  for (const row of accountRows) {
    if (row.bankGroup) bankRows.push(...row.bankGroup.rows);
  }
  if (bankRows.length === 0) return null;
  return {
    kyivDay,
    dayLabel,
    rows: bankRows,
    ...sumBankRowsTotals(bankRows),
  };
}

function regroupBankByDayWithAcquiringShift(
  byDay: IncomingDayGroup<BankIncomingItem>[],
): BankDayFlat[] {
  const bucket = new Map<string, BankDayItemRow[]>();

  for (const day of byDay) {
    for (const account of day.byAccount) {
      for (const item of account.items) {
        const groupingDay = bankGroupingKyivDay(item);
        if (!bucket.has(groupingDay)) bucket.set(groupingDay, []);
        bucket.get(groupingDay)!.push({
          ...item,
          accountTitle: account.accountTitle,
          altegioAccountTitle: account.altegioAccountTitle ?? null,
        });
      }
    }
  }

  const days = Array.from(bucket.entries()).map(([kyivDay, rows]) => {
    rows.sort((a, b) => b.time.localeCompare(a.time));
    const totals = sumBankRowsTotals(rows);
    return {
      kyivDay,
      dayLabel: formatKyivDayLabel(kyivDay),
      totalKop: totals.totalKop,
      commissionTotalKop: totals.commissionTotalKop,
      fullTotalKop: totals.fullTotalKop,
      rows,
    };
  });

  days.sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  return days;
}

type AlignedDayRow = {
  kyivDay: string;
  dayLabel: string;
  altegio: AltegioDayGroup | null;
  bank: BankDayFlat | null;
};

type VisibleAlignedDayRow = AlignedDayRow & {
  accountRows: DayAccountAlignedRow[];
};

function mergeAlignedDays(
  altegioDays: AltegioDayGroup[],
  bankDays: BankDayFlat[],
): AlignedDayRow[] {
  const bankByDay = new Map(bankDays.map((day) => [day.kyivDay, day]));
  const altegioByDay = new Map(altegioDays.map((day) => [day.kyivDay, day]));
  const allKyivDays = new Set([...bankByDay.keys(), ...altegioByDay.keys()]);

  return Array.from(allKyivDays)
    .map((kyivDay) => ({
      kyivDay,
      dayLabel: formatKyivDayLabel(kyivDay),
      altegio: altegioByDay.get(kyivDay) ?? null,
      bank: bankByDay.get(kyivDay) ?? null,
    }))
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}

function formatCompactDateTime(value: string): string {
  return new Date(value).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bankCommissionKop(item: BankIncomingItem): bigint {
  if (item.commissionKop) return BigInt(item.commissionKop);
  if (item.commissionRaw) {
    const match = item.commissionRaw.match(/([\d\s]+(?:[,.]\d{1,2})?)/);
    if (match) {
      const amount = Number(match[1].replace(/\s+/g, "").replace(",", "."));
      if (Number.isFinite(amount) && amount > 0) return BigInt(Math.round(amount * 100));
    }
  }
  return 0n;
}

function bankFullAmountKop(item: BankIncomingItem): bigint {
  return BigInt(item.amountKop || 0) + bankCommissionKop(item);
}

function formatCommissionShort(item: BankIncomingItem): string {
  if (item.commissionKop) {
    return `${formatMoney(item.commissionKop)}`;
  }
  if (item.commissionRaw) {
    const match = item.commissionRaw.match(/([\d\s]+(?:[,.]\d{1,2})?)/);
    if (match) return match[1].replace(/\s+/g, "").replace(",", ".");
  }
  return "—";
}

function bankCounterpartyLabel(item: BankIncomingItem): string {
  return item.counterName || item.description || item.comment || "—";
}

function normalizeAccountMatchKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/^(?:фоп|фсп)\s+/i, "")
    .replace(/[^\p{L}\p{N}\s$]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type AccountColorStyle = {
  bg: string;
  border: string;
  text: string;
};

/** Палітра для візуального зведення пар рахунків Altegio ↔ Банк. */
const ACCOUNT_PAIR_PALETTE: AccountColorStyle[] = [
  { bg: "bg-orange-100", border: "border-orange-500", text: "text-orange-950" },
  { bg: "bg-sky-100", border: "border-sky-500", text: "text-sky-950" },
  { bg: "bg-violet-100", border: "border-violet-500", text: "text-violet-950" },
  { bg: "bg-rose-100", border: "border-rose-500", text: "text-rose-950" },
  { bg: "bg-lime-100", border: "border-lime-600", text: "text-lime-950" },
  { bg: "bg-fuchsia-100", border: "border-fuchsia-500", text: "text-fuchsia-950" },
  { bg: "bg-teal-100", border: "border-teal-500", text: "text-teal-950" },
  { bg: "bg-amber-100", border: "border-amber-600", text: "text-amber-950" },
  { bg: "bg-indigo-100", border: "border-indigo-500", text: "text-indigo-950" },
  { bg: "bg-cyan-100", border: "border-cyan-600", text: "text-cyan-950" },
  { bg: "bg-pink-100", border: "border-pink-500", text: "text-pink-950" },
  { bg: "bg-emerald-100", border: "border-emerald-600", text: "text-emerald-950" },
];

/** Закріплені кольори для окремих ФОП (індекс у палітрі). Решта — автоматично через hash. */
const PINNED_ACCOUNT_PALETTE_INDEX: Record<string, number> = {
  колачник: 0,
  жалівців: 1,
};

const PINNED_PALETTE_INDEXES = new Set(Object.values(PINNED_ACCOUNT_PALETTE_INDEX));

function hashStringToUint(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Колір рахунку: закріплений для відомих ФОП або детермінований hash для нових.
 * Новий рахунок автоматично отримує колір з палітри — без змін у коді.
 */
function resolveAccountColorStyle(colorKey: string): AccountColorStyle | null {
  if (!colorKey || colorKey === "unknown") return null;

  const pinnedIndex = PINNED_ACCOUNT_PALETTE_INDEX[colorKey];
  if (pinnedIndex != null) {
    return ACCOUNT_PAIR_PALETTE[pinnedIndex % ACCOUNT_PAIR_PALETTE.length] ?? null;
  }

  const autoPool = ACCOUNT_PAIR_PALETTE.map((_, index) => index).filter(
    (index) => !PINNED_PALETTE_INDEXES.has(index),
  );
  const paletteIndexes = autoPool.length > 0 ? autoPool : ACCOUNT_PAIR_PALETTE.map((_, index) => index);
  const pickedIndex = paletteIndexes[hashStringToUint(colorKey) % paletteIndexes.length]!;
  return ACCOUNT_PAIR_PALETTE[pickedIndex] ?? null;
}

function pinnedColorKeyFromTitle(title: string): string | null {
  const key = normalizeAccountMatchKey(title);
  if (PINNED_ACCOUNT_PALETTE_INDEX[key] != null) return key;
  const familyFragments: Array<{ family: string; fragments: string[] }> = [
    { family: "колачник", fragments: ["колачник", "колічник", "копачник", "колечник"] },
    { family: "жалівців", fragments: ["жалівців", "жаліцька", "жалівця", "желіхів", "желихів"] },
  ];
  for (const { family, fragments } of familyFragments) {
    if (fragments.some((fragment) => key.includes(fragment))) return family;
  }
  for (const pinnedKey of Object.keys(PINNED_ACCOUNT_PALETTE_INDEX)) {
    if (key.includes(pinnedKey)) return pinnedKey;
  }
  return null;
}

/** Єдиний ключ кольору для пари Altegio ↔ Банк (закріплені ФОП + збіг рахунків). */
function resolvePairAccountColorKey(
  altegioTitle: string | null | undefined,
  bankTitle: string,
  bankAltegioTitle: string | null | undefined,
): string {
  for (const title of [altegioTitle, bankAltegioTitle, bankTitle]) {
    if (!title) continue;
    const pinned = pinnedColorKeyFromTitle(title);
    if (pinned) return pinned;
  }

  if (
    altegioTitle
    && bankTitle
    && accountsMatchForReconcile(altegioTitle, bankTitle, bankAltegioTitle ?? null)
  ) {
    return normalizeAccountMatchKey(altegioTitle);
  }

  if (bankAltegioTitle) {
    const pinned = pinnedColorKeyFromTitle(bankAltegioTitle);
    return pinned ?? normalizeAccountMatchKey(bankAltegioTitle);
  }

  if (altegioTitle) return normalizeAccountMatchKey(altegioTitle);

  const bankPinned = pinnedColorKeyFromTitle(bankTitle);
  return bankPinned ?? normalizeAccountMatchKey(bankTitle);
}

function accountColorKeyFromTitle(title: string): string {
  const pinned = pinnedColorKeyFromTitle(title);
  return pinned ?? normalizeAccountMatchKey(title);
}

function accountColorKeyFromRow(row: DayAccountAlignedRow): string {
  const bankTitle =
    row.bankGroup?.rows[0]?.accountTitle
    ?? row.bankGroup?.accountTitle
    ?? "";
  const bankAltegioTitle =
    row.bankGroup?.altegioAccountTitle
    ?? row.bankGroup?.rows[0]?.altegioAccountTitle
    ?? null;

  return resolvePairAccountColorKey(
    row.altegioAccount?.accountTitle,
    bankTitle,
    bankAltegioTitle,
  );
}

function AccountTitleBadge({
  title,
  colorKey,
  variant = "badge",
}: {
  title: string;
  colorKey: string;
  variant?: "badge" | "plain" | "filled";
}) {
  const style = resolveAccountColorStyle(colorKey);
  if (variant === "plain") {
    return (
      <span
        className={`block truncate text-[9px] font-medium leading-tight ${style?.text ?? "text-gray-800"}`}
        title={title}
      >
        {title}
      </span>
    );
  }
  if (variant === "filled") {
    return (
      <span
        className={`inline-flex max-w-full truncate rounded px-1 py-0.5 text-[9px] font-medium ${style?.bg ?? "bg-gray-100"} ${style?.text ?? "text-gray-800"}`}
        title={title}
      >
        {title}
      </span>
    );
  }
  if (!style) {
    return <span className="block truncate">{title}</span>;
  }
  return (
    <span
      className={`inline-block max-w-full truncate rounded border px-1 py-px text-[9px] font-semibold leading-tight ${style.bg} ${style.border} ${style.text}`}
      title={title}
    >
      {title}
    </span>
  );
}

function LinkedKindBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex max-w-full truncate rounded px-1 py-0.5 text-[9px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function isCashDepositPlaceholderAccount(accountTitle: string): boolean {
  const key = normalizeAccountMatchKey(accountTitle);
  return key.includes("готів") && key.includes("завдат");
}

function isAltegioCashAccount(accountTitle: string): boolean {
  return isCashReconcileAccount(accountTitle);
}

function reconciledAltegioClientKey(client: AltegioDayAccountClient): string {
  const name = normalizePersonName(client.payerName);
  return name ? `${name}|${client.totalKop}` : client.totalKop;
}

function altegioClientMatchesAmount(client: AltegioDayAccountClient, amountKop: string): boolean {
  if (client.totalKop === amountKop) return true;
  return client.items.some((item) => item.amountKop === amountKop);
}

function hasAccountMismatchInRow(accountRow: DayAccountAlignedRow): boolean {
  if (!accountRow.altegioAccount || !accountRow.bankGroup) return false;
  const altegioTitle = accountRow.altegioAccount.accountTitle;

  for (const bankRow of accountRow.bankGroup.rows) {
    if (bankRow.isDepositCashPlaceholder) {
      if (!isAltegioCashAccount(altegioTitle)) return true;
      continue;
    }
    if (!accountsMatchForReconcile(altegioTitle, bankRow.accountTitle, bankRow.altegioAccountTitle)) {
      return true;
    }
  }
  return false;
}

function isDepositMatchAccountMismatch(
  match: DepositIncomingMatch,
  bankRowById: Map<string, BankDayItemRow>,
): boolean {
  const altegioTitle = match.accountTitle || "";
  if (!match.bankStatementItemId) return true;
  const bankRow = bankRowById.get(match.bankStatementItemId);
  if (!bankRow) return false;
  return !accountsMatchForReconcile(altegioTitle, bankRow.accountTitle, bankRow.altegioAccountTitle);
}

/** Банківські рядки, коректно зайняті саме deposit-match (не блокуємо incoming для «битих» deposit). */
function depositBankIdsClaimedByValidDepositMatches(
  depositMatches: DepositIncomingMatch[],
  mismatchDepositMatchIds: Set<string>,
  bankRowById: Map<string, BankDayItemRow>,
): Set<string> {
  const ids = new Set<string>();
  for (const match of depositMatches) {
    if (mismatchDepositMatchIds.has(match.id)) continue;
    if (isCashReconcileAccount(match.accountTitle || "")) continue;
    if (!match.bankStatementItemId) continue;
    if (isDepositMatchAccountMismatch(match, bankRowById)) continue;
    ids.add(match.bankStatementItemId);
  }
  return ids;
}

function collectOpenAccountMismatchKeys(accountRows: DayAccountAlignedRow[]): Set<string> {
  const mismatchKeys = new Set<string>();

  for (const row of accountRows) {
    if (hasAccountMismatchInRow(row)) mismatchKeys.add(row.matchKey);
  }

  type PayerAmountEntry = {
    matchKey: string;
    payer: string;
    amount: string;
    account: string;
  };

  const altegioEntries: PayerAmountEntry[] = [];
  const bankEntries: PayerAmountEntry[] = [];

  for (const row of accountRows) {
    for (const client of row.altegioAccount?.clients ?? []) {
      for (const item of client.items) {
        altegioEntries.push({
          matchKey: row.matchKey,
          payer: normalizePersonName(client.payerName),
          amount: item.amountKop,
          account: item.accountTitle || row.altegioAccount!.accountTitle,
        });
      }
    }
    for (const bankRow of row.bankGroup?.rows ?? []) {
      if (bankRow.isDepositCashPlaceholder) continue;
      bankEntries.push({
        matchKey: row.matchKey,
        payer: normalizePersonName(bankCounterpartyLabel(bankRow)),
        amount: bankRow.amountKop,
        account: bankRow.accountTitle,
      });
    }
  }

  for (const altegioEntry of altegioEntries) {
    if (!altegioEntry.payer) continue;
    for (const bankEntry of bankEntries) {
      if (!bankEntry.payer || altegioEntry.payer !== bankEntry.payer) continue;
      if (altegioEntry.amount !== bankEntry.amount) continue;
      if (accountsMatchForReconcile(altegioEntry.account, bankEntry.account, null)) continue;
      mismatchKeys.add(altegioEntry.matchKey);
      mismatchKeys.add(bankEntry.matchKey);
    }
  }

  return mismatchKeys;
}

function groupBankDayByAccount(bankDay: BankDayFlat): BankAccountGroup[] {
  const map = new Map<string, BankDayItemRow[]>();

  for (const row of bankDay.rows) {
    const key = row.accountTitle;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }

  const groups = Array.from(map.entries()).map(([accountTitle, rows]) => {
    rows.sort((a, b) => b.time.localeCompare(a.time));
    const totalKop = rows.reduce((sum, row) => sum + BigInt(row.amountKop), 0n);
    return {
      accountTitle,
      altegioAccountTitle: rows[0]?.altegioAccountTitle ?? null,
      rows,
      totalKop: totalKop.toString(),
    };
  });

  groups.sort((a, b) => {
    const amountDiff = Number(BigInt(b.totalKop) - BigInt(a.totalKop));
    if (amountDiff !== 0) return amountDiff;
    return a.accountTitle.localeCompare(b.accountTitle, "uk");
  });

  return groups;
}

function buildDayAccountAlignedRows(
  altegioDay: AltegioDayGroup | null,
  bankDay: BankDayFlat | null,
): DayAccountAlignedRow[] {
  const altegioAccounts = altegioDay?.accounts ?? [];
  const bankGroups = bankDay ? groupBankDayByAccount(bankDay) : [];
  const usedBankIndexes = new Set<number>();
  const rows: DayAccountAlignedRow[] = [];

  for (const altegioAccount of altegioAccounts) {
    const bankIdx = bankGroups.findIndex(
      (group, index) =>
        !usedBankIndexes.has(index)
        && accountsMatchForReconcile(
          altegioAccount.accountTitle,
          group.accountTitle,
          group.altegioAccountTitle,
        ),
    );
    if (bankIdx >= 0) usedBankIndexes.add(bankIdx);

    rows.push({
      matchKey: `altegio|${altegioAccount.accountTitle}|${bankIdx >= 0 ? bankGroups[bankIdx].accountTitle : "none"}`,
      altegioAccount,
      bankGroup: bankIdx >= 0 ? bankGroups[bankIdx] : null,
    });
  }

  for (let index = 0; index < bankGroups.length; index += 1) {
    if (usedBankIndexes.has(index)) continue;
    rows.push({
      matchKey: `bank-only|${bankGroups[index].accountTitle}`,
      altegioAccount: null,
      bankGroup: bankGroups[index],
    });
  }

  return rows;
}

type AltegioDayPayerRow = {
  altegioId: number;
  recordId: number | null;
  payerName: string;
  amountKop: string;
  accountTitle: string;
  operationTime: string;
  paymentPurpose: string | null;
};

type AltegioDayAccountClient = {
  payerName: string;
  totalKop: string;
  latestOperationTime: string;
  items: AltegioDayPayerRow[];
};

type AltegioDayAccountRow = {
  accountTitle: string;
  totalKop: string;
  latestOperationTime: string;
  clients: AltegioDayAccountClient[];
};

type AltegioDayGroup = {
  kyivDay: string;
  dayLabel: string;
  totalKop: string;
  accounts: AltegioDayAccountRow[];
};

function bankGroupFullTotalKop(group: BankAccountGroup): bigint {
  return group.rows.reduce((sum, row) => sum + bankFullAmountKop(row), 0n);
}

function namedBankFullForClientKop(
  client: AltegioDayAccountClient,
  bankGroup: BankAccountGroup | null,
): bigint {
  if (!bankGroup) return 0n;

  let total = 0n;
  for (const row of bankGroup.rows) {
    if (row.kind !== "named_incoming") continue;
    if (personNamesMatch(client.payerName, bankCounterpartyLabel(row))) {
      total += bankFullAmountKop(row);
    }
  }
  return total;
}

function accountDiffKop(
  altegioAccount: AltegioDayAccountRow | null,
  bankGroup: BankAccountGroup | null,
): bigint {
  const altegio = altegioAccount ? BigInt(altegioAccount.totalKop) : 0n;
  const bankFull = bankGroup ? bankGroupFullTotalKop(bankGroup) : 0n;
  return bankFull - altegio;
}

function clientDiffKop(
  client: AltegioDayAccountClient,
  bankGroup: BankAccountGroup | null,
): bigint | null {
  const namedFull = namedBankFullForClientKop(client, bankGroup);
  if (namedFull === 0n) return null;
  return namedFull - BigInt(client.totalKop);
}

function dayDiffKop(altegio: AltegioDayGroup | null, bank: BankDayFlat | null): bigint {
  const altegioTotal = altegio ? BigInt(altegio.totalKop) : 0n;
  const bankFull = bank ? BigInt(bank.fullTotalKop) : 0n;
  return bankFull - altegioTotal;
}

function formatDiffDisplay(diffKop: bigint): { text: string; className: string } {
  const roundedUah = Math.round(Number(diffKop) / 100);
  if (roundedUah === 0) {
    return { text: "0", className: "text-gray-500" };
  }
  const sign = roundedUah > 0 ? "+" : "";
  const className = roundedUah > 0 ? "text-green-700" : "text-red-700";
  return {
    text: `${sign}${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(roundedUah)}`,
    className,
  };
}

function formatDiffInParens(diffKop: bigint): string {
  const { text } = formatDiffDisplay(diffKop);
  return `(${text})`;
}

function DiffValue({
  diffKop,
  className = "",
  title,
}: {
  diffKop: bigint | null;
  className?: string;
  title?: string;
}) {
  if (diffKop === null) {
    return (
      <div
        className={`flex min-h-[1.375rem] items-center justify-end px-1 py-0.5 text-[10px] text-gray-400 ${className}`}
        title={title}
      >
        —
      </div>
    );
  }

  const { text, className: colorClass } = formatDiffDisplay(diffKop);
  return (
    <div
      className={`flex min-h-[1.375rem] items-center justify-end px-1 py-0.5 text-[10px] font-semibold tabular-nums ${colorClass} ${className}`}
      title={title}
    >
      {text}
    </div>
  );
}

function AccountDiffColumn({
  accountRow,
  kyivDay,
  expandedAccounts,
}: {
  accountRow: DayAccountAlignedRow;
  kyivDay: string;
  expandedAccounts: Set<string>;
}) {
  const { altegioAccount, bankGroup } = accountRow;

  if (!altegioAccount && bankGroup) {
    return (
      <div className="flex h-full min-h-full w-full flex-1 flex-col justify-start">
        <DiffValue
          diffKop={bankGroupFullTotalKop(bankGroup)}
          className="border-t border-gray-100"
          title="Банк (повна) − Altegio: лише банк"
        />
      </div>
    );
  }

  if (!altegioAccount) {
    return <EmptyDayCell tone="diff" />;
  }

  const accountKey = `${kyivDay}|${altegioAccount.accountTitle}`;
  const expanded = expandedAccounts.has(accountKey);
  const canExpand = altegioAccount.clients.length > 1;

  return (
    <div className="flex h-full min-h-full w-full flex-1 flex-col">
      <DiffValue
        diffKop={accountDiffKop(altegioAccount, bankGroup)}
        className="border-t border-gray-100"
        title="Банк (повна) − Altegio по рахунку"
      />
      {canExpand && expanded
        ? altegioAccount.clients.map((client) => {
            const diff = clientDiffKop(client, bankGroup);
            return (
              <DiffValue
                key={`${accountKey}|${client.payerName}`}
                diffKop={diff}
                className="border-t border-gray-50 bg-amber-50/60"
                title={
                  diff === null
                    ? "Немає іменованого платежу в банку для цього клієнта"
                    : "Банк (повна) − Altegio по іменованому платежу"
                }
              />
            );
          })
        : null}
    </div>
  );
}

type AltegioCashFilter = "all" | "cash" | "non_cash";

/** Готівкові рахунки Altegio: Каса, Долар, Євро (узгоджено з lib/bank/incoming-reconcile-matching). */
function isCashAltegioAccount(accountTitle: string): boolean {
  const normalized = accountTitle.trim().toLowerCase();
  if (normalized === "каса" || normalized.startsWith("каса ")) return true;
  if (normalized.includes("долар") || normalized.includes("dollar")) return true;
  if (normalized.includes("євро") || normalized.includes("евро") || normalized.includes("euro")) return true;
  return false;
}

function filterAltegioDaysByCash(days: AltegioDayGroup[], filter: AltegioCashFilter): AltegioDayGroup[] {
  if (filter === "all") return days;

  return days
    .map((day) => {
      const accounts = day.accounts.filter((account) =>
        filter === "cash"
          ? isCashAltegioAccount(account.accountTitle)
          : !isCashAltegioAccount(account.accountTitle),
      );
      if (accounts.length === 0) return null;

      const totalKop = accounts.reduce((sum, account) => sum + BigInt(account.totalKop), 0n);
      return {
        ...day,
        accounts,
        totalKop: totalKop.toString(),
      };
    })
    .filter((day): day is AltegioDayGroup => day != null);
}

function sumAltegioDaysKop(days: AltegioDayGroup[]): string {
  const total = days.reduce((sum, day) => sum + BigInt(day.totalKop), 0n);
  return total.toString();
}

const ALTEGIO_CASH_FILTER_OPTIONS: Array<{ value: AltegioCashFilter; label: string }> = [
  { value: "all", label: "Всі" },
  { value: "cash", label: "Готівкові" },
  { value: "non_cash", label: "БезГотівкові" },
];

function groupAltegioPayersByDay(byPayer: AltegioPayerAggregate[]): AltegioDayGroup[] {
  const dayMap = new Map<string, AltegioDayPayerRow[]>();

  for (const payer of byPayer) {
    for (const item of payer.items) {
      const kyivDay = kyivDayFromOperationTime(item.operationTime);
      if (!dayMap.has(kyivDay)) dayMap.set(kyivDay, []);
      dayMap.get(kyivDay)!.push({
        altegioId: item.altegioId,
        recordId: item.recordId,
        payerName: payer.payerName,
        amountKop: item.amountKop,
        accountTitle: item.accountTitle,
        operationTime: item.operationTime,
        paymentPurpose: item.paymentPurpose,
      });
    }
  }

  const days = Array.from(dayMap.entries()).map(([kyivDay, rows]) => {
    const accountMap = new Map<string, Map<string, AltegioDayPayerRow[]>>();

    for (const row of rows) {
      const accountKey = row.accountTitle.trim() || "— без рахунку —";
      if (!accountMap.has(accountKey)) accountMap.set(accountKey, new Map());
      const clientMap = accountMap.get(accountKey)!;
      const payerKey = row.payerName.trim().toLowerCase() || "— без платника —";
      if (!clientMap.has(payerKey)) clientMap.set(payerKey, []);
      clientMap.get(payerKey)!.push(row);
    }

    const accounts: AltegioDayAccountRow[] = [];

    for (const [accountTitle, clientMap] of accountMap.entries()) {
      const clients: AltegioDayAccountClient[] = Array.from(clientMap.entries()).map(
        ([, items]) => {
          items.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
          const totalKop = items.reduce((sum, item) => sum + BigInt(item.amountKop), 0n);
          return {
            payerName: items[0]?.payerName || "— без платника —",
            totalKop: totalKop.toString(),
            latestOperationTime: items[0]?.operationTime || "",
            items,
          };
        },
      );

      clients.sort((a, b) => {
        const timeDiff = b.latestOperationTime.localeCompare(a.latestOperationTime);
        if (timeDiff !== 0) return timeDiff;
        return a.payerName.localeCompare(b.payerName, "uk");
      });

      const allItems = clients.flatMap((client) => client.items);
      allItems.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
      const accountTotalKop = clients.reduce((sum, client) => sum + BigInt(client.totalKop), 0n);

      accounts.push({
        accountTitle,
        totalKop: accountTotalKop.toString(),
        latestOperationTime: allItems[0]?.operationTime || "",
        clients,
      });
    }

    accounts.sort((a, b) => {
      const amountDiff = Number(BigInt(b.totalKop) - BigInt(a.totalKop));
      if (amountDiff !== 0) return amountDiff;
      return a.accountTitle.localeCompare(b.accountTitle, "uk");
    });

    const totalKop = accounts.reduce((sum, account) => sum + BigInt(account.totalKop), 0n);
    const [year, month, day] = kyivDay.split("-");
    return {
      kyivDay,
      dayLabel: `${day}.${month}.${year}`,
      totalKop: totalKop.toString(),
      accounts,
    };
  });

  days.sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  return days;
}

function findAltegioClientOnDay(
  altegioDays: AltegioDayGroup[],
  kyivDay: string,
  payerNameHint: string,
  amountKop?: string | null,
): { account: AltegioDayAccountRow; client: AltegioDayAccountClient } | null {
  const day = altegioDays.find((item) => item.kyivDay === kyivDay);
  if (!day) return null;

  for (const account of day.accounts) {
    for (const client of account.clients) {
      if (!personNamesMatch(client.payerName, payerNameHint)) continue;
      if (amountKop && !altegioClientMatchesAmount(client, amountKop)) continue;
      return { account, client };
    }
  }
  return null;
}

function payerNameHintFromBankMatch(
  bankRow: BankDayItemRow,
  match: IncomingReconciledMatch,
): string {
  const fromBank = bankCounterpartyLabel(bankRow);
  if (normalizePersonName(fromBank) && normalizePersonName(fromBank) !== "—") {
    return fromBank;
  }

  const note = match.reviewNote?.trim() || "";
  const fromNote = note.match(/^([^—–]+?)(?:\s*[—–-]\s*|\s+\d)/u);
  if (fromNote?.[1]?.trim()) return fromNote[1].trim();
  return fromBank;
}

function bankLinkedAmountHint(bankRow: BankDayItemRow): string {
  return bankFullAmountKop(bankRow).toString();
}

function findAltegioClientForLinkedFromBank(
  altegioDays: AltegioDayGroup[],
  preferredKyivDay: string,
  bankRow: BankDayItemRow,
  extraHints: Array<string | null | undefined> = [],
): {
  dayKyivDay: string;
  account: AltegioDayAccountRow;
  client: AltegioDayAccountClient;
} | null {
  const amountHint = bankLinkedAmountHint(bankRow);
  const hints = new Set<string>();
  for (const hint of [bankCounterpartyLabel(bankRow), ...extraHints]) {
    const trimmed = hint?.trim();
    if (trimmed && trimmed !== "—") hints.add(trimmed);
  }
  for (const hint of hints) {
    const found = findAltegioClientForLinked(altegioDays, preferredKyivDay, hint, amountHint);
    if (found) return found;
  }
  return null;
}

function filterEvaluatedLinkedDaysNotInDb(
  evaluatedDays: VisibleAlignedDayRow[],
  shownBankIds: Set<string>,
): VisibleAlignedDayRow[] {
  return evaluatedDays
    .map((day) => {
      const accountRows = day.accountRows.filter((row) => {
        const bankIds = row.bankGroup?.rows.map((item) => item.id) ?? [];
        return !bankIds.some((id) => shownBankIds.has(id));
      });
      if (accountRows.length === 0) return null;
      return { ...day, accountRows };
    })
    .filter((day): day is VisibleAlignedDayRow => day != null);
}

function findAltegioClientForLinked(
  altegioDays: AltegioDayGroup[],
  preferredKyivDay: string,
  payerNameHint: string,
  amountKop?: string | null,
): {
  dayKyivDay: string;
  account: AltegioDayAccountRow;
  client: AltegioDayAccountClient;
} | null {
  const onPreferred = findAltegioClientOnDay(altegioDays, preferredKyivDay, payerNameHint, amountKop);
  if (onPreferred) {
    return { dayKyivDay: preferredKyivDay, ...onPreferred };
  }

  // З точною сумою не шукаємо на інших днях — інакше завдаток 4 000 блокує платіж 18 200.
  if (amountKop) return null;

  const sortedDays = [...altegioDays].sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  for (const day of sortedDays) {
    if (day.kyivDay === preferredKyivDay) continue;
    const found = findAltegioClientOnDay(altegioDays, day.kyivDay, payerNameHint, amountKop);
    if (found) return { dayKyivDay: day.kyivDay, ...found };
  }
  return null;
}

function findAltegioAccountOnDay(
  altegioDays: AltegioDayGroup[],
  kyivDay: string,
  accountTitleHint: string,
  altegioAccountTitleHint: string | null,
): AltegioDayAccountRow | null {
  const day = altegioDays.find((item) => item.kyivDay === kyivDay);
  if (!day) return null;

  return (
    day.accounts.find((account) =>
      accountsMatchForReconcile(account.accountTitle, accountTitleHint, altegioAccountTitleHint),
    ) ?? null
  );
}

function resolveZavdatokDateLabel(
  displayKyivDay: string,
  bankRows: BankDayItemRow[],
  appointmentAt: string | null | undefined,
  isDeposit: boolean,
): string | null {
  if (appointmentAt) {
    return formatKyivDayLabel(kyivDayFromOperationTime(appointmentAt));
  }
  if (isDeposit) return null;

  const hasCrossDayBank = bankRows.some(
    (row) => !row.isDepositCashPlaceholder && kyivDayFromOperationTime(row.time) !== displayKyivDay,
  );
  if (hasCrossDayBank) return formatKyivDayLabel(displayKyivDay);
  return null;
}

function resolveZavdatokForOpenRow(
  accountRow: DayAccountAlignedRow,
  dayKyivDay: string,
  depositMatchByAltegioId: Map<number, DepositIncomingMatch>,
): DayAccountAlignedRow {
  const client = accountRow.altegioAccount?.clients.length === 1
    ? accountRow.altegioAccount.clients[0]
    : null;
  const bankRows = accountRow.bankGroup?.rows ?? [];

  let zapisDateLabel = accountRow.zapisDateLabel ?? null;
  let zavdatokPaymentDateLabel = accountRow.zavdatokPaymentDateLabel ?? null;

  if (accountRow.altegioAccount) {
    for (const altegioClient of accountRow.altegioAccount.clients) {
      for (const item of altegioClient.items) {
        if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
        const depMatch = depositMatchByAltegioId.get(item.altegioId);
        zavdatokPaymentDateLabel =
          zavdatokPaymentDateLabel
          ?? formatKyivDayLabel(depMatch?.paymentKyivDay ?? kyivDayFromOperationTime(item.operationTime));
        zapisDateLabel =
          zapisDateLabel
          ?? (depMatch?.appointmentAt
            ? formatKyivDayLabel(kyivDayFromOperationTime(depMatch.appointmentAt))
            : depMatch?.displayKyivDay
              ? formatKyivDayLabel(depMatch.displayKyivDay)
              : null);
      }
    }
  }

  if (!zapisDateLabel) {
    const crossDayLabel = resolveZavdatokDateLabel(dayKyivDay, bankRows, null, false);
    if (crossDayLabel) zapisDateLabel = crossDayLabel;
  }

  if (!zavdatokPaymentDateLabel && client) {
    zavdatokPaymentDateLabel = depositPaymentDateLabelFromClient(client);
  }

  const zapisMeta = client ? resolveZapisMetaForClient(client) : null;

  return {
    ...accountRow,
    zapisDateLabel,
    zavdatokPaymentDateLabel,
    zavdatokDateLabel: zapisDateLabel,
    zapisRecordId: accountRow.zapisRecordId ?? zapisMeta?.recordId ?? null,
  };
}

function summarizeLinkedDay(
  kyivDay: string,
  accountRows: DayAccountAlignedRow[],
): { altegio: AltegioDayGroup | null; bank: BankDayFlat | null } {
  let altegioTotalKop = 0n;
  const bankRows: BankDayItemRow[] = [];

  for (const row of accountRows) {
    if (row.altegioAccount) altegioTotalKop += BigInt(row.altegioAccount.totalKop);
    if (row.bankGroup) bankRows.push(...row.bankGroup.rows);
  }

  const dayLabel = formatKyivDayLabel(kyivDay);
  const bankTotals = sumBankRowsTotals(bankRows);

  return {
    altegio:
      altegioTotalKop > 0n
        ? {
            kyivDay,
            dayLabel,
            totalKop: altegioTotalKop.toString(),
            accounts: [],
          }
        : null,
    bank:
      bankRows.length > 0
        ? {
            kyivDay,
            dayLabel,
            rows: bankRows,
            ...bankTotals,
          }
        : null,
  };
}

function buildIncomingLinkedVisibleDays(
  incomingMatches: IncomingReconciledMatch[],
  depositBankIds: Set<string>,
  altegioDays: AltegioDayGroup[],
  bankDays: BankDayFlat[],
): VisibleAlignedDayRow[] {
  const bankRowById = new Map<string, BankDayItemRow>();
  for (const day of bankDays) {
    for (const row of day.rows) {
      bankRowById.set(row.id, row);
    }
  }

  type LinkedBucket = {
    displayKyivDay: string;
    accountTitle: string;
    payerKey: string;
    altegioAccount: AltegioDayAccountRow | null;
    altegioClient: AltegioDayAccountClient | null;
    bankRows: BankDayItemRow[];
    reviewNotes: string[];
    matchIds: string[];
  };

  const buckets = new Map<string, LinkedBucket>();

  for (const match of incomingMatches) {
    if (depositBankIds.has(match.bankStatementItemId)) continue;

    const bankRow = bankRowById.get(match.bankStatementItemId);
    if (!bankRow) continue;

    const displayKyivDay = match.kyivDay;
    const payerHint = payerNameHintFromBankMatch(bankRow, match);
    const isNamed = bankRowIsNamedIncomingMatch(bankRow, match.matchType);
    const isAcquiring = bankRowIsAcquiringIncomingMatch(bankRow, match.matchType);

    let altegioClient: AltegioDayAccountClient | null = null;
    let altegioAccount: AltegioDayAccountRow | null = null;
    let accountTitle = bankRow.altegioAccountTitle || bankRow.accountTitle;
    let payerKey = isNamed ? normalizePersonName(payerHint) || payerHint : "__acquiring__";
    let groupKyivDay = displayKyivDay;

    if (isNamed) {
      const found = findAltegioClientForLinkedFromBank(
        altegioDays,
        displayKyivDay,
        bankRow,
        [payerHint],
      );
      if (!found) continue;
      altegioClient = found.client;
      altegioAccount = found.account;
      accountTitle = found.account.accountTitle;
      payerKey = reconciledAltegioClientKey(found.client);
      groupKyivDay = found.dayKyivDay;
    } else if (isAcquiring) {
      const bankDay = bankDays.find((day) => day.kyivDay === displayKyivDay);
      altegioAccount = findAltegioAccountOnDay(
        altegioDays,
        displayKyivDay,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      );
      if (!altegioAccount || !bankDay) continue;
      if (!accountsMatchForReconcile(
        altegioAccount.accountTitle,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      )) {
        continue;
      }

      const evaluation = evaluateIncomingAccountReconcile(altegioAccount, bankDay);
      const batchMatch = evaluation.acquiringBatchMatches.find((batch) =>
        batch.bankRowIds.includes(bankRow.id),
      );
      const acquiringMatched = batchMatch != null;
      const individualAcquiringMatch = evaluation.acquiringClientMatches.find(
        (item) => item.bankRowId === bankRow.id,
      );

      let matchedClients = individualAcquiringMatch
        ? altegioAccount.clients.filter(
            (item) =>
              normalizePersonName(item.payerName) === normalizePersonName(individualAcquiringMatch.payerName)
              && item.totalKop === individualAcquiringMatch.amountKop,
          )
        : acquiringMatched
        ? evaluation.acquiringMatchedClients
          .map((matchedClient) =>
            altegioAccount!.clients.find(
              (item) =>
                normalizePersonName(item.payerName) === normalizePersonName(matchedClient.payerName)
                && item.totalKop === matchedClient.totalKop,
            ),
          )
          .filter((client): client is AltegioDayAccountClient => client != null)
        : altegioAccount.clients.filter((client) => {
            return BigInt(client.totalKop) === bankFullAmountKop(bankRow);
          });

      if (matchedClients.length === 0) {
        const found = findAltegioClientForLinkedFromBank(
          altegioDays,
          displayKyivDay,
          bankRow,
          [],
        );
        if (
          found
          && accountsMatchForReconcile(
            found.account.accountTitle,
            bankRow.accountTitle,
            bankRow.altegioAccountTitle,
          )
        ) {
          matchedClients = [found.client];
          altegioAccount = found.account;
        }
      }
      if (matchedClients.length === 0) continue;

      accountTitle = altegioAccount.accountTitle;
      const acquiringBucketKey = `${displayKyivDay}|${accountTitle}|acquiring|${bankRow.id}`;
      const existingAcquiringBucket = buckets.get(acquiringBucketKey);
      if (existingAcquiringBucket) {
        if (match.reviewNote?.trim()) existingAcquiringBucket.reviewNotes.push(match.reviewNote.trim());
        existingAcquiringBucket.matchIds.push(match.id);
        continue;
      }

      const batchAltegioAccount = buildAcquiringAltegioAccountRow(altegioAccount, matchedClients);
      if (!linkedRowAmountsMatch(batchAltegioAccount, [bankRow])) continue;

      const singleClientPayerKey = matchedClients.length === 1
        ? reconciledAltegioClientKey(matchedClients[0])
        : "__acquiring_batch__";

      buckets.set(acquiringBucketKey, {
        displayKyivDay,
        accountTitle,
        payerKey: singleClientPayerKey,
        altegioAccount: batchAltegioAccount,
        altegioClient: matchedClients.length === 1 ? matchedClients[0] : null,
        bankRows: [bankRow],
        reviewNotes: match.reviewNote?.trim() ? [match.reviewNote.trim()] : [],
        matchIds: [match.id],
      });
      continue;
    } else {
      altegioAccount = findAltegioAccountOnDay(
        altegioDays,
        displayKyivDay,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      );
      if (!altegioAccount) continue;
      accountTitle = altegioAccount.accountTitle;
    }

    const bucketKey = `${groupKyivDay}|${accountTitle}|${payerKey}`;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.bankRows.push(bankRow);
      if (match.reviewNote?.trim()) existing.reviewNotes.push(match.reviewNote.trim());
      existing.matchIds.push(match.id);
      if (!existing.altegioClient && altegioClient) {
        existing.altegioClient = altegioClient;
        existing.altegioAccount = altegioAccount;
      }
      continue;
    }

    buckets.set(bucketKey, {
      displayKyivDay: groupKyivDay,
      accountTitle,
      payerKey,
      altegioAccount,
      altegioClient,
      bankRows: [bankRow],
      reviewNotes: match.reviewNote?.trim() ? [match.reviewNote.trim()] : [],
      matchIds: [match.id],
    });
  }

  const byDisplayDay = new Map<string, DayAccountAlignedRow[]>();

  for (const bucket of buckets.values()) {
    const bankRows = bucket.bankRows.slice().sort((a, b) => b.time.localeCompare(a.time));
    const bankTotalKop = bankRows.reduce((sum, row) => sum + BigInt(row.amountKop), 0n);
    const bankGroup: BankAccountGroup = {
      accountTitle: bankRows[0]?.accountTitle || bucket.accountTitle,
      altegioAccountTitle: bankRows[0]?.altegioAccountTitle ?? null,
      rows: bankRows,
      totalKop: bankTotalKop.toString(),
    };

    let altegioAccountRow: AltegioDayAccountRow | null = null;
    if (bucket.altegioAccount) {
      altegioAccountRow = bucket.altegioAccount;
    } else if (bucket.altegioClient) {
      altegioAccountRow = {
        accountTitle: bucket.accountTitle,
        totalKop: bucket.altegioClient.totalKop,
        latestOperationTime: bucket.altegioClient.latestOperationTime,
        clients: [bucket.altegioClient],
      };
    }

    if (!altegioAccountRow || !linkedRowAmountsMatch(altegioAccountRow, bankRows)) continue;

    const accountRow: DayAccountAlignedRow = {
      matchKey: `incoming|${bucket.matchIds.join("+")}`,
      altegioAccount: altegioAccountRow,
      bankGroup,
      displayKyivDay: bucket.displayKyivDay,
      reviewNote: bucket.reviewNotes.length > 0 ? bucket.reviewNotes.join(" · ") : null,
      zapisDateLabel: bucket.altegioClient || bucket.payerKey === "__acquiring_batch__"
        ? formatKyivDayLabel(bucket.displayKyivDay)
        : null,
      zavdatokPaymentDateLabel: bucket.altegioClient
        ? depositPaymentDateLabelFromClient(bucket.altegioClient)
        : null,
      zapisRecordId: resolveClientRecordId(bucket.altegioClient),
    };

    if (hasAccountMismatchInRow(accountRow)) continue;

    if (!byDisplayDay.has(bucket.displayKyivDay)) byDisplayDay.set(bucket.displayKyivDay, []);
    byDisplayDay.get(bucket.displayKyivDay)!.push(accountRow);
  }

  return Array.from(byDisplayDay.entries())
    .map(([kyivDay, accountRows]) => {
      accountRows.sort((a, b) => {
        const nameA = a.altegioAccount?.clients[0]?.payerName || a.bankGroup?.rows[0]?.counterName || "";
        const nameB = b.altegioAccount?.clients[0]?.payerName || b.bankGroup?.rows[0]?.counterName || "";
        return nameA.localeCompare(nameB, "uk");
      });
      const summary = summarizeLinkedDay(kyivDay, accountRows);
      return {
        kyivDay,
        dayLabel: formatKyivDayLabel(kyivDay),
        altegio: summary.altegio,
        bank: summary.bank,
        accountRows,
      };
    })
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}

/** Зведені рядки з preview (ім'я+сума+рахунок), якщо ще немає запису в БД. */
function buildEvaluatedLinkedVisibleDays(
  evaluatedPairs: EvaluatedOpenReconcilePair[],
  skippedBankIds: Set<string>,
  skippedDepositAltegioIds: Set<number>,
  rawAltegioDays: AltegioDayGroup[],
  bankDays: BankDayFlat[],
): VisibleAlignedDayRow[] {
  if (evaluatedPairs.length === 0) return [];

  const bankRowById = new Map<string, BankDayItemRow>();
  for (const day of bankDays) {
    for (const row of day.rows) bankRowById.set(row.id, row);
  }

  const byDisplayDay = new Map<string, DayAccountAlignedRow[]>();
  const processedAcquiringBankIds = new Set<string>();

  for (const pair of evaluatedPairs) {
    if (skippedBankIds.has(pair.bankRowId)) continue;
    if (
      pair.kind === "deposit"
      && pair.altegioTransactionId != null
      && skippedDepositAltegioIds.has(pair.altegioTransactionId)
    ) {
      continue;
    }

    const bankRow = bankRowById.get(pair.bankRowId);
    if (!bankRow) continue;

    if (pair.kind === "deposit" && pair.altegioTransactionId != null) {
      const found = findAltegioClientForLinked(
        rawAltegioDays,
        pair.kyivDay,
        pair.payerName,
        bankLinkedAmountHint(bankRow),
      );
      if (!found) continue;
      const depositItem = found.client.items.find(
        (item) => item.altegioId === pair.altegioTransactionId
          || isDepositTopUpPaymentPurpose(item.paymentPurpose || ""),
      );
      if (!depositItem) continue;
      if (!accountsMatchForReconcile(
        found.account.accountTitle,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      )) {
        continue;
      }

      const altegioAccount: AltegioDayAccountRow = {
        accountTitle: found.account.accountTitle,
        totalKop: bankRow.amountKop,
        latestOperationTime: depositItem.operationTime,
        clients: [{
          payerName: found.client.payerName,
          totalKop: bankRow.amountKop,
          latestOperationTime: depositItem.operationTime,
          items: [{
            altegioId: depositItem.altegioId,
            recordId: depositItem.recordId,
            payerName: found.client.payerName,
            amountKop: bankRow.amountKop,
            accountTitle: found.account.accountTitle,
            operationTime: depositItem.operationTime,
            paymentPurpose: depositItem.paymentPurpose,
          }],
        }],
      };
      const accountRow: DayAccountAlignedRow = {
        matchKey: `evaluated-deposit|${pair.bankRowId}`,
        altegioAccount,
        bankGroup: {
          accountTitle: bankRow.accountTitle,
          altegioAccountTitle: bankRow.altegioAccountTitle,
          rows: [bankRow],
          totalKop: bankRow.amountKop,
        },
        isDepositMatch: true,
        displayKyivDay: pair.kyivDay,
        zavdatokPaymentDateLabel: formatKyivDayLabel(pair.kyivDay),
        zapisDateLabel: formatKyivDayLabel(found.dayKyivDay),
        zapisRecordId: depositItem.recordId,
      };
      if (hasAccountMismatchInRow(accountRow)) continue;
      if (!byDisplayDay.has(pair.kyivDay)) byDisplayDay.set(pair.kyivDay, []);
      byDisplayDay.get(pair.kyivDay)!.push(accountRow);
      continue;
    }

    if (pair.kind === "acquiring") {
      if (processedAcquiringBankIds.has(pair.bankRowId)) continue;
      processedAcquiringBankIds.add(pair.bankRowId);

      const bankDay = bankDays.find((day) => day.kyivDay === pair.kyivDay);
      let altegioAccount = findAltegioAccountOnDay(
        rawAltegioDays,
        pair.kyivDay,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      );
      if (!altegioAccount || !bankDay) continue;
      if (!accountsMatchForReconcile(
        altegioAccount.accountTitle,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      )) {
        continue;
      }

      const evaluation = evaluateIncomingAccountReconcile(altegioAccount, bankDay);
      const batchMatch = evaluation.acquiringBatchMatches.find((batch) =>
        batch.bankRowIds.includes(bankRow.id),
      );
      const acquiringMatched = batchMatch != null;
      const individualAcquiringMatch = evaluation.acquiringClientMatches.find(
        (item) => item.bankRowId === bankRow.id,
      );

      let matchedClients = individualAcquiringMatch
        ? altegioAccount.clients.filter(
            (item) =>
              normalizePersonName(item.payerName) === normalizePersonName(individualAcquiringMatch.payerName)
              && item.totalKop === individualAcquiringMatch.amountKop,
          )
        : acquiringMatched
        ? evaluation.acquiringMatchedClients
          .map((matchedClient) =>
            altegioAccount.clients.find(
              (item) =>
                normalizePersonName(item.payerName) === normalizePersonName(matchedClient.payerName)
                && item.totalKop === matchedClient.totalKop,
            ),
          )
          .filter((client): client is AltegioDayAccountClient => client != null)
        : altegioAccount.clients.filter((client) => {
            return BigInt(client.totalKop) === bankFullAmountKop(bankRow);
          });

      if (matchedClients.length === 0) {
        const found = findAltegioClientForLinkedFromBank(
          rawAltegioDays,
          pair.kyivDay,
          bankRow,
          pair.payerName !== "__acquiring_batch__" ? [pair.payerName] : [],
        );
        if (
          found
          && accountsMatchForReconcile(
            found.account.accountTitle,
            bankRow.accountTitle,
            bankRow.altegioAccountTitle,
          )
        ) {
          matchedClients = [found.client];
          altegioAccount = found.account;
        }
      }
      if (matchedClients.length === 0) continue;

      const batchAltegioAccount = buildAcquiringAltegioAccountRow(altegioAccount, matchedClients);
      if (!linkedRowAmountsMatch(batchAltegioAccount, [bankRow])) continue;

      const accountRow: DayAccountAlignedRow = {
        matchKey: `evaluated-acquiring|${pair.bankRowId}`,
        altegioAccount: batchAltegioAccount,
        bankGroup: {
          accountTitle: bankRow.accountTitle,
          altegioAccountTitle: bankRow.altegioAccountTitle,
          rows: [bankRow],
          totalKop: bankRow.amountKop,
        },
        displayKyivDay: pair.kyivDay,
        zapisDateLabel: formatKyivDayLabel(pair.kyivDay),
      };
      if (hasAccountMismatchInRow(accountRow)) continue;
      if (!byDisplayDay.has(pair.kyivDay)) byDisplayDay.set(pair.kyivDay, []);
      byDisplayDay.get(pair.kyivDay)!.push(accountRow);
      continue;
    }

    const found = findAltegioClientForLinkedFromBank(
      rawAltegioDays,
      pair.kyivDay,
      bankRow,
      [pair.payerName],
    );
    if (!found) continue;
    if (!accountsMatchForReconcile(
      found.account.accountTitle,
      bankRow.accountTitle,
      bankRow.altegioAccountTitle,
    )) {
      continue;
    }

    const linkedAmountKop = bankRow.amountKop;
    const altegioAccountRow: AltegioDayAccountRow = {
      accountTitle: found.account.accountTitle,
      totalKop: found.client.totalKop,
      latestOperationTime: found.client.latestOperationTime,
      clients: [found.client],
    };
    if (!linkedRowAmountsMatch(altegioAccountRow, [bankRow])) continue;

    const accountRow: DayAccountAlignedRow = {
      matchKey: `evaluated-${pair.kind}|${pair.bankRowId}|${pair.payerName}`,
      altegioAccount: altegioAccountRow,
      bankGroup: {
        accountTitle: bankRow.accountTitle,
        altegioAccountTitle: bankRow.altegioAccountTitle,
        rows: [bankRow],
        totalKop: bankRow.amountKop,
      },
      displayKyivDay: found.dayKyivDay,
      zapisDateLabel: formatKyivDayLabel(found.dayKyivDay),
      zavdatokPaymentDateLabel: depositPaymentDateLabelFromClient(found.client),
      zapisRecordId: resolveClientRecordId(found.client),
    };
    if (hasAccountMismatchInRow(accountRow)) continue;

    const dayKey = found.dayKyivDay;
    if (!byDisplayDay.has(dayKey)) byDisplayDay.set(dayKey, []);
    byDisplayDay.get(dayKey)!.push(accountRow);
  }

  return Array.from(byDisplayDay.entries())
    .map(([kyivDay, accountRows]) => {
      accountRows.sort((a, b) => {
        const nameA = a.altegioAccount?.clients[0]?.payerName || "";
        const nameB = b.altegioAccount?.clients[0]?.payerName || "";
        return nameA.localeCompare(nameB, "uk");
      });
      const summary = summarizeLinkedDay(kyivDay, accountRows);
      return {
        kyivDay,
        dayLabel: formatKyivDayLabel(kyivDay),
        altegio: summary.altegio,
        bank: summary.bank,
        accountRows,
      };
    })
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}

function dbLinkedBankIds(
  incomingMatches: IncomingReconciledMatch[],
  depositBankIdsClaimed: Set<string>,
): Set<string> {
  const ids = new Set<string>(depositBankIdsClaimed);
  for (const match of incomingMatches) ids.add(match.bankStatementItemId);
  return ids;
}

function excludeDepositFromByPayer(
  byPayer: AltegioPayerAggregate[],
  depositAltegioIds: Set<number>,
): AltegioPayerAggregate[] {
  if (depositAltegioIds.size === 0) return byPayer;

  return byPayer
    .map((payer) => {
      const items = payer.items.filter((item) => !depositAltegioIds.has(item.altegioId));
      if (items.length === 0) return null;
      const totalKop = items.reduce((sum, item) => sum + BigInt(item.amountKop), 0n);
      return {
        payerName: payer.payerName,
        totalKop: totalKop.toString(),
        transactionCount: items.length,
        items,
      };
    })
    .filter((payer): payer is AltegioPayerAggregate => payer != null);
}

function buildRecordIdByAltegioId(byPayer: AltegioPayerAggregate[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const payer of byPayer) {
    for (const item of payer.items) {
      if (item.recordId) map.set(item.altegioId, item.recordId);
    }
  }
  return map;
}

function resolveClientRecordId(client: AltegioDayAccountClient | null): number | null {
  if (!client) return null;
  for (const item of client.items) {
    if (item.recordId) return item.recordId;
  }
  return null;
}

/** ID запису + день для посилання «Запис» в Altegio timetable. */
function resolveZapisMetaForClient(
  client: AltegioDayAccountClient | null,
): { recordId: number; dateLabel: string; kyivDay: string } | null {
  if (!client) return null;
  for (const item of client.items) {
    if (!item.recordId || item.recordId <= 0) continue;
    const kyivDay = kyivDayFromOperationTime(item.operationTime);
    return {
      recordId: item.recordId,
      dateLabel: formatKyivDayLabel(kyivDay),
      kyivDay,
    };
  }
  return null;
}

function resolveDepositRealizationMeta(
  accountRow: DayAccountAlignedRow,
  client: AltegioDayAccountClient | null,
  index?: DepositRealizationIndex,
): DepositRealizationMeta | undefined {
  if (!index) return undefined;
  const fromKey = index.byMatchKey[accountRow.matchKey];
  if (fromKey) return fromKey;
  const altegioId = resolveClientAltegioTransactionId(client);
  if (altegioId != null && index.byAltegioId[altegioId]) {
    return index.byAltegioId[altegioId];
  }
  return undefined;
}

function resolveZapisLinkProps(
  client: AltegioDayAccountClient | null,
  accountRow: DayAccountAlignedRow,
  dayKyivDay: string,
  options?: {
    realizationMeta?: DepositRealizationMeta;
    /** Для реалізованих завдатків — показувати номер запису замість підпису «Запис». */
    showRecordNumber?: boolean;
  },
): { label: string | null; subtitle: string | null; href: string | null } {
  const meta = resolveZapisMetaForClient(client);
  const realizationMeta = options?.realizationMeta;
  const recordId =
    accountRow.zapisRecordId
    ?? meta?.recordId
    ?? realizationMeta?.recordId
    ?? null;

  const isRealizedDeposit = options?.showRecordNumber
    ?? realizationMeta?.status === "realized";

  const subtitle =
    accountRow.zapisDateLabel
    ?? accountRow.zavdatokDateLabel
    ?? (realizationMeta?.recordAt
      ? formatKyivDayLabel(kyivDayFromOperationTime(realizationMeta.recordAt))
      : null)
    ?? meta?.dateLabel
    ?? null;
  const kyivDay =
    accountRow.displayKyivDay
    ?? (realizationMeta?.recordAt ? kyivDayFromOperationTime(realizationMeta.recordAt) : null)
    ?? meta?.kyivDay
    ?? dayKyivDay;

  if (recordId && isRealizedDeposit) {
    return {
      label: String(recordId),
      subtitle,
      href: buildAltegioRecordTimetableUrl(recordId, kyivDay),
    };
  }

  if (!recordId) {
    return { label: null, subtitle: null, href: null };
  }

  return {
    label: "Запис",
    subtitle,
    href: buildAltegioRecordTimetableUrl(recordId, kyivDay),
  };
}

function resolveClientAltegioTransactionId(client: AltegioDayAccountClient | null): number | null {
  const altegioId = client?.items[0]?.altegioId;
  return altegioId && altegioId > 0 ? altegioId : null;
}

function resolveAccountAltegioTransactionId(account: AltegioDayAccountRow | null): number | null {
  if (!account) return null;
  for (const client of account.clients) {
    const altegioId = resolveClientAltegioTransactionId(client);
    if (altegioId) return altegioId;
  }
  return null;
}

function buildAcquiringAltegioAccountRow(
  altegioAccount: AltegioDayAccountRow,
  matchedClients: AltegioDayAccountClient[],
): AltegioDayAccountRow {
  const clients = matchedClients.slice().sort((a, b) => {
    const timeDiff = b.latestOperationTime.localeCompare(a.latestOperationTime);
    if (timeDiff !== 0) return timeDiff;
    return a.payerName.localeCompare(b.payerName, "uk");
  });
  const totalKop = clients.reduce((sum, client) => sum + BigInt(client.totalKop), 0n);
  return {
    accountTitle: altegioAccount.accountTitle,
    totalKop: totalKop.toString(),
    latestOperationTime: clients[0]?.latestOperationTime || altegioAccount.latestOperationTime,
    clients,
  };
}

function linkedRowAmountsMatch(altegioAccount: AltegioDayAccountRow, bankRows: BankDayItemRow[]): boolean {
  const altegioTotal = BigInt(altegioAccount.totalKop);
  const bankFull = bankRows.reduce((sum, row) => sum + bankFullAmountKop(row), 0n);
  return altegioTotal === bankFull;
}

function buildDepositLinkedVisibleDays(
  depositMatches: DepositIncomingMatch[],
  bankDays: BankDayFlat[],
  mismatchDepositIds: Set<string>,
  recordIdByAltegioId: Map<number, number>,
): VisibleAlignedDayRow[] {
  if (depositMatches.length === 0) return [];

  const bankRowById = new Map<string, BankDayItemRow>();
  for (const day of bankDays) {
    for (const row of day.rows) {
      bankRowById.set(row.id, row);
    }
  }

  const byDisplayDay = new Map<string, DayAccountAlignedRow[]>();

  for (const match of depositMatches) {
    if (mismatchDepositIds.has(match.id)) continue;
    if (isCashReconcileAccount(match.accountTitle || "")) continue;
    if (!match.bankStatementItemId) continue;

    const bankRow = bankRowById.get(match.bankStatementItemId);
    if (!bankRow) continue;

    const recordId = recordIdByAltegioId.get(match.altegioTransactionId) ?? null;

    const clientItems: AltegioDayPayerRow[] = [{
      altegioId: match.altegioTransactionId,
      recordId,
      payerName: match.payerName,
      amountKop: match.amountKopiykas,
      accountTitle: match.accountTitle || "— без рахунку —",
      operationTime: match.operationTime || `${match.paymentKyivDay}T12:00:00.000Z`,
      paymentPurpose: "Поповнення рахунку",
    }];

    const altegioAccount: AltegioDayAccountRow = {
      accountTitle: match.accountTitle || "— без рахунку —",
      totalKop: match.amountKopiykas,
      latestOperationTime: match.operationTime || "",
      clients: [{
        payerName: match.payerName,
        totalKop: match.amountKopiykas,
        latestOperationTime: match.operationTime || "",
        items: clientItems,
      }],
    };

    const bankGroup: BankAccountGroup = {
      accountTitle: bankRow.accountTitle,
      altegioAccountTitle: bankRow.altegioAccountTitle,
      rows: [bankRow],
      totalKop: bankRow.amountKop,
    };

    const zapisDateLabel = match.appointmentAt
      ? formatKyivDayLabel(kyivDayFromOperationTime(match.appointmentAt))
      : null;

    const accountRow: DayAccountAlignedRow = {
      matchKey: `deposit|${match.id}`,
      altegioAccount,
      bankGroup,
      isDepositMatch: true,
      reviewNote: match.reviewNote,
      displayKyivDay: match.displayKyivDay,
      zapisDateLabel,
      zavdatokPaymentDateLabel: formatKyivDayLabel(match.paymentKyivDay),
      zapisRecordId: recordId,
    };

    const dayKey = match.displayKyivDay;
    if (!byDisplayDay.has(dayKey)) byDisplayDay.set(dayKey, []);
    byDisplayDay.get(dayKey)!.push(accountRow);
  }

  return Array.from(byDisplayDay.entries())
    .map(([kyivDay, accountRows]) => {
      const summary = summarizeLinkedDay(kyivDay, accountRows);
      return {
        kyivDay,
        dayLabel: formatKyivDayLabel(kyivDay),
        altegio: summary.altegio,
        bank: summary.bank,
        accountRows,
      };
    })
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}

function mergeVisibleAlignedDays(
  regularDays: VisibleAlignedDayRow[],
  depositDays: VisibleAlignedDayRow[],
): VisibleAlignedDayRow[] {
  if (depositDays.length === 0) return regularDays;

  const byDay = new Map<string, VisibleAlignedDayRow>();
  for (const day of regularDays) {
    byDay.set(day.kyivDay, day);
  }
  for (const day of depositDays) {
    const existing = byDay.get(day.kyivDay);
    if (existing) {
      byDay.set(day.kyivDay, {
        ...existing,
        accountRows: [...existing.accountRows, ...day.accountRows],
      });
    } else {
      byDay.set(day.kyivDay, day);
    }
  }
  return Array.from(byDay.values()).sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}

function formatClientCount(count: number): string {
  if (count === 1) return "1 клієнт";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} клієнти`;
  return `${count} клієнтів`;
}

function clientHasDepositPayment(client: AltegioDayAccountClient): boolean {
  return client.items.some((item) => isDepositTopUpPaymentPurpose(item.paymentPurpose || ""));
}

function accountRowIsDeposit(accountRow: DayAccountAlignedRow): boolean {
  if (accountRow.isDepositMatch) return true;
  return accountRow.altegioAccount?.clients.some((client) => clientHasDepositPayment(client)) ?? false;
}

function depositPaymentDateLabelFromClient(client: AltegioDayAccountClient | null): string | null {
  if (!client) return null;
  const depositItem = client.items.find((item) => isDepositTopUpPaymentPurpose(item.paymentPurpose || ""));
  if (!depositItem) return null;
  return formatKyivDayLabel(kyivDayFromOperationTime(depositItem.operationTime));
}

function depositPaymentDateLabelFromAccountRow(accountRow: DayAccountAlignedRow): string | null {
  if (accountRow.zavdatokPaymentDateLabel) return accountRow.zavdatokPaymentDateLabel;
  const client = accountRow.altegioAccount?.clients.length === 1
    ? accountRow.altegioAccount.clients[0]
    : null;
  const fromClient = depositPaymentDateLabelFromClient(client);
  if (fromClient) return fromClient;
  if (accountRow.isDepositMatch && accountRow.displayKyivDay) {
    return formatKyivDayLabel(accountRow.displayKyivDay);
  }
  return null;
}

function buildFullyLinkedVisibleDays(
  incomingMatches: IncomingReconciledMatch[],
  depositBankIdsToSkip: Set<string>,
  altegioDays: AltegioDayGroup[],
  bankDays: BankDayFlat[],
  depositMatches: DepositIncomingMatch[],
  mismatchDepositMatchIds: Set<string>,
  recordIdByAltegioId: Map<number, number>,
): VisibleAlignedDayRow[] {
  const incomingLinkedDays = buildIncomingLinkedVisibleDays(
    incomingMatches,
    depositBankIdsToSkip,
    altegioDays,
    bankDays,
  );
  const depositDays = buildDepositLinkedVisibleDays(
    depositMatches,
    bankDays,
    mismatchDepositMatchIds,
    recordIdByAltegioId,
  );
  return mergeVisibleAlignedDays(incomingLinkedDays, depositDays);
}

function completeReconciledBankIdsFromLinkedDays(
  linkedDays: VisibleAlignedDayRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const day of linkedDays) {
    for (const row of day.accountRows) {
      for (const bankRow of row.bankGroup?.rows ?? []) {
        ids.add(bankRow.id);
      }
    }
  }
  return ids;
}

function reconciledAltegioPayerKeysFromLinkedDays(
  linkedDays: VisibleAlignedDayRow[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const day of linkedDays) {
    for (const row of day.accountRows) {
      if (!row.altegioAccount) continue;
      const dayKey = row.displayKyivDay ?? day.kyivDay;
      for (const client of row.altegioAccount.clients) {
        const payerKey = reconciledAltegioClientKey(client);
        if (!payerKey) continue;
        if (!map.has(dayKey)) map.set(dayKey, new Set());
        map.get(dayKey)!.add(payerKey);
      }
    }
  }
  return map;
}

/** Що приховувати з «Не зведених» — лише пари, які реально є у вкладці «Зведені». */
function buildOpenHiddenFromLinkedDays(
  linkedDays: VisibleAlignedDayRow[],
): {
  bankIds: Set<string>;
  altegioPayersByDay: Map<string, Set<string>>;
} {
  return {
    bankIds: completeReconciledBankIdsFromLinkedDays(linkedDays),
    altegioPayersByDay: reconciledAltegioPayerKeysFromLinkedDays(linkedDays),
  };
}

/** Доповнити приховування з БД, якщо запис зведення є, але linked-рядок не збудувався. */
function supplementOpenHiddenFromDbMatches(
  hidden: {
    bankIds: Set<string>;
    altegioPayersByDay: Map<string, Set<string>>;
  },
  incomingMatches: IncomingReconciledMatch[],
  depositBankIds: Set<string>,
  altegioDays: AltegioDayGroup[],
  bankDays: BankDayFlat[],
): void {
  const bankRowById = new Map<string, BankDayItemRow>();
  for (const day of bankDays) {
    for (const row of day.rows) bankRowById.set(row.id, row);
  }

  for (const match of incomingMatches) {
    if (depositBankIds.has(match.bankStatementItemId)) continue;
    const bankRow = bankRowById.get(match.bankStatementItemId);
    if (!bankRow) continue;

    hidden.bankIds.add(match.bankStatementItemId);

    const found = findAltegioClientForLinkedFromBank(
      altegioDays,
      match.kyivDay,
      bankRow,
      [],
    );
    if (!found) continue;
    if (!accountsMatchForReconcile(
      found.account.accountTitle,
      bankRow.accountTitle,
      bankRow.altegioAccountTitle,
    )) {
      continue;
    }

    const dayKey = found.dayKyivDay;
    const payerKey = reconciledAltegioClientKey(found.client);
    if (!hidden.altegioPayersByDay.has(dayKey)) hidden.altegioPayersByDay.set(dayKey, new Set());
    hidden.altegioPayersByDay.get(dayKey)!.add(payerKey);
  }
}

/** Altegio-завдатки з реальною парою банку (або готівка) — прибираємо з «Не зведених». */
function activeDepositAltegioIdsFromMatches(
  depositMatches: DepositIncomingMatch[],
  mismatchDepositMatchIds: Set<string>,
  bankRowById: Map<string, BankDayItemRow>,
): Set<number> {
  const ids = new Set<number>();
  for (const match of depositMatches) {
    if (mismatchDepositMatchIds.has(match.id)) continue;
    if (isCashReconcileAccount(match.accountTitle || "")) continue;
    if (!match.bankStatementItemId) continue;

    if (isDepositMatchAccountMismatch(match, bankRowById)) continue;
    ids.add(match.altegioTransactionId);
  }
  return ids;
}

function stripReconciledClientsFromOpenRow(
  accountRow: DayAccountAlignedRow,
  reconciledPayers: Set<string> | undefined,
): DayAccountAlignedRow | null {
  if (!reconciledPayers?.size) return accountRow;
  if (!accountRow.altegioAccount) {
    return accountRow.bankGroup ? accountRow : null;
  }

  const remainingClients = accountRow.altegioAccount.clients.filter(
    (client) => !reconciledPayers.has(reconciledAltegioClientKey(client)),
  );

  if (remainingClients.length === 0) {
    return accountRow.bankGroup?.rows.length ? { ...accountRow, altegioAccount: null } : null;
  }

  if (remainingClients.length === accountRow.altegioAccount.clients.length) {
    return accountRow;
  }

  const allItems = remainingClients.flatMap((client) => client.items);
  allItems.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
  const totalKop = remainingClients.reduce((sum, client) => sum + BigInt(client.totalKop), 0n);

  return {
    ...accountRow,
    altegioAccount: {
      ...accountRow.altegioAccount,
      clients: remainingClients,
      totalKop: totalKop.toString(),
      latestOperationTime: allItems[0]?.operationTime || accountRow.altegioAccount.latestOperationTime,
    },
  };
}

function DepositPaymentBadge() {
  return (
    <span className="ml-1 inline-flex shrink-0 rounded bg-amber-200 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-950">
      {DEPOSIT_PAYMENT_LABEL}
    </span>
  );
}

function ClientNameWithDepositBadge({
  name,
  showDeposit,
  reviewNote,
}: {
  name: string;
  showDeposit: boolean;
  reviewNote?: string | null;
}) {
  return (
    <span className="inline-flex max-w-full flex-col gap-0.5">
      <span className="inline-flex max-w-full items-center gap-0.5">
        <span className="truncate">{name}</span>
        {showDeposit ? <DepositPaymentBadge /> : null}
      </span>
      {showDeposit ? <MatchReviewNote note={reviewNote} tone="deposit" /> : null}
    </span>
  );
}

function MatchReviewNote({
  note,
  tone = "default",
}: {
  note: string | null | undefined;
  tone?: "default" | "deposit";
}) {
  const text = note?.trim();
  if (!text) return null;
  const className =
    tone === "deposit"
      ? "text-[8px] leading-tight text-amber-900/85 line-clamp-2"
      : "text-[8px] leading-tight text-gray-500 line-clamp-2";
  return (
    <span className={className} title={text}>
      {text}
    </span>
  );
}

function LabelStackCell({
  label,
  subtitle,
  tone = "default",
  className = "",
  rowSpan,
  href,
}: {
  label: string | null;
  subtitle?: string | null;
  tone?: "deposit" | "zapis" | "default";
  className?: string;
  rowSpan?: number;
  href?: string | null;
}) {
  const labelClass =
    tone === "deposit"
      ? "text-[9px] font-bold uppercase tracking-wide text-amber-900"
      : tone === "zapis"
        ? "text-[9px] font-bold uppercase tracking-wide text-sky-900"
        : "text-[9px] font-medium text-gray-700";

  const linkClass = tone === "zapis"
    ? "hover:text-sky-700 hover:underline"
    : tone === "deposit"
      ? "hover:text-amber-800 hover:underline"
      : "hover:underline";

  if (!label?.trim() && !subtitle?.trim()) {
    return (
      <td rowSpan={rowSpan} className={`px-1 py-0.5 text-center align-top text-gray-300 ${className}`}>—</td>
    );
  }

  if (href) {
    return (
      <td rowSpan={rowSpan} className={`px-1 py-0.5 text-center align-top ${className}`}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`block ${linkClass}`}
          title="Відкрити запис в Altegio"
        >
          {label?.trim() ? <div className={labelClass}>{label}</div> : null}
          {subtitle?.trim() ? (
            <div className="text-[8px] leading-tight tabular-nums text-gray-600">{subtitle}</div>
          ) : null}
        </a>
      </td>
    );
  }

  const labelContent = label?.trim() ? (
    <div className={labelClass}>{label}</div>
  ) : null;

  return (
    <td rowSpan={rowSpan} className={`px-1 py-0.5 text-center align-top ${className}`}>
      {labelContent}
      {subtitle?.trim() ? (
        <div className="text-[8px] leading-tight tabular-nums text-gray-600">{subtitle}</div>
      ) : null}
    </td>
  );
}

function AltegioAmountLink({
  amountKop,
  altegioTransactionId,
  className = "",
}: {
  amountKop: string;
  altegioTransactionId: number | null;
  className?: string;
}) {
  const text = formatMoney(amountKop);
  if (!altegioTransactionId) return <>{text}</>;
  return (
    <a
      href={buildAltegioTransactionEditUrl(altegioTransactionId)}
      target="_blank"
      rel="noopener noreferrer"
      className={`hover:underline ${className}`}
      title="Відкрити платіж в Altegio"
    >
      {text}
    </a>
  );
}

function BankAmountLink({
  bankRow,
  amountKop,
  className = "",
}: {
  bankRow: Pick<BankIncomingItem, "id" | "time"> & { isDepositCashPlaceholder?: boolean } | null;
  amountKop: string;
  className?: string;
}) {
  const text = formatMoney(amountKop);
  if (!bankRow?.id || bankRow.isDepositCashPlaceholder) return <>{text}</>;
  return (
    <a
      href={buildBankStatementItemUrl(bankRow.id, bankRow.time)}
      className={`hover:underline ${className}`}
      title="Відкрити в розділі Банк"
    >
      {text}
    </a>
  );
}

function ZavdatokDateCell({ dateLabel }: { dateLabel: string | null | undefined }) {
  return (
    <td className="whitespace-nowrap px-1 py-0.5 text-center tabular-nums text-amber-950">
      {dateLabel?.trim() ? dateLabel : <span className="text-gray-300">—</span>}
    </td>
  );
}

const LINKED_TABLE_CLASS = "w-full table-fixed text-left";
const LINKED_TABLE_COLUMN_COUNT = 16;

type LinkedAccountGroup = {
  accountTitle: string;
  accountRows: DayAccountAlignedRow[];
  clients: AltegioDayAccountClient[];
  bankRows: BankDayItemRow[];
  altegioTotalKop: string;
  bankTotalKop: string;
};

function groupLinkedAccountRows(accountRows: DayAccountAlignedRow[]): LinkedAccountGroup[] {
  const byAccount = new Map<string, DayAccountAlignedRow[]>();

  for (const row of accountRows) {
    const title = row.altegioAccount?.accountTitle
      || row.bankGroup?.altegioAccountTitle
      || row.bankGroup?.accountTitle
      || "—";
    if (!byAccount.has(title)) byAccount.set(title, []);
    byAccount.get(title)!.push(row);
  }

  return Array.from(byAccount.entries()).map(([accountTitle, rows]) => {
    const clients: AltegioDayAccountClient[] = [];
    const bankRowById = new Map<string, BankDayItemRow>();

    for (const row of rows) {
      for (const client of row.altegioAccount?.clients ?? []) {
        const key = `${client.payerName}|${client.totalKop}`;
        if (!clients.some((item) => `${item.payerName}|${item.totalKop}` === key)) {
          clients.push(client);
        }
      }
      for (const bankRow of row.bankGroup?.rows ?? []) {
        bankRowById.set(bankRow.id, bankRow);
      }
    }

    const bankRows = Array.from(bankRowById.values()).sort((a, b) => b.time.localeCompare(a.time));
    const altegioTotalKop = clients
      .reduce((sum, client) => sum + BigInt(client.totalKop), 0n)
      .toString();
    const bankTotalKop = bankRows
      .reduce((sum, row) => sum + bankFullAmountKop(row), 0n)
      .toString();

    return {
      accountTitle,
      accountRows: rows,
      clients,
      bankRows,
      altegioTotalKop,
      bankTotalKop,
    };
  });
}

function countLinkedGroupVisualRows(group: LinkedAccountGroup): number {
  return Math.max(group.clients.length, group.bankRows.length, 1);
}

function findAccountRowForClient(
  group: LinkedAccountGroup,
  client: AltegioDayAccountClient | null,
): DayAccountAlignedRow {
  if (!client) return group.accountRows[0]!;
  return group.accountRows.find((row) =>
    row.altegioAccount?.clients.some(
      (item) =>
        normalizePersonName(item.payerName) === normalizePersonName(client.payerName)
        && item.totalKop === client.totalKop,
    ),
  ) ?? group.accountRows[0]!;
}

function LinkedColGroup() {
  return (
    <colgroup>
      <col className="w-[6%]" />
      <col className="w-[9%]" />
      <col className="w-[5%]" />
      <col className="w-[6%]" />
      <col className="w-[6%]" />
      <col className="w-[9%]" />
      <col className="w-[6%]" />
      <col className="w-[6%]" />
      <col className="w-[6%]" />
      <col className="w-[6%]" />
      <col className="w-[9%]" />
      <col className="w-[7%]" />
      <col className="w-[12%]" />
      <col className="w-[6%]" />
      <col className="w-[5%]" />
      <col className="w-[6%]" />
    </colgroup>
  );
}

function DepositsColGroup() {
  return (
    <colgroup>
      <col className="w-[5%]" />
      <col className="w-[8%]" />
      <col className="w-[5%]" />
      <col className="w-[5%]" />
      <col className="w-[5%]" />
      <col className="w-[8%]" />
      <col className="w-[6%]" />
      <col className="w-[6%]" />
      <col className="w-[6%]" />
      <col className="w-[6%]" />
      <col className="w-[8%]" />
      <col className="w-[7%]" />
      <col className="w-[11%]" />
      <col className="w-[5%]" />
      <col className="w-[5%]" />
      <col className="w-[5%]" />
    </colgroup>
  );
}

function countLinkedDayBodyRows(day: VisibleAlignedDayRow): number {
  return groupLinkedAccountRows(day.accountRows)
    .reduce((sum, group) => sum + countLinkedGroupVisualRows(group), 0);
}

type LinkedIncomingDaysScrollProps = {
  days: VisibleAlignedDayRow[];
  depositBankIds: Set<string>;
  bankReviewNotesByItemId: Map<string, string>;
  depositRealizationIndex?: DepositRealizationIndex;
  /** У секції реалізованих завдатків — номер запису в колонці «Запис». */
  showRecordNumberInZapis?: boolean;
};

function LinkedIncomingDaysScroll({
  days,
  depositBankIds,
  bankReviewNotesByItemId,
  depositRealizationIndex,
  showRecordNumberInZapis = false,
}: LinkedIncomingDaysScrollProps) {
  const todayKyiv = getKyivTodayYmd();
  const firstPastDayIndex = days.findIndex((day) => day.kyivDay < todayKyiv);
  const showTodayDivider = firstPastDayIndex > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <table className={`${LINKED_TABLE_CLASS} text-[10px]`}>
        <LinkedColGroup />
        <thead className="sticky top-0 z-10 bg-white shadow-sm">
          <tr className="border-b border-gray-300 bg-slate-200 text-[9px] uppercase">
            <th rowSpan={2} className="border-r border-gray-300 px-1 py-1 font-semibold text-gray-700">
              День
            </th>
            <th colSpan={7} className="border-r-2 border-gray-400 px-1 py-1 text-left font-semibold text-emerald-900">
              Altegio
            </th>
            <th colSpan={8} className="px-1 py-1 text-left font-semibold text-blue-900">
              Банк
            </th>
          </tr>
          <tr className="border-b border-gray-200 bg-gray-50/95 text-[9px] uppercase text-gray-500">
            <th className="px-1 py-0.5 font-medium">Клієнт</th>
            <th className="px-1 py-0.5 font-medium">Час</th>
            <th className="px-1 py-0.5 text-center font-medium">Завдаток</th>
            <th className="px-1 py-0.5 text-center font-medium">Запис</th>
            <th className="px-1 py-0.5 font-medium">Рахунок</th>
            <th className="px-1 py-0.5 text-right font-medium">Платіж</th>
            <th className="border-r-2 border-gray-400 px-1 py-0.5 text-right font-medium">Сума</th>
            <th className="px-1 py-0.5 text-right font-semibold text-green-800">Сума</th>
            <th className="px-1 py-0.5 text-right font-medium">Платіж</th>
            <th className="px-1 py-0.5 font-medium">Рахунок</th>
            <th className="px-1 py-0.5 font-medium">Дата</th>
            <th className="px-1 py-0.5 font-medium">Контрагент</th>
            <th className="px-1 py-0.5 font-medium">Тип</th>
            <th className="px-1 py-0.5 text-right font-medium">Ком.</th>
            <th className="px-1 py-0.5 text-right font-medium">Зарах.</th>
          </tr>
        </thead>
        <tbody>
          {days.flatMap((day, dayIndex) => {
            const rows = [
              <LinkedIncomingDayBody
                key={day.kyivDay}
                day={day}
                dayBlockIndex={dayIndex}
                depositBankIds={depositBankIds}
                bankReviewNotesByItemId={bankReviewNotesByItemId}
                depositRealizationIndex={depositRealizationIndex}
                showRecordNumberInZapis={showRecordNumberInZapis}
              />,
            ];
            if (showTodayDivider && dayIndex === firstPastDayIndex - 1) {
              rows.push(
                <tr key="linked-today-divider">
                  <td
                    colSpan={LINKED_TABLE_COLUMN_COUNT}
                    className="border-t-4 border-black p-0 leading-none"
                    aria-hidden
                  />
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

type LinkedIncomingDayBodyProps = {
  day: VisibleAlignedDayRow;
  dayBlockIndex: number;
  depositBankIds: Set<string>;
  bankReviewNotesByItemId: Map<string, string>;
  depositRealizationIndex?: DepositRealizationIndex;
  showRecordNumberInZapis?: boolean;
  depositsTabMode?: boolean;
  depositBalanceLookup?: ReturnType<typeof buildDepositBalanceLookup> | null;
  balancesLoading?: boolean;
  clientIdByAltegioId?: Map<number, number>;
};

function LinkedIncomingDayBody({
  day,
  dayBlockIndex,
  depositBankIds,
  bankReviewNotesByItemId,
  depositRealizationIndex,
  showRecordNumberInZapis = false,
  depositsTabMode = false,
  depositBalanceLookup,
  balancesLoading = false,
  clientIdByAltegioId,
}: LinkedIncomingDayBodyProps) {
  const blockBg = linkedBlockBackground(dayBlockIndex);
  const groups = groupLinkedAccountRows(day.accountRows);
  const dayRowCount = countLinkedDayBodyRows(day);
  const rows: JSX.Element[] = [];
  let dayLabelRendered = false;

  for (const group of groups) {
    const groupRowCount = countLinkedGroupVisualRows(group);
    let groupTotalsRendered = false;
    const pairColorKey = resolvePairAccountColorKey(
      group.accountTitle,
      group.bankRows[0]?.accountTitle ?? group.accountTitle,
      group.bankRows[0]?.altegioAccountTitle ?? null,
    );

    for (let index = 0; index < groupRowCount; index += 1) {
      const client = group.clients[index] ?? null;
      const singleBankShared = group.bankRows.length === 1;
      const bankRowSpan = singleBankShared ? groupRowCount : 1;
      const showBankBlock = group.bankRows.length > 0
        && (singleBankShared ? index === 0 : index < group.bankRows.length);
      const bankRow = showBankBlock
        ? group.bankRows[singleBankShared ? 0 : index] ?? null
        : null;
      const accountRow = findAccountRowForClient(group, client);
      const isDeposit = accountRowIsDeposit(accountRow);
      const isDepositRow = isDeposit || (client != null && clientHasDepositPayment(client));
      const zavdatokPaymentDate = depositPaymentDateLabelFromAccountRow(accountRow);
      const realizationMeta = resolveDepositRealizationMeta(accountRow, client, depositRealizationIndex);
      const zapisLink = resolveZapisLinkProps(client, accountRow, day.kyivDay, {
        realizationMeta,
        showRecordNumber: showRecordNumberInZapis,
      });
      const clientAltegioId = resolveClientAltegioTransactionId(client);
      const realizationStatus: DepositRealizationStatus = showRecordNumberInZapis
        ? "realized"
        : realizationMeta?.status ?? "active";
      const payCellToneClass = depositsTabMode
        ? realizationStatus === "realized"
          ? "bg-gray-200 text-gray-500"
          : "bg-emerald-100 text-emerald-900"
        : "text-emerald-800";
      const depositClientId = clientAltegioId != null
        ? clientIdByAltegioId?.get(clientAltegioId) ?? null
        : null;
      const rowDepositBalance = depositsTabMode && depositBalanceLookup
        ? depositBalanceLookup.lookup(depositClientId, client?.payerName ?? null, null)
        : depositsTabMode && balancesLoading
          ? null
          : null;

      const isDepositBankMatch = Boolean(
        bankRow
        && (
          bankRow.isDepositCashPlaceholder
          || depositBankIds.has(bankRow.id)
          || accountRow.isDepositMatch
        ),
      );
      const bankReviewNote = bankRow
        ? bankReviewNotesByItemId.get(bankRow.id)
          ?? (bankRow.isDepositCashPlaceholder ? bankRow.comment : null)
          ?? accountRow.reviewNote
        : null;

      rows.push(
        <tr key={`${day.kyivDay}|${group.accountTitle}|${index}`} className={`border-t border-gray-200 ${blockBg}`}>
          {!dayLabelRendered ? (
            <td
              rowSpan={dayRowCount}
              className={`whitespace-nowrap px-1 py-0.5 align-top font-medium tabular-nums text-gray-700 ${blockBg}`}
            >
              {day.dayLabel}
            </td>
          ) : null}
          <td className={`px-1 py-0.5 align-top text-gray-800 ${blockBg}`}>
            {client ? (
              <ClientNameWithDepositBadge
                name={client.payerName}
                showDeposit={false}
                reviewNote={isDepositRow ? null : accountRow.reviewNote}
              />
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </td>
          <td className={`whitespace-nowrap px-1 py-0.5 align-top tabular-nums text-gray-600 ${blockBg}`}>
            {client ? formatKyivTime(client.latestOperationTime) : "—"}
          </td>
          <td className={`px-1 py-0.5 text-center align-top ${blockBg}`}>
            {isDeposit || (client && clientHasDepositPayment(client)) ? (
              <span className="inline-flex flex-col items-center gap-0.5">
                <LinkedKindBadge label="Завдаток" className="bg-amber-200 text-amber-950" />
                {zavdatokPaymentDate ? (
                  <span className="text-[8px] leading-tight tabular-nums text-gray-600">{zavdatokPaymentDate}</span>
                ) : null}
              </span>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </td>
          <LabelStackCell
            label={zapisLink.label}
            subtitle={zapisLink.subtitle}
            tone="zapis"
            href={zapisLink.href}
            className={blockBg}
          />
          <td className={`px-1 py-0.5 align-top ${blockBg}`}>
            <AccountTitleBadge
              title={group.accountTitle}
              colorKey={pairColorKey}
              variant="filled"
            />
          </td>
          <td className={`whitespace-nowrap px-1 py-0.5 text-right align-top tabular-nums ${payCellToneClass} ${blockBg}`}>
            {client ? (
              depositsTabMode ? (
                <span className={`font-medium ${payCellToneClass}`}>
                  {balancesLoading && !depositBalanceLookup
                    ? "…"
                    : formatDepositBalanceUah(rowDepositBalance ?? 0)}
                </span>
              ) : (
                <AltegioAmountLink
                  amountKop={client.totalKop}
                  altegioTransactionId={clientAltegioId}
                  className="text-emerald-800"
                />
              )
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </td>
          {!groupTotalsRendered ? (
            <td
              rowSpan={groupRowCount}
              className={`border-r-2 border-gray-400 whitespace-nowrap px-1 py-0.5 text-right align-top font-semibold tabular-nums text-emerald-800 ${blockBg}`}
            >
              {formatMoney(group.altegioTotalKop)}
            </td>
          ) : null}
          {!groupTotalsRendered ? (
            <td
              rowSpan={groupRowCount}
              className={`whitespace-nowrap px-1 py-0.5 text-right align-top font-semibold tabular-nums text-green-800 ${blockBg}`}
            >
              {group.bankRows.length > 0 ? formatMoney(group.bankTotalKop) : "—"}
            </td>
          ) : null}
          {showBankBlock && bankRow ? (
            <>
              <td
                rowSpan={bankRowSpan}
                className={`whitespace-nowrap px-1 py-0.5 text-right align-top tabular-nums text-green-800 ${blockBg}`}
              >
                <BankAmountLink
                  bankRow={bankRow}
                  amountKop={bankFullAmountKop(bankRow).toString()}
                  className="text-green-800"
                />
              </td>
              <td
                rowSpan={bankRowSpan}
                className={`px-1 py-0.5 align-top ${blockBg}`}
                title={bankRow.accountTitle}
              >
                <AccountTitleBadge
                  title={bankRow.accountTitle}
                  colorKey={pairColorKey}
                  variant="filled"
                />
              </td>
              <td
                rowSpan={bankRowSpan}
                className={`whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-600 ${blockBg}`}
              >
                {bankRow.isDepositCashPlaceholder
                  ? formatKyivDayLabel(kyivDayFromOperationTime(bankRow.time))
                  : formatCompactDateTime(bankRow.time)}
              </td>
              <td
                rowSpan={bankRowSpan}
                className={`px-1 py-0.5 text-gray-800 ${blockBg}`}
                title={bankCounterpartyLabel(bankRow)}
              >
                <span className="inline-flex max-w-full flex-col gap-0.5">
                  <span className="truncate">{bankCounterpartyLabel(bankRow)}</span>
                  <MatchReviewNote
                    note={bankReviewNote}
                    tone={isDepositBankMatch ? "deposit" : "default"}
                  />
                </span>
              </td>
              <td rowSpan={bankRowSpan} className={`px-1 py-0.5 ${blockBg}`}>
                <span
                  className={`inline-flex max-w-full truncate rounded px-1 py-0.5 text-[9px] font-medium ${bankKindClass(bankRow.kind, bankRow.isDepositCashPlaceholder, isDepositBankMatch)}`}
                >
                  {bankKindLabel(bankRow.kind, bankRow.isDepositCashPlaceholder, isDepositBankMatch)}
                </span>
              </td>
              <td
                rowSpan={bankRowSpan}
                className={`whitespace-nowrap px-1 py-0.5 text-right tabular-nums text-violet-700 ${blockBg}`}
              >
                {formatCommissionShort(bankRow)}
              </td>
              <td
                rowSpan={bankRowSpan}
                className={`whitespace-nowrap px-1 py-0.5 text-right font-medium tabular-nums text-green-700 ${blockBg}`}
              >
                {formatMoney(bankRow.amountKop)}
              </td>
            </>
          ) : null}
        </tr>,
      );

      dayLabelRendered = true;
      groupTotalsRendered = true;
    }
  }

  return <>{rows}</>;
}

const DEPOSITS_TABLE_COLUMN_COUNT = 16;

type DepositsLinkedDaysScrollProps = {
  activeDays: VisibleAlignedDayRow[];
  realizedDays: VisibleAlignedDayRow[];
  depositBankIds: Set<string>;
  bankReviewNotesByItemId: Map<string, string>;
  depositRealizationIndex?: DepositRealizationIndex;
  depositBalances?: DepositBalancesPayload | null;
  depositBalanceLookup: ReturnType<typeof buildDepositBalanceLookup> | null;
  balancesLoading?: boolean;
  clientIdByAltegioId: Map<number, number>;
};

function DepositsLinkedDaysScroll({
  activeDays,
  realizedDays,
  depositBankIds,
  bankReviewNotesByItemId,
  depositRealizationIndex,
  depositBalances,
  depositBalanceLookup,
  balancesLoading = false,
  clientIdByAltegioId,
}: DepositsLinkedDaysScrollProps) {
  const showDivider = activeDays.length > 0 && realizedDays.length > 0;
  const totalBalanceLabel = balancesLoading && !depositBalances
    ? "…"
    : formatTotalDepositBalanceUah(depositBalances?.totalBalance);

  const bodyProps = {
    depositBankIds,
    bankReviewNotesByItemId,
    depositRealizationIndex,
    depositsTabMode: true as const,
    depositBalanceLookup,
    balancesLoading,
    clientIdByAltegioId,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-amber-200 bg-amber-50/80 px-3 py-1.5 text-xs text-amber-950">
        <span className="font-semibold">На депозитах (Altegio):</span>{" "}
        <span className="tabular-nums">{totalBalanceLabel}</span>
      </div>
      <table className={`${LINKED_TABLE_CLASS} text-[10px]`}>
        <DepositsColGroup />
        <thead className="sticky top-0 z-10 bg-white shadow-sm">
          <tr className="border-b border-gray-300 bg-slate-200 text-[9px] uppercase">
            <th rowSpan={2} className="border-r border-gray-300 px-1 py-1 font-semibold text-gray-700">
              День
            </th>
            <th colSpan={7} className="border-r-2 border-gray-400 px-1 py-1 text-left font-semibold text-emerald-900">
              Altegio
            </th>
            <th colSpan={8} className="px-1 py-1 text-left font-semibold text-blue-900">
              Банк
            </th>
          </tr>
          <tr className="border-b border-gray-200 bg-gray-50/95 text-[9px] uppercase text-gray-500">
            <th className="px-1 py-0.5 font-medium">Клієнт</th>
            <th className="px-1 py-0.5 font-medium">Час</th>
            <th className="px-1 py-0.5 text-center font-medium">Завдаток</th>
            <th className="px-1 py-0.5 text-center font-medium">Запис</th>
            <th className="px-1 py-0.5 font-medium">Рахунок</th>
            <th className="px-1 py-0.5 text-right font-medium">Баланс</th>
            <th className="border-r-2 border-gray-400 px-1 py-0.5 text-right font-medium">Сума</th>
            <th className="px-1 py-0.5 text-right font-semibold text-green-800">Сума</th>
            <th className="px-1 py-0.5 text-right font-medium">Платіж</th>
            <th className="px-1 py-0.5 font-medium">Рахунок</th>
            <th className="px-1 py-0.5 font-medium">Дата</th>
            <th className="px-1 py-0.5 font-medium">Контрагент</th>
            <th className="px-1 py-0.5 font-medium">Тип</th>
            <th className="px-1 py-0.5 text-right font-medium">Ком.</th>
            <th className="px-1 py-0.5 text-right font-medium">Зарах.</th>
          </tr>
        </thead>
        <tbody>
          {activeDays.flatMap((day, dayIndex) => (
            <LinkedIncomingDayBody
              key={`active|${day.kyivDay}`}
              day={day}
              dayBlockIndex={dayIndex}
              {...bodyProps}
            />
          ))}
          {showDivider ? (
            <tr key="deposits-active-realized-divider">
              <td
                colSpan={DEPOSITS_TABLE_COLUMN_COUNT}
                className="border-t-4 border-black p-0 leading-none"
                aria-hidden
              />
            </tr>
          ) : null}
          {realizedDays.flatMap((day, dayIndex) => (
            <LinkedIncomingDayBody
              key={`realized|${day.kyivDay}`}
              day={day}
              dayBlockIndex={activeDays.length + dayIndex}
              showRecordNumberInZapis
              {...bodyProps}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function linkedBlockBackground(blockIndex: number): string {
  return blockIndex % 2 === 0 ? "bg-emerald-50" : "bg-slate-100/80";
}

function bankGroupAmountTotalKop(bankGroup: BankAccountGroup | null, bankRows: BankDayItemRow[]): string {
  if (bankRows.length > 0) {
    const fullTotal = bankRows.reduce((sum, row) => sum + bankFullAmountKop(row), 0n);
    return fullTotal.toString();
  }
  if (bankGroup?.totalKop) return bankGroup.totalKop;
  return "0";
}

function formatKyivTime(value: string): string {
  return new Date(value).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ExpandTriangle({
  expanded,
  onClick,
  label,
}: {
  expanded: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-black hover:bg-gray-200/80"
      aria-expanded={expanded}
      aria-label={label}
      onClick={onClick}
    >
      <span
        className="inline-block text-[10px] leading-none transition-transform duration-150"
        style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
      >
        ▶
      </span>
    </button>
  );
}

function bankKindLabel(
  kind: BankIncomingItem["kind"],
  isDepositPlaceholder = false,
  isDepositBankMatch = false,
): string {
  if (isDepositPlaceholder || isDepositBankMatch) return "Завдаток";
  if (kind === "universal_bank_aggregate") return "Еквайринг";
  if (kind === "named_incoming") return "Іменований";
  return "Інше";
}

function bankKindClass(
  kind: BankIncomingItem["kind"],
  isDepositPlaceholder = false,
  isDepositBankMatch = false,
): string {
  if (isDepositPlaceholder || isDepositBankMatch) return "bg-amber-200 text-amber-950";
  if (kind === "universal_bank_aggregate") return "bg-violet-100 text-violet-800";
  if (kind === "named_incoming") return "bg-sky-100 text-sky-800";
  return "bg-gray-100 text-gray-700";
}

function EmptyDayCell({ tone }: { tone: "altegio" | "bank" | "diff" }) {
  const bg =
    tone === "altegio" ? "bg-emerald-50/20" : tone === "bank" ? "bg-blue-50/20" : "bg-amber-50/30";
  return <div className={`flex h-full min-h-[2.5rem] items-center justify-center px-2 py-3 text-[10px] text-gray-400 ${bg}`}>—</div>;
}

function sumBankDaysTotals(days: BankDayFlat[]): {
  totalKop: string;
  commissionTotalKop: string;
  fullTotalKop: string;
} {
  const allRows = days.flatMap((day) => day.rows);
  return sumBankRowsTotals(allRows);
}

function countVisibleAlignedAccountRows(days: VisibleAlignedDayRow[]): number {
  return days.reduce((sum, day) => sum + day.accountRows.length, 0);
}

/** Суми Altegio/банку лише по рядках, що реально відображені у вкладці. */
function sumVisibleAlignedDaysTotals(days: VisibleAlignedDayRow[]): {
  altegioTotalKop: string;
  bankPeriodTotals: ReturnType<typeof sumBankRowsTotals>;
} {
  let altegioTotal = 0n;
  const bankRows: BankDayItemRow[] = [];

  for (const day of days) {
    for (const row of day.accountRows) {
      if (row.altegioAccount) {
        altegioTotal += BigInt(row.altegioAccount.totalKop || 0);
      }
      if (row.bankGroup) {
        bankRows.push(...row.bankGroup.rows);
      }
    }
  }

  return {
    altegioTotalKop: altegioTotal.toString(),
    bankPeriodTotals: sumBankRowsTotals(bankRows),
  };
}

function buildOpenVisibleAlignedDays(
  alignedDays: AlignedDayRow[],
  completeReconciledBankIds: Set<string>,
  reconciledAltegioPayersByDay: Map<string, Set<string>>,
  depositMatchByAltegioId: Map<number, DepositIncomingMatch>,
): VisibleAlignedDayRow[] {
  const regularDays = alignedDays
    .map((day) => {
      const accountRows = buildDayAccountAlignedRows(day.altegio, day.bank);
      const filteredAccountRows = accountRows
        .map((accountRow) => {
          if (!accountRow.bankGroup) {
            return stripReconciledClientsFromOpenRow(
              accountRow,
              reconciledAltegioPayersByDay.get(day.kyivDay),
            );
          }

          const filteredRows = accountRow.bankGroup.rows.filter(
            (row) => !completeReconciledBankIds.has(row.id),
          );

          if (filteredRows.length === 0) {
            return stripReconciledClientsFromOpenRow(
              { ...accountRow, bankGroup: null },
              reconciledAltegioPayersByDay.get(day.kyivDay),
            );
          }

          const totalKop = filteredRows.reduce((sum, row) => sum + BigInt(row.amountKop), 0n);
          return stripReconciledClientsFromOpenRow(
            {
              ...accountRow,
              bankGroup: {
                ...accountRow.bankGroup,
                rows: filteredRows,
                totalKop: totalKop.toString(),
              },
            },
            reconciledAltegioPayersByDay.get(day.kyivDay),
          );
        })
        .filter((row): row is DayAccountAlignedRow => row != null);

      if (filteredAccountRows.length === 0) return null;
      return { ...day, accountRows: filteredAccountRows };
    })
    .filter((day): day is VisibleAlignedDayRow => day != null);

  return regularDays
    .map((day) => {
      const accountRows = day.accountRows
        .map((row) => resolveZavdatokForOpenRow(row, day.kyivDay, depositMatchByAltegioId))
        .filter((row) => row.altegioAccount || row.bankGroup);
      if (accountRows.length === 0) return null;

      const altegioTotalKop = accountRows.reduce((sum, row) => {
        if (!row.altegioAccount) return sum;
        return sum + BigInt(row.altegioAccount.totalKop);
      }, 0n);

      return {
        ...day,
        altegio: day.altegio
          ? { ...day.altegio, totalKop: altegioTotalKop.toString() }
          : altegioTotalKop > 0n
            ? {
                kyivDay: day.kyivDay,
                dayLabel: day.dayLabel,
                totalKop: altegioTotalKop.toString(),
                accounts: [],
              }
            : null,
        bank: summarizeVisibleBankForDay(day.kyivDay, day.dayLabel, accountRows),
        accountRows,
      };
    })
    .filter((day): day is VisibleAlignedDayRow => day != null);
}

export type IncomingStatusCounts = {
  all: number;
  open: number;
  linked: number;
  deposits: number;
};

export type IncomingSplitControls = {
  refresh: () => void;
  reconcile: () => void;
  loading: boolean;
  reconciling: boolean;
  statusCounts: IncomingStatusCounts;
};

type IncomingSplitViewProps = {
  onControlsReady?: (controls: IncomingSplitControls) => void;
  reconciliationStatus?: "open" | "linked" | "all" | "deposits";
  className?: string;
};

export function IncomingSplitView({
  onControlsReady,
  reconciliationStatus = "open",
  className = "",
}: IncomingSplitViewProps) {
  const [data, setData] = useState<IncomingPreview | null>(null);
  const [depositTabData, setDepositTabData] = useState<{
    depositBalances?: DepositBalancesPayload | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [depositTabLoading, setDepositTabLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(() => new Set());
  const [altegioCashFilter, setAltegioCashFilter] = useState<AltegioCashFilter>("non_cash");

  const toggleAccount = useCallback((key: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const loadDepositTabData = useCallback(async (clientIds: number[]) => {
    setDepositTabLoading(true);
    try {
      const uniqueIds = [...new Set(clientIds.filter((id) => Number.isFinite(id) && id > 0))];
      const qs = uniqueIds.length > 0 ? `?clientIds=${uniqueIds.join(",")}` : "";
      const res = await fetch(`/api/admin/bank/payment-reconciliation/incoming/deposit-tab-data${qs}`, {
        cache: "no-store",
        credentials: "include",
        signal: AbortSignal.timeout(90_000),
      });
      const payload = (await res.json()) as DepositTabDataPayload;
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Не вдалося завантажити баланси завдатків");
      }
      setDepositTabData({
        depositBalances: normalizeDepositBalancesPayload(payload.depositBalances),
      });
    } catch (tabError) {
      console.warn("[IncomingSplitView] deposit-tab-data:", tabError);
      setDepositTabData({
        depositBalances: null,
      });
    } finally {
      setDepositTabLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDepositTabData(null);
    try {
      const res = await fetch("/api/admin/bank/payment-reconciliation/incoming", {
        cache: "no-store",
        credentials: "include",
        signal: AbortSignal.timeout(90_000),
      });
      const payload = (await res.json()) as IncomingPreview;
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Не вдалося завантажити вхідні платежі");
      }
      setData(payload);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === "TimeoutError") {
        setError("Завантаження перевищило час очікування. Спробуйте «Оновити».");
      } else {
        setError(loadError instanceof Error ? loadError.message : "Помилка завантаження");
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await loadData();
  }, [loadData]);

  const runManualReconcile = useCallback(async () => {
    setReconciling(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bank/payment-reconciliation/incoming", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        signal: AbortSignal.timeout(120_000),
      });
      const payload = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Не вдалося виконати ручне зведення");
      }
      await loadData();
    } catch (runError) {
      if (runError instanceof Error && runError.name === "TimeoutError") {
        setError("Ручне зведення перевищило час очікування. Спробуйте ще раз.");
      } else {
        setError(runError instanceof Error ? runError.message : "Помилка ручного зведення");
      }
    } finally {
      setReconciling(false);
    }
  }, [loadData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const depositBankIds = useMemo(
    () => new Set(data?.reconciled?.depositBankItemIds ?? []),
    [data?.reconciled?.depositBankItemIds],
  );
  const depositMatches = data?.reconciled?.depositMatches ?? [];
  const bankDays = data ? regroupBankByDayWithAcquiringShift(data.bank.byDay) : [];
  const bankRowById = useMemo(() => {
    const map = new Map<string, BankDayItemRow>();
    for (const day of bankDays) {
      for (const row of day.rows) map.set(row.id, row);
    }
    return map;
  }, [bankDays]);
  const mismatchDepositMatchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const match of depositMatches) {
      if (isDepositMatchAccountMismatch(match, bankRowById)) ids.add(match.id);
    }
    return ids;
  }, [depositMatches, bankRowById]);

  const depositBankIdsClaimed = useMemo(
    () => depositBankIdsClaimedByValidDepositMatches(depositMatches, mismatchDepositMatchIds, bankRowById),
    [depositMatches, mismatchDepositMatchIds, bankRowById],
  );

  const rawAltegioDays = useMemo(
    () => (data ? groupAltegioPayersByDay(data.altegio.byPayer) : []),
    [data],
  );

  const evaluatedOpenPairs = useMemo(
    () => (data ? evaluateOpenReconcilePairs(data.altegio.byPayer, data.bank.byDay) : []),
    [data],
  );

  const recordIdByAltegioId = useMemo(
    () => (data ? buildRecordIdByAltegioId(data.altegio.byPayer) : new Map<number, number>()),
    [data],
  );

  const fullyLinkedDays = useMemo(() => {
    if (!data) return [];
    const dbLinkedDays = buildFullyLinkedVisibleDays(
      data.reconciled?.matches ?? [],
      depositBankIdsClaimed,
      rawAltegioDays,
      bankDays,
      depositMatches,
      mismatchDepositMatchIds,
      recordIdByAltegioId,
    );
    const skippedBankIds = completeReconciledBankIdsFromLinkedDays(dbLinkedDays);
    for (const bankId of depositBankIdsClaimed) skippedBankIds.add(bankId);
    const skippedDepositAltegioIds = activeDepositAltegioIdsFromMatches(
      depositMatches,
      mismatchDepositMatchIds,
      bankRowById,
    );
    const evaluatedLinkedDays = filterEvaluatedLinkedDaysNotInDb(
      buildEvaluatedLinkedVisibleDays(
        evaluatedOpenPairs,
        skippedBankIds,
        skippedDepositAltegioIds,
        rawAltegioDays,
        bankDays,
      ),
      skippedBankIds,
    );
    return mergeVisibleAlignedDays(dbLinkedDays, evaluatedLinkedDays);
  }, [
    data,
    depositBankIdsClaimed,
    rawAltegioDays,
    bankDays,
    depositMatches,
    mismatchDepositMatchIds,
    recordIdByAltegioId,
    evaluatedOpenPairs,
    bankRowById,
  ]);

  const activeDepositAltegioIds = useMemo(() => {
    const ids = activeDepositAltegioIdsFromMatches(depositMatches, mismatchDepositMatchIds, bankRowById);
    for (const pair of evaluatedOpenPairs) {
      if (pair.kind === "deposit" && pair.altegioTransactionId != null) {
        ids.add(pair.altegioTransactionId);
      }
    }
    return ids;
  }, [depositMatches, mismatchDepositMatchIds, bankRowById, evaluatedOpenPairs]);

  const depositMatchByAltegioId = useMemo(() => {
    const map = new Map<number, DepositIncomingMatch>();
    for (const match of depositMatches) {
      map.set(match.altegioTransactionId, match);
    }
    return map;
  }, [depositMatches]);

  const allAltegioDays = useMemo(
    () => (data
      ? groupAltegioPayersByDay(excludeDepositFromByPayer(data.altegio.byPayer, activeDepositAltegioIds))
      : []),
    [data, activeDepositAltegioIds],
  );

  const altegioDays = allAltegioDays;
  const filteredAltegioDays = filterAltegioDaysByCash(altegioDays, altegioCashFilter);
  const filteredAltegioTotalKop = sumAltegioDaysKop(filteredAltegioDays);
  const bankPeriodTotals = sumBankDaysTotals(bankDays);
  const periodDiffKop = BigInt(bankPeriodTotals.fullTotalKop) - BigInt(filteredAltegioTotalKop);
  const commissionTotalKop = BigInt(bankPeriodTotals.commissionTotalKop);
  const periodDiffAfterCommissionKop = periodDiffKop - commissionTotalKop;
  const alignedDays = mergeAlignedDays(filteredAltegioDays, bankDays);
  const openHiddenFromLinked = useMemo(() => {
    const hidden = buildOpenHiddenFromLinkedDays(fullyLinkedDays);
    if (data) {
      supplementOpenHiddenFromDbMatches(
        hidden,
        data.reconciled?.matches ?? [],
        depositBankIdsClaimed,
        rawAltegioDays,
        bankDays,
      );
    }
    return hidden;
  }, [fullyLinkedDays, data, depositBankIdsClaimed, rawAltegioDays, bankDays]);
  const completeReconciledBankIds = useMemo(() => {
    if (reconciliationStatus === "open") {
      return openHiddenFromLinked.bankIds;
    }
    const ids = completeReconciledBankIdsFromLinkedDays(fullyLinkedDays);
    for (const bankId of depositBankIdsClaimed) ids.add(bankId);
    return ids;
  }, [reconciliationStatus, openHiddenFromLinked.bankIds, fullyLinkedDays, depositBankIdsClaimed]);
  const bankReviewNotesByItemId = useMemo(() => {
    const map = new Map<string, string>();
    for (const match of data?.reconciled?.matches ?? []) {
      const note = match.reviewNote?.trim();
      if (note) map.set(match.bankStatementItemId, note);
    }
    for (const match of depositMatches) {
      if (!match.bankStatementItemId) continue;
      const note = match.reviewNote?.trim();
      if (note) map.set(match.bankStatementItemId, note);
    }
    return map;
  }, [data?.reconciled?.matches, depositMatches]);

  const reconciledAltegioPayersByDay = useMemo(() => {
    if (reconciliationStatus === "open") {
      return openHiddenFromLinked.altegioPayersByDay;
    }
    return reconciledAltegioPayerKeysFromLinkedDays(fullyLinkedDays);
  }, [reconciliationStatus, openHiddenFromLinked.altegioPayersByDay, fullyLinkedDays]);

  const visibleAlignedDays = useMemo((): VisibleAlignedDayRow[] => {
    const regularDays = alignedDays
      .map((day) => {
        const accountRows = buildDayAccountAlignedRows(day.altegio, day.bank);

        if (reconciliationStatus === "all") {
          if (accountRows.length === 0) return null;
          return { ...day, accountRows };
        }

        const filteredAccountRows = accountRows
          .map((accountRow) => {
            if (!accountRow.bankGroup) {
              if (reconciliationStatus === "linked") return null;
              return stripReconciledClientsFromOpenRow(
                accountRow,
                reconciledAltegioPayersByDay.get(day.kyivDay),
              );
            }

            const filteredRows = accountRow.bankGroup.rows.filter((row) => {
              const isReconciled = completeReconciledBankIds.has(row.id);
              if (reconciliationStatus === "linked") {
                return isReconciled && !depositBankIds.has(row.id);
              }
              return !isReconciled;
            });

            if (filteredRows.length === 0) {
              if (reconciliationStatus === "linked") return null;
              return stripReconciledClientsFromOpenRow(
                { ...accountRow, bankGroup: null },
                reconciledAltegioPayersByDay.get(day.kyivDay),
              );
            }

            const totalKop = filteredRows.reduce((sum, row) => sum + BigInt(row.amountKop), 0n);
            const withBank = {
              ...accountRow,
              bankGroup: {
                ...accountRow.bankGroup,
                rows: filteredRows,
                totalKop: totalKop.toString(),
              },
            };
            if (reconciliationStatus === "open") {
              return stripReconciledClientsFromOpenRow(
                withBank,
                reconciledAltegioPayersByDay.get(day.kyivDay),
              );
            }
            return withBank;
          })
          .filter((row): row is DayAccountAlignedRow => row != null);

        if (filteredAccountRows.length === 0) return null;
        return { ...day, accountRows: filteredAccountRows };
      })
      .filter((day): day is VisibleAlignedDayRow => day != null);

    if (reconciliationStatus !== "linked") {
      if (reconciliationStatus === "open") {
        const openDays = regularDays
          .map((day) => {
            const accountRows = day.accountRows
              .map((row) => resolveZavdatokForOpenRow(row, day.kyivDay, depositMatchByAltegioId))
              .filter((row) => row.altegioAccount || row.bankGroup);
            if (accountRows.length === 0) return null;

            const altegioTotalKop = accountRows.reduce((sum, row) => {
              if (!row.altegioAccount) return sum;
              return sum + BigInt(row.altegioAccount.totalKop);
            }, 0n);

            return {
              ...day,
              altegio: day.altegio
                ? { ...day.altegio, totalKop: altegioTotalKop.toString() }
                : altegioTotalKop > 0n
                  ? {
                      kyivDay: day.kyivDay,
                      dayLabel: day.dayLabel,
                      totalKop: altegioTotalKop.toString(),
                      accounts: [],
                    }
                  : null,
              bank: summarizeVisibleBankForDay(day.kyivDay, day.dayLabel, accountRows),
              accountRows,
            };
          })
          .filter((day): day is VisibleAlignedDayRow => day != null);
        return filterOpenIncomingDaysByMinDate(openDays);
      }
      return regularDays;
    }

    return fullyLinkedDays;
  }, [
    alignedDays,
    reconciliationStatus,
    completeReconciledBankIds,
    depositBankIds,
    depositMatches,
    bankDays,
    allAltegioDays,
    fullyLinkedDays,
    depositMatchByAltegioId,
    reconciledAltegioPayersByDay,
    mismatchDepositMatchIds,
  ]);

  const openVisibleAlignedDays = useMemo(
    () => filterOpenIncomingDaysByMinDate(
      buildOpenVisibleAlignedDays(
        alignedDays,
        openHiddenFromLinked.bankIds,
        openHiddenFromLinked.altegioPayersByDay,
        depositMatchByAltegioId,
      ),
    ),
    [alignedDays, openHiddenFromLinked, depositMatchByAltegioId],
  );

  const clientIdByAltegioId = useMemo(() => {
    const map = new Map<number, number>();
    for (const match of depositMatches) {
      if (match.clientId != null) map.set(match.altegioTransactionId, match.clientId);
    }
    return map;
  }, [depositMatches]);

  const cashDepositTabDays = useMemo(() => {
    if (!data) return [];
    const seenAltegioIds = new Set<number>();
    for (const day of [...fullyLinkedDays, ...openVisibleAlignedDays]) {
      for (const row of day.accountRows) {
        const altegioId = depositRowAltegioId(row);
        if (altegioId != null) seenAltegioIds.add(altegioId);
      }
    }
    return buildCashDepositTabDays(data, seenAltegioIds);
  }, [data, fullyLinkedDays, openVisibleAlignedDays]);

  const depositTabSourceDays = useMemo(
    () => buildDepositTabSourceDays(fullyLinkedDays, openVisibleAlignedDays, cashDepositTabDays),
    [fullyLinkedDays, openVisibleAlignedDays, cashDepositTabDays],
  );

  const depositBalanceLookup = useMemo(
    () => (depositTabData ? buildDepositBalanceLookup(depositTabData.depositBalances ?? null) : null),
    [depositTabData],
  );

  useEffect(() => {
    if (reconciliationStatus !== "deposits") {
      setDepositTabData(null);
      return;
    }
    if (!data || depositTabLoading || depositTabData) return;
    const clientIds = depositMatches
      .map((match) => match.clientId)
      .filter((id): id is number => id != null);
    void loadDepositTabData(clientIds);
  }, [reconciliationStatus, data, depositTabLoading, depositTabData, loadDepositTabData, depositMatches]);

  const incomingStatusCounts = useMemo((): IncomingStatusCounts => {
    const linked = countVisibleAlignedAccountRows(fullyLinkedDays);
    const open = countVisibleAlignedAccountRows(openVisibleAlignedDays);
    let deposits = 0;
    for (const day of depositTabSourceDays) {
      deposits += day.accountRows.length;
    }
    return { linked, open, all: linked + open, deposits };
  }, [fullyLinkedDays, openVisibleAlignedDays, depositTabSourceDays]);

  const depositRealizationIndex = useMemo(
    () => ({ byMatchKey: {}, byAltegioId: {} } satisfies DepositRealizationIndex),
    [],
  );

  const depositSplit = useMemo(() => {
    if (reconciliationStatus !== "deposits" || !data) {
      return { activeDays: [] as VisibleAlignedDayRow[], realizedDays: [] as VisibleAlignedDayRow[] };
    }
    const split = splitReconciledDepositRows(
      depositTabSourceDays,
      depositRealizationIndex,
      depositMatches,
      depositBalanceLookup ?? undefined,
      clientIdByAltegioId,
    );
    return {
      activeDays: split.activeDays as VisibleAlignedDayRow[],
      realizedDays: split.realizedDays as VisibleAlignedDayRow[],
    };
  }, [reconciliationStatus, data, depositTabSourceDays, depositRealizationIndex, depositMatches, depositBalanceLookup, clientIdByAltegioId]);

  const isDepositsView = reconciliationStatus === "deposits";
  const showPageLoading = loading;

  useEffect(() => {
    onControlsReady?.({
      refresh: () => void refreshAll(),
      reconcile: () => void runManualReconcile(),
      loading: showPageLoading,
      reconciling,
      statusCounts: incomingStatusCounts,
    });
  }, [loading, refreshAll, onControlsReady, incomingStatusCounts, runManualReconcile, reconciling, showPageLoading]);

  const showMetaColumns = reconciliationStatus === "linked" || reconciliationStatus === "open";
  const altegioHeaderColSpan = showMetaColumns ? 6 : 4;
  const isLinkedView = reconciliationStatus === "linked";

  const visibleListTotals = useMemo(() => {
    if (reconciliationStatus === "linked" || reconciliationStatus === "deposits") {
      return null;
    }
    const { altegioTotalKop, bankPeriodTotals: bankTotals } = sumVisibleAlignedDaysTotals(visibleAlignedDays);
    const periodDiff = BigInt(bankTotals.fullTotalKop) - BigInt(altegioTotalKop);
    const commission = BigInt(bankTotals.commissionTotalKop);
    return {
      altegioTotalKop,
      bankPeriodTotals: bankTotals,
      periodDiffKop: periodDiff,
      commissionTotalKop: commission,
      periodDiffAfterCommissionKop: periodDiff - commission,
    };
  }, [reconciliationStatus, visibleAlignedDays]);

  const headerAltegioTotalKop = visibleListTotals?.altegioTotalKop ?? filteredAltegioTotalKop;
  const headerBankPeriodTotals = visibleListTotals?.bankPeriodTotals ?? bankPeriodTotals;
  const headerPeriodDiffKop = visibleListTotals?.periodDiffKop ?? periodDiffKop;
  const headerCommissionTotalKop = visibleListTotals?.commissionTotalKop ?? commissionTotalKop;
  const headerPeriodDiffAfterCommissionKop =
    visibleListTotals?.periodDiffAfterCommissionKop ?? periodDiffAfterCommissionKop;

  const hasAnyData = isDepositsView
    ? depositSplit.activeDays.length > 0 || depositSplit.realizedDays.length > 0
    : visibleAlignedDays.length > 0;

  return (
    <div className={`flex min-h-0 flex-1 flex-col px-1 py-2 ${className}`.trim()}>
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
      ) : null}

      {showPageLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          Завантаження...
        </div>
      ) : !hasAnyData ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          {isDepositsView
            ? "Завдатків немає."
            : reconciliationStatus === "linked"
              ? "Зведених вхідних платежів немає."
              : "Немає даних за період."}
        </div>
      ) : isDepositsView ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <DepositsLinkedDaysScroll
            activeDays={depositSplit.activeDays}
            realizedDays={depositSplit.realizedDays}
            depositBankIds={depositBankIds}
            bankReviewNotesByItemId={bankReviewNotesByItemId}
            depositRealizationIndex={depositRealizationIndex}
            depositBalances={depositTabData?.depositBalances ?? null}
            depositBalanceLookup={depositBalanceLookup}
            balancesLoading={depositTabLoading}
            clientIdByAltegioId={clientIdByAltegioId}
          />
        </div>
      ) : isLinkedView ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <LinkedIncomingDaysScroll
            days={visibleAlignedDays}
            depositBankIds={depositBankIds}
            bankReviewNotesByItemId={bankReviewNotesByItemId}
            depositRealizationIndex={depositRealizationIndex}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className={`${SPLIT_ROW_CLASS} border-b border-gray-300 bg-slate-200 text-[10px]`}>
            <table className={`${ALT_TABLE_CLASS} border-r border-gray-200`}>
              <AltegioColGroup showMetaColumns={showMetaColumns} />
              <tbody>
                <tr>
                  <td colSpan={altegioHeaderColSpan} className="px-1 py-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <h2 className="shrink-0 font-semibold text-emerald-900">Altegio</h2>
                      {ALTEGIO_CASH_FILTER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors ${
                            altegioCashFilter === option.value
                              ? "bg-emerald-700 text-white"
                              : "bg-white text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100"
                          }`}
                          onClick={() => setAltegioCashFilter(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-emerald-900">
                    {formatMoney(headerAltegioTotalKop)} ₴
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="flex flex-col items-center justify-center border-x border-gray-300 bg-amber-100 px-1 py-1 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-900">Δ</div>
              <div className="flex flex-col items-center leading-tight">
                <span
                  className={`text-[10px] font-semibold tabular-nums ${formatDiffDisplay(headerPeriodDiffKop).className}`}
                  title="Банк (повна) − Altegio за відображені платежі"
                >
                  {formatDiffDisplay(headerPeriodDiffKop).text}
                </span>
                {headerCommissionTotalKop > 0n ? (
                  <>
                    <span
                      className="text-[8px] font-medium tabular-nums text-violet-800"
                      title="Сумарна комісія еквайрингу (відображені рядки)"
                    >
                      −{formatMoney(headerBankPeriodTotals.commissionTotalKop)} ком.
                    </span>
                    <span
                      className={`text-[9px] font-semibold tabular-nums ${formatDiffDisplay(headerPeriodDiffAfterCommissionKop).className}`}
                      title={`Чиста Δ = ${formatDiffDisplay(headerPeriodDiffKop).text} − ${formatMoney(headerBankPeriodTotals.commissionTotalKop)} комісія еквайрингу`}
                    >
                      {formatDiffInParens(headerPeriodDiffAfterCommissionKop)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <table className={BANK_TABLE_CLASS}>
              <BankColGroup />
              <tbody>
                <tr>
                  <td colSpan={4} className="px-1 py-1 font-semibold text-blue-900">
                    Банк
                  </td>
                  <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-violet-700">
                    {formatMoney(headerBankPeriodTotals.commissionTotalKop)} ₴
                  </td>
                  <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-green-700">
                    {formatMoney(headerBankPeriodTotals.totalKop)} ₴
                  </td>
                  <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-blue-900">
                    {formatMoney(headerBankPeriodTotals.fullTotalKop)} ₴
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className={`${SPLIT_ROW_CLASS} pointer-events-none absolute inset-0 z-0`} aria-hidden>
              <div />
              <div className={`${DIFF_COLUMN_CLASS} min-h-full`} />
              <div />
            </div>
            <div className="relative z-10 flex-1">
            {visibleAlignedDays.map((day) => {
              const accountRows = day.accountRows;
              const accountMismatchKeys = reconciliationStatus === "open"
                ? collectOpenAccountMismatchKeys(accountRows)
                : new Set<string>();

              return (
                <section key={day.kyivDay} className="border-t-2 border-gray-800 first:border-t-0">
                  <div className={`${SPLIT_ROW_CLASS} bg-slate-300 text-[10px]`}>
                    <table className={`${ALT_TABLE_CLASS} border-r border-gray-300`}>
                      <AltegioColGroup showMetaColumns={showMetaColumns} />
                      <tbody>
                        <tr>
                          <td colSpan={altegioHeaderColSpan} className="px-1 py-1">
                            <h3 className="font-bold uppercase tracking-wide text-gray-900">{day.dayLabel}</h3>
                          </td>
                          <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-emerald-900">
                            {day.altegio ? `${formatMoney(day.altegio.totalKop)} ₴` : "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className={`${DIFF_COLUMN_CLASS} justify-center bg-amber-100`}>
                      <DiffValue
                        diffKop={dayDiffKop(day.altegio, day.bank)}
                        title="Банк (повна) − Altegio за день"
                      />
                    </div>
                    <table className={BANK_TABLE_CLASS}>
                      <BankColGroup />
                      <tbody>
                        <tr>
                          <td colSpan={4} className="px-1 py-1" />
                          <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-violet-700">
                            {day.bank ? `${formatMoney(day.bank.commissionTotalKop)} ₴` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-green-700">
                            {day.bank ? `${formatMoney(day.bank.totalKop)} ₴` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-blue-900">
                            {day.bank ? `${formatMoney(day.bank.fullTotalKop)} ₴` : "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className={`${SPLIT_ROW_CLASS} border-b border-gray-200 bg-gray-50/90 text-[9px] uppercase text-gray-500`}>
                    <table className={`${ALT_TABLE_CLASS} border-r border-gray-200`}>
                      <AltegioColGroup showMetaColumns={showMetaColumns} />
                      <thead>
                        <tr>
                          <th className="px-0.5 py-0.5" aria-hidden="true" />
                          <th className="px-1 py-0.5 font-medium">Клієнт</th>
                          <th className="px-1 py-0.5 font-medium">Час</th>
                          {showMetaColumns ? (
                            <>
                              <th className="px-1 py-0.5 text-center font-medium text-amber-900">Завдаток</th>
                              <th className="px-1 py-0.5 text-center font-medium text-sky-900">Запис</th>
                            </>
                          ) : null}
                          <th className="px-1 py-0.5 font-medium">Рахунок</th>
                          <th className="px-1 py-0.5 text-right font-medium">Сума</th>
                        </tr>
                      </thead>
                    </table>
                    <div className={`${DIFF_COLUMN_CLASS} items-center justify-center px-1 py-0.5 text-center text-[9px] font-medium uppercase text-amber-900`}>
                      Δ
                    </div>
                    <table className={BANK_TABLE_CLASS}>
                      <BankColGroup />
                      <thead>
                        <tr>
                          <th className="px-1 py-0.5 font-medium">Рахунок</th>
                          <th className="px-1 py-0.5 font-medium">Дата</th>
                          <th className="px-1 py-0.5 font-medium">Контрагент</th>
                          <th className="px-1 py-0.5 font-medium">Тип</th>
                          <th className="px-1 py-0.5 text-right font-medium">Ком.</th>
                          <th className="px-1 py-0.5 text-right font-medium">Сума</th>
                          <th className="px-1 py-0.5 text-right font-medium">Повна</th>
                        </tr>
                      </thead>
                    </table>
                  </div>

                  {accountRows.length === 0 ? (
                    <div className={SPLIT_ROW_CLASS}>
                      <EmptyDayCell tone="altegio" />
                      <EmptyDayCell tone="diff" />
                      <EmptyDayCell tone="bank" />
                    </div>
                  ) : (
                    accountRows.map((accountRow) => {
                      const accountColorKey = accountColorKeyFromRow(accountRow);
                      const hasAccountMismatch = accountMismatchKeys.has(accountRow.matchKey);
                      const depositRowClass = accountRow.isDepositMatch
                        ? "bg-amber-50/90 border-amber-200"
                        : "";
                      const mismatchRowClass = hasAccountMismatch
                        ? "bg-red-50 ring-1 ring-inset ring-red-300"
                        : "";
                      return (
                      <div
                        key={accountRow.matchKey}
                        className={`${SPLIT_ROW_CLASS} items-stretch border-t border-gray-200 ${depositRowClass} ${mismatchRowClass}`}
                        title={hasAccountMismatch ? "Рахунок Altegio не збігається з банківським" : undefined}
                      >
                        <div className={`border-r border-gray-200 ${accountRow.isDepositMatch ? "bg-amber-50/80" : "bg-emerald-50/30"}`}>
                          {accountRow.altegioAccount ? (
                            <table className={`${ALT_TABLE_CLASS} text-[10px]`}>
                              <AltegioColGroup showMetaColumns={showMetaColumns} />
                              <tbody>
                                {(() => {
                                  const account = accountRow.altegioAccount!;
                                  const accountKey = `${day.kyivDay}|${account.accountTitle}`;
                                  const expanded = expandedAccounts.has(accountKey);
                                  const clientCount = account.clients.length;
                                  const singleClient = clientCount === 1 ? account.clients[0] : null;
                                  const canExpand = clientCount > 1;
                                  const zapisLink = singleClient
                                    ? resolveZapisLinkProps(singleClient, accountRow, day.kyivDay)
                                    : { label: null, subtitle: null, href: null };
                                  const accountAltegioTransactionId = resolveClientAltegioTransactionId(singleClient)
                                    ?? resolveAccountAltegioTransactionId(account);

                                  return (
                                    <>
                                      <tr className="border-t border-gray-100 hover:bg-emerald-50/60">
                                        <td className="px-0.5 py-0.5 align-middle">
                                          {canExpand ? (
                                            <ExpandTriangle
                                              expanded={expanded}
                                              label={`${expanded ? "Згорнути" : "Розгорнути"} клієнтів для ${account.accountTitle}`}
                                              onClick={() => toggleAccount(accountKey)}
                                            />
                                          ) : null}
                                        </td>
                                        <td className="px-1 py-0.5 text-gray-800" title={singleClient?.payerName}>
                                          {singleClient ? (
                                            <ClientNameWithDepositBadge
                                              name={singleClient.payerName}
                                              showDeposit={
                                                accountRow.isDepositMatch
                                                || clientHasDepositPayment(singleClient)
                                              }
                                              reviewNote={accountRow.reviewNote}
                                            />
                                          ) : accountRow.isDepositMatch ? (
                                            <DepositPaymentBadge />
                                          ) : (
                                            formatClientCount(clientCount)
                                          )}
                                        </td>
                                        <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-600">
                                          {formatKyivTime(singleClient?.latestOperationTime || account.latestOperationTime)}
                                        </td>
                                        {showMetaColumns ? (
                                          <>
                                            <LabelStackCell
                                              label={
                                                (singleClient && clientHasDepositPayment(singleClient))
                                                || accountRowIsDeposit(accountRow)
                                                  ? DEPOSIT_PAYMENT_LABEL
                                                  : null
                                              }
                                              subtitle={
                                                accountRow.zavdatokPaymentDateLabel
                                                ?? depositPaymentDateLabelFromClient(singleClient)
                                              }
                                              tone="deposit"
                                            />
                                            <LabelStackCell
                                              label={zapisLink.label}
                                              subtitle={zapisLink.subtitle}
                                              tone="zapis"
                                              href={zapisLink.href}
                                            />
                                          </>
                                        ) : null}
                                        <td className="px-1 py-0.5" title={account.accountTitle}>
                                          <AccountTitleBadge
                                            title={account.accountTitle}
                                            colorKey={accountColorKey}
                                          />
                                        </td>
                                        <td className="whitespace-nowrap px-1 py-0.5 text-right font-semibold tabular-nums text-emerald-800">
                                          <AltegioAmountLink
                                            amountKop={account.totalKop}
                                            altegioTransactionId={accountAltegioTransactionId}
                                            className="text-emerald-800"
                                          />
                                        </td>
                                      </tr>
                                      {canExpand && expanded
                                        ? account.clients.map((client) => {
                                            const clientZapisLink = resolveZapisLinkProps(
                                              client,
                                              accountRow,
                                              day.kyivDay,
                                            );
                                            return (
                                            <tr
                                              key={`${accountKey}|${client.payerName}`}
                                              className="border-t border-gray-50 bg-emerald-50/40"
                                            >
                                              <td className="px-0.5 py-0.5" />
                                              <td className="px-1 py-0.5 pl-3 font-medium text-gray-800" title={client.payerName}>
                                                <ClientNameWithDepositBadge
                                                  name={client.payerName}
                                                  showDeposit={
                                                    accountRow.isDepositMatch
                                                    || clientHasDepositPayment(client)
                                                  }
                                                  reviewNote={accountRow.reviewNote}
                                                />
                                              </td>
                                              <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-500">
                                                {client.items.length === 1
                                                  ? formatKyivTime(client.items[0].operationTime)
                                                  : `${client.items.length} оп.`}
                                              </td>
                                              {showMetaColumns ? (
                                                <>
                                                  <LabelStackCell
                                                    label={clientHasDepositPayment(client) ? DEPOSIT_PAYMENT_LABEL : null}
                                                    subtitle={depositPaymentDateLabelFromClient(client)}
                                                    tone="deposit"
                                                  />
                                                  <LabelStackCell
                                                    label={clientZapisLink.label}
                                                    subtitle={clientZapisLink.subtitle}
                                                    tone="zapis"
                                                    href={clientZapisLink.href}
                                                  />
                                                </>
                                              ) : null}
                                              <td className="px-1 py-0.5 text-gray-400">↳</td>
                                              <td className="whitespace-nowrap px-1 py-0.5 text-right font-medium tabular-nums text-emerald-700">
                                                <AltegioAmountLink
                                                  amountKop={client.totalKop}
                                                  altegioTransactionId={resolveClientAltegioTransactionId(client)}
                                                  className="text-emerald-700"
                                                />
                                              </td>
                                            </tr>
                                            );
                                          })
                                        : null}
                                    </>
                                  );
                                })()}
                              </tbody>
                            </table>
                          ) : (
                            <EmptyDayCell tone="altegio" />
                          )}
                        </div>

                        <div className={`${DIFF_COLUMN_CLASS} ${accountRow.isDepositMatch ? "bg-amber-100/80" : ""}`}>
                          <AccountDiffColumn
                            accountRow={accountRow}
                            kyivDay={day.kyivDay}
                            expandedAccounts={expandedAccounts}
                          />
                        </div>

                        <div className={accountRow.isDepositMatch ? "bg-amber-50/80" : "bg-blue-50/30"}>
                          {accountRow.bankGroup ? (
                            <table className={`${BANK_TABLE_CLASS} text-[10px]`}>
                              <BankColGroup />
                              <tbody>
                                {accountRow.bankGroup.rows.map((item) => {
                                  const isDepositBankMatch =
                                    item.isDepositCashPlaceholder
                                    || depositBankIds.has(item.id)
                                    || accountRow.isDepositMatch;
                                  const bankReviewNote =
                                    bankReviewNotesByItemId.get(item.id)
                                    ?? (item.isDepositCashPlaceholder ? item.comment : null)
                                    ?? accountRow.reviewNote;

                                  return (
                                  <tr key={item.id} className={`border-t border-gray-100 ${isDepositBankMatch ? "bg-amber-50/60" : "hover:bg-blue-50/50"}`}>
                                    <td className="px-1 py-0.5" title={item.accountTitle}>
                                      <AccountTitleBadge
                                        title={item.accountTitle}
                                        colorKey={accountColorKey}
                                      />
                                    </td>
                                    <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-600">
                                      {item.isDepositCashPlaceholder
                                        ? formatKyivDayLabel(kyivDayFromOperationTime(item.time))
                                        : formatCompactDateTime(item.time)}
                                    </td>
                                    <td className="px-1 py-0.5 text-gray-800" title={bankCounterpartyLabel(item)}>
                                      <span className="inline-flex max-w-full flex-col gap-0.5">
                                        <span className="truncate">{bankCounterpartyLabel(item)}</span>
                                        <MatchReviewNote
                                          note={bankReviewNote}
                                          tone={isDepositBankMatch ? "deposit" : "default"}
                                        />
                                      </span>
                                    </td>
                                    <td className="px-1 py-0.5">
                                      <span
                                        className={`inline-flex max-w-full truncate rounded px-1 py-0.5 text-[9px] font-medium ${bankKindClass(item.kind, item.isDepositCashPlaceholder, isDepositBankMatch)}`}
                                      >
                                        {bankKindLabel(item.kind, item.isDepositCashPlaceholder, isDepositBankMatch)}
                                      </span>
                                    </td>
                                    <td className="whitespace-nowrap px-1 py-0.5 text-right tabular-nums text-violet-700">
                                      {formatCommissionShort(item)}
                                    </td>
                                    <td className="whitespace-nowrap px-1 py-0.5 text-right font-semibold tabular-nums text-green-700">
                                      {formatMoney(item.amountKop)}
                                    </td>
                                    <td className="whitespace-nowrap px-1 py-0.5 text-right font-semibold tabular-nums text-blue-800">
                                      <BankAmountLink
                                        bankRow={item}
                                        amountKop={bankFullAmountKop(item).toString()}
                                        className="text-blue-800"
                                      />
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <EmptyDayCell tone="bank" />
                          )}
                        </div>
                      </div>
                      );
                    })
                  )}
                </section>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
