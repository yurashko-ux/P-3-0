"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEPOSIT_PAYMENT_LABEL,
  isDepositTopUpPaymentPurpose,
} from "@/lib/altegio/payment-purpose-labels";

type AltegioIncomingItem = {
  altegioId: number;
  documentId: number | null;
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
};

const SPLIT_ROW_CLASS = "grid w-full grid-cols-[minmax(0,1fr)_minmax(84px,104px)_minmax(0,1fr)]";

function AltegioColGroup({ showZavdatokColumn = false }: { showZavdatokColumn?: boolean }) {
  if (showZavdatokColumn) {
    return (
      <colgroup>
        <col className="w-4" />
        <col className="w-[24%]" />
        <col className="w-[10%]" />
        <col className="w-[11%]" />
        <col className="w-[28%]" />
        <col className="w-[17%]" />
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
  if (item.kind === "universal_bank_aggregate") return addDaysYmd(actualDay, -1);
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
  /** Дата найближчого активного запису (колонка ЗАВДАТОК) */
  zavdatokDateLabel?: string | null;
  /** День зведення в UI (день запису / kyivDay матчу) */
  displayKyivDay?: string;
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

  // Лише дні з Altegio: банк без відповідного дня (напр. еквайринг −1 день → 09.06) не показуємо
  return altegioDays
    .map((altegio) => ({
      kyivDay: altegio.kyivDay,
      dayLabel: altegio.dayLabel,
      altegio,
      bank: bankByDay.get(altegio.kyivDay) ?? null,
    }))
    .sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
}

/** Банк лише для днів, де є відповідні платежі Altegio (з урахуванням фільтра). */
function bankDaysVisibleWithAltegio(
  bankDays: BankDayFlat[],
  altegioDays: AltegioDayGroup[],
): BankDayFlat[] {
  const altegioDayKeys = new Set(altegioDays.map((day) => day.kyivDay));
  return bankDays.filter((day) => altegioDayKeys.has(day.kyivDay));
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
    .replace(/^фоп\s+/i, "")
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

function accountColorKeyFromRow(row: DayAccountAlignedRow): string {
  if (row.altegioAccount) {
    return normalizeAccountMatchKey(row.altegioAccount.accountTitle);
  }
  if (row.bankGroup?.altegioAccountTitle) {
    return normalizeAccountMatchKey(row.bankGroup.altegioAccountTitle);
  }
  if (row.bankGroup) {
    return normalizeAccountMatchKey(row.bankGroup.accountTitle);
  }
  return "unknown";
}

function AccountTitleBadge({
  title,
  colorKey,
}: {
  title: string;
  colorKey: string;
}) {
  const style = resolveAccountColorStyle(colorKey);
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

function accountsMatchForReconcile(
  altegioTitle: string,
  bankDisplayTitle: string,
  bankAltegioTitle: string | null,
): boolean {
  const altegioKey = normalizeAccountMatchKey(altegioTitle);
  const bankKeys = [
    normalizeAccountMatchKey(bankDisplayTitle),
    bankAltegioTitle ? normalizeAccountMatchKey(bankAltegioTitle) : "",
  ].filter(Boolean);

  if (bankKeys.some((key) => key === altegioKey)) return true;
  return bankKeys.some((key) => key.includes(altegioKey) || altegioKey.includes(key));
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

function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^фоп\s+/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function personNamesMatch(a: string, b: string): boolean {
  const keyA = normalizePersonName(a);
  const keyB = normalizePersonName(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const partsA = keyA.split(" ").filter(Boolean);
  const partsB = keyB.split(" ").filter(Boolean);
  if (partsA.length >= 2 && partsB.length >= 2) {
    if (partsA[0] === partsB[0] && partsA[partsA.length - 1] === partsB[partsB.length - 1]) return true;
  }

  return keyA.includes(keyB) || keyB.includes(keyA);
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
      <div className="flex h-full flex-col justify-start bg-amber-50/40">
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
    <div className="flex h-full flex-col bg-amber-50/40">
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

/** Готівкові рахунки Altegio: Каса, Долар, Євро; решта — безготівка. */
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
): { account: AltegioDayAccountRow; client: AltegioDayAccountClient } | null {
  const day = altegioDays.find((item) => item.kyivDay === kyivDay);
  if (!day) return null;

  for (const account of day.accounts) {
    for (const client of account.clients) {
      if (personNamesMatch(client.payerName, payerNameHint)) {
        return { account, client };
      }
    }
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
      accountsMatchForReconcile(accountTitleHint, account.accountTitle, altegioAccountTitleHint),
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
  if (accountRow.zavdatokDateLabel) return accountRow;

  const bankRows = accountRow.bankGroup?.rows ?? [];

  if (accountRow.altegioAccount) {
    for (const client of accountRow.altegioAccount.clients) {
      for (const item of client.items) {
        if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
        const depMatch = depositMatchByAltegioId.get(item.altegioId);
        const label = resolveZavdatokDateLabel(
          depMatch?.displayKyivDay ?? kyivDayFromOperationTime(item.operationTime),
          bankRows,
          depMatch?.appointmentAt ?? null,
          true,
        );
        if (label) return { ...accountRow, zavdatokDateLabel: label };
      }
    }
  }

  const crossDayLabel = resolveZavdatokDateLabel(dayKyivDay, bankRows, null, false);
  if (crossDayLabel) return { ...accountRow, zavdatokDateLabel: crossDayLabel };

  return accountRow;
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
    const payerHint = bankCounterpartyLabel(bankRow);
    const isNamed = match.matchType === "named_client" || bankRow.kind === "named_incoming";

    let altegioClient: AltegioDayAccountClient | null = null;
    let altegioAccount: AltegioDayAccountRow | null = null;
    let accountTitle = bankRow.altegioAccountTitle || bankRow.accountTitle;
    let payerKey = isNamed ? normalizePersonName(payerHint) || payerHint : "__acquiring__";

    if (isNamed) {
      const found = findAltegioClientOnDay(altegioDays, displayKyivDay, payerHint);
      if (found) {
        altegioClient = found.client;
        altegioAccount = found.account;
        accountTitle = found.account.accountTitle;
        payerKey = normalizePersonName(found.client.payerName) || found.client.payerName;
      }
    } else {
      altegioAccount = findAltegioAccountOnDay(
        altegioDays,
        displayKyivDay,
        bankRow.accountTitle,
        bankRow.altegioAccountTitle,
      );
      accountTitle = altegioAccount?.accountTitle || accountTitle;
    }

    const bucketKey = `${displayKyivDay}|${accountTitle}|${payerKey}`;
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
      displayKyivDay,
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
    if (bucket.altegioClient) {
      altegioAccountRow = {
        accountTitle: bucket.accountTitle,
        totalKop: bucket.altegioClient.totalKop,
        latestOperationTime: bucket.altegioClient.latestOperationTime,
        clients: [bucket.altegioClient],
      };
    } else if (bucket.altegioAccount) {
      altegioAccountRow = bucket.altegioAccount;
    }

    const accountRow: DayAccountAlignedRow = {
      matchKey: `incoming|${bucket.matchIds.join("+")}`,
      altegioAccount: altegioAccountRow,
      bankGroup,
      displayKyivDay: bucket.displayKyivDay,
      reviewNote: bucket.reviewNotes.length > 0 ? bucket.reviewNotes.join(" · ") : null,
      zavdatokDateLabel: resolveZavdatokDateLabel(
        bucket.displayKyivDay,
        bankRows,
        null,
        false,
      ),
    };

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

function buildDepositLinkedVisibleDays(
  depositMatches: DepositIncomingMatch[],
  bankDays: BankDayFlat[],
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
    const clientItems: AltegioDayPayerRow[] = [{
      altegioId: match.altegioTransactionId,
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

    let bankGroup: BankAccountGroup | null = null;
    if (match.bankStatementItemId) {
      const bankRow = bankRowById.get(match.bankStatementItemId);
      if (bankRow) {
        bankGroup = {
          accountTitle: bankRow.accountTitle,
          altegioAccountTitle: bankRow.altegioAccountTitle,
          rows: [bankRow],
          totalKop: bankRow.amountKop,
        };
      }
    }

    if (!bankGroup) {
      bankGroup = {
        accountTitle: "— Готівка (завдаток) —",
        altegioAccountTitle: match.accountTitle,
        rows: [{
          id: `deposit-cash-${match.id}`,
          time: match.operationTime || `${match.paymentKyivDay}T12:00:00.000Z`,
          amountKop: match.amountKopiykas,
          description: "Готівка / завдаток",
          comment: match.reviewNote,
          counterName: match.payerName,
          kind: "unknown",
          commissionKop: null,
          commissionRaw: null,
          accountTitle: "— Готівка (завдаток) —",
          altegioAccountTitle: match.accountTitle,
          isDepositCashPlaceholder: true,
        }],
        totalKop: match.amountKopiykas,
      };
    }

    const zavdatokDateLabel = resolveZavdatokDateLabel(
      match.displayKyivDay,
      bankGroup?.rows ?? [],
      match.appointmentAt,
      true,
    );

    const accountRow: DayAccountAlignedRow = {
      matchKey: `deposit|${match.id}`,
      altegioAccount,
      bankGroup,
      isDepositMatch: true,
      reviewNote: match.reviewNote,
      displayKyivDay: match.displayKyivDay,
      zavdatokDateLabel,
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

function ZavdatokDateCell({ dateLabel }: { dateLabel: string | null | undefined }) {
  return (
    <td className="whitespace-nowrap px-1 py-0.5 text-center tabular-nums text-amber-950">
      {dateLabel?.trim() ? dateLabel : <span className="text-gray-300">—</span>}
    </td>
  );
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

export type IncomingSplitControls = {
  refresh: () => void;
  loading: boolean;
};

type IncomingSplitViewProps = {
  onControlsReady?: (controls: IncomingSplitControls) => void;
  reconciliationStatus?: "open" | "linked" | "all";
};

export function IncomingSplitView({
  onControlsReady,
  reconciliationStatus = "open",
}: IncomingSplitViewProps) {
  const [data, setData] = useState<IncomingPreview | null>(null);
  const [loading, setLoading] = useState(false);
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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bank/payment-reconciliation/incoming", {
        cache: "no-store",
        credentials: "include",
        signal: AbortSignal.timeout(120_000),
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

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    onControlsReady?.({ refresh: () => void loadData(), loading });
  }, [loading, loadData, onControlsReady]);

  const depositAltegioIds = useMemo(
    () => new Set(data?.reconciled?.depositAltegioIds ?? []),
    [data?.reconciled?.depositAltegioIds],
  );
  const depositBankIds = useMemo(
    () => new Set(data?.reconciled?.depositBankItemIds ?? []),
    [data?.reconciled?.depositBankItemIds],
  );
  const depositMatches = data?.reconciled?.depositMatches ?? [];
  const depositMatchByAltegioId = useMemo(() => {
    const map = new Map<number, DepositIncomingMatch>();
    for (const match of depositMatches) {
      map.set(match.altegioTransactionId, match);
    }
    return map;
  }, [depositMatches]);

  const altegioDays = data
    ? groupAltegioPayersByDay(excludeDepositFromByPayer(data.altegio.byPayer, depositAltegioIds))
    : [];
  const filteredAltegioDays = filterAltegioDaysByCash(altegioDays, altegioCashFilter);
  const filteredAltegioTotalKop = sumAltegioDaysKop(filteredAltegioDays);
  const bankDays = data ? regroupBankByDayWithAcquiringShift(data.bank.byDay) : [];
  const visibleBankDays = bankDaysVisibleWithAltegio(bankDays, filteredAltegioDays);
  const bankPeriodTotals = sumBankDaysTotals(visibleBankDays);
  const periodDiffKop = BigInt(bankPeriodTotals.fullTotalKop) - BigInt(filteredAltegioTotalKop);
  const commissionTotalKop = BigInt(bankPeriodTotals.commissionTotalKop);
  const periodDiffAfterCommissionKop = periodDiffKop - commissionTotalKop;
  const alignedDays = mergeAlignedDays(filteredAltegioDays, visibleBankDays);
  const reconciledBankItemIds = useMemo(
    () => new Set(data?.reconciled?.bankItemIds ?? []),
    [data?.reconciled?.bankItemIds],
  );
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
              return accountRow;
            }

            const filteredRows = accountRow.bankGroup.rows.filter((row) => {
              const isReconciled = reconciledBankItemIds.has(row.id);
              if (reconciliationStatus === "linked") {
                return isReconciled && !depositBankIds.has(row.id);
              }
              return !isReconciled;
            });

            if (filteredRows.length === 0) {
              if (reconciliationStatus === "linked") return null;
              return accountRow.altegioAccount ? { ...accountRow, bankGroup: null } : null;
            }

            const totalKop = filteredRows.reduce((sum, row) => sum + BigInt(row.amountKop), 0n);
            return {
              ...accountRow,
              bankGroup: {
                ...accountRow.bankGroup,
                rows: filteredRows,
                totalKop: totalKop.toString(),
              },
            };
          })
          .filter((row): row is DayAccountAlignedRow => row != null);

        if (filteredAccountRows.length === 0) return null;
        return { ...day, accountRows: filteredAccountRows };
      })
      .filter((day): day is VisibleAlignedDayRow => day != null);

    if (reconciliationStatus !== "linked") {
      if (reconciliationStatus === "open") {
        return regularDays.map((day) => ({
          ...day,
          accountRows: day.accountRows.map((row) =>
            resolveZavdatokForOpenRow(row, day.kyivDay, depositMatchByAltegioId),
          ),
        }));
      }
      return regularDays;
    }

    const incomingLinkedDays = buildIncomingLinkedVisibleDays(
      data?.reconciled?.matches ?? [],
      depositBankIds,
      filteredAltegioDays,
      bankDays,
    );
    const depositDays = buildDepositLinkedVisibleDays(depositMatches, bankDays);
    return mergeVisibleAlignedDays(incomingLinkedDays, depositDays);
  }, [
    alignedDays,
    reconciliationStatus,
    reconciledBankItemIds,
    depositBankIds,
    depositMatches,
    bankDays,
    filteredAltegioDays,
    data?.reconciled?.matches,
    depositMatchByAltegioId,
  ]);

  const showZavdatokColumn = reconciliationStatus === "linked" || reconciliationStatus === "open";
  const altegioHeaderColSpan = showZavdatokColumn ? 5 : 4;

  const hasAnyData = visibleAlignedDays.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-1 py-2">
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          Завантаження...
        </div>
      ) : !hasAnyData ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          {reconciliationStatus === "linked"
            ? "Зведених вхідних платежів немає."
            : "Немає даних за період."}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className={`${SPLIT_ROW_CLASS} border-b border-gray-300 bg-slate-200 text-[10px]`}>
            <table className={`${ALT_TABLE_CLASS} border-r border-gray-200`}>
              <AltegioColGroup showZavdatokColumn={showZavdatokColumn} />
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
                    {formatMoney(filteredAltegioTotalKop)} ₴
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="flex flex-col items-center justify-center border-x border-gray-300 bg-amber-100 px-1 py-1 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-900">Δ</div>
              <div className="flex flex-col items-center leading-tight">
                <span
                  className={`text-[10px] font-semibold tabular-nums ${formatDiffDisplay(periodDiffKop).className}`}
                  title="Банк (повна) − Altegio за період"
                >
                  {formatDiffDisplay(periodDiffKop).text}
                </span>
                {commissionTotalKop > 0n ? (
                  <>
                    <span
                      className="text-[8px] font-medium tabular-nums text-violet-800"
                      title="Сумарна комісія еквайрингу за період (колонка «Ком.»)"
                    >
                      −{formatMoney(bankPeriodTotals.commissionTotalKop)} ком.
                    </span>
                    <span
                      className={`text-[9px] font-semibold tabular-nums ${formatDiffDisplay(periodDiffAfterCommissionKop).className}`}
                      title={`Чиста Δ = ${formatDiffDisplay(periodDiffKop).text} − ${formatMoney(bankPeriodTotals.commissionTotalKop)} комісія еквайрингу`}
                    >
                      {formatDiffInParens(periodDiffAfterCommissionKop)}
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
                    {formatMoney(bankPeriodTotals.commissionTotalKop)} ₴
                  </td>
                  <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-green-700">
                    {formatMoney(bankPeriodTotals.totalKop)} ₴
                  </td>
                  <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-blue-900">
                    {formatMoney(bankPeriodTotals.fullTotalKop)} ₴
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex-1">
            {visibleAlignedDays.map((day) => {
              const accountRows = day.accountRows;

              return (
                <section key={day.kyivDay} className="border-t-2 border-gray-800 first:border-t-0">
                  <div className={`${SPLIT_ROW_CLASS} bg-slate-300 text-[10px]`}>
                    <table className={`${ALT_TABLE_CLASS} border-r border-gray-300`}>
                      <AltegioColGroup showZavdatokColumn={showZavdatokColumn} />
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
                    <div className="flex flex-col justify-center border-x border-gray-400 bg-amber-100 px-1 py-1">
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
                      <AltegioColGroup showZavdatokColumn={showZavdatokColumn} />
                      <thead>
                        <tr>
                          <th className="px-0.5 py-0.5" aria-hidden="true" />
                          <th className="px-1 py-0.5 font-medium">Клієнт</th>
                          <th className="px-1 py-0.5 font-medium">Час</th>
                          {showZavdatokColumn ? (
                            <th className="px-1 py-0.5 text-center font-medium text-amber-900">Завдаток</th>
                          ) : null}
                          <th className="px-1 py-0.5 font-medium">Рахунок</th>
                          <th className="px-1 py-0.5 text-right font-medium">Сума</th>
                        </tr>
                      </thead>
                    </table>
                    <div className="flex items-center justify-center border-x border-gray-200 bg-amber-50/50 px-1 py-0.5 text-center text-[9px] font-medium uppercase text-amber-900">
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
                      const depositRowClass = accountRow.isDepositMatch
                        ? "bg-amber-50/90 border-amber-200"
                        : "";
                      return (
                      <div
                        key={accountRow.matchKey}
                        className={`${SPLIT_ROW_CLASS} items-stretch border-t border-gray-200 ${depositRowClass}`}
                      >
                        <div className={`border-r border-gray-200 ${accountRow.isDepositMatch ? "bg-amber-50/80" : "bg-emerald-50/30"}`}>
                          {accountRow.altegioAccount ? (
                            <table className={`${ALT_TABLE_CLASS} text-[10px]`}>
                              <AltegioColGroup showZavdatokColumn={showZavdatokColumn} />
                              <tbody>
                                {(() => {
                                  const account = accountRow.altegioAccount!;
                                  const accountKey = `${day.kyivDay}|${account.accountTitle}`;
                                  const expanded = expandedAccounts.has(accountKey);
                                  const clientCount = account.clients.length;
                                  const singleClient = clientCount === 1 ? account.clients[0] : null;
                                  const canExpand = clientCount > 1;

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
                                        {showZavdatokColumn ? (
                                          <ZavdatokDateCell dateLabel={accountRow.zavdatokDateLabel} />
                                        ) : null}
                                        <td className="px-1 py-0.5" title={account.accountTitle}>
                                          <AccountTitleBadge
                                            title={account.accountTitle}
                                            colorKey={accountColorKey}
                                          />
                                        </td>
                                        <td className="whitespace-nowrap px-1 py-0.5 text-right font-semibold tabular-nums text-emerald-800">
                                          {formatMoney(account.totalKop)}
                                        </td>
                                      </tr>
                                      {canExpand && expanded
                                        ? account.clients.map((client) => (
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
                                              {showZavdatokColumn ? (
                                                <ZavdatokDateCell
                                                  dateLabel={
                                                    clientCount === 1 ? accountRow.zavdatokDateLabel : null
                                                  }
                                                />
                                              ) : null}
                                              <td className="px-1 py-0.5 text-gray-400">↳</td>
                                              <td className="whitespace-nowrap px-1 py-0.5 text-right font-medium tabular-nums text-emerald-700">
                                                {formatMoney(client.totalKop)}
                                              </td>
                                            </tr>
                                          ))
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

                        <div className={`border-x border-gray-200 ${accountRow.isDepositMatch ? "bg-amber-100/70" : ""}`}>
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
                                      {formatMoney(bankFullAmountKop(item).toString())}
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
            <div className={`${SPLIT_ROW_CLASS} min-h-[2rem] flex-1`} aria-hidden="true">
              <div className="border-r border-gray-200 bg-emerald-50/30" />
              <div className="border-x border-gray-200 bg-amber-50/30" />
              <div className="bg-blue-50/30" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
