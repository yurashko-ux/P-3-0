"use client";

import { useCallback, useEffect, useState } from "react";

type AltegioIncomingItem = {
  altegioId: number;
  documentId: number | null;
  accountTitle: string;
  amountKop: string;
  operationTime: string;
  paymentPurpose: string | null;
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
};

const SPLIT_ROW_CLASS = "grid w-full grid-cols-[minmax(0,1fr)_minmax(76px,92px)_minmax(0,1fr)]";

function AltegioColGroup() {
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
};

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

function mergeAlignedDays(
  altegioDays: AltegioDayGroup[],
  bankDays: BankDayFlat[],
): AlignedDayRow[] {
  const dayKeys = new Set<string>([
    ...altegioDays.map((day) => day.kyivDay),
    ...bankDays.map((day) => day.kyivDay),
  ]);

  return Array.from(dayKeys)
    .sort((a, b) => b.localeCompare(a))
    .map((kyivDay) => ({
      kyivDay,
      dayLabel: formatKyivDayLabel(kyivDay),
      altegio: altegioDays.find((day) => day.kyivDay === kyivDay) ?? null,
      bank: bankDays.find((day) => day.kyivDay === kyivDay) ?? null,
    }));
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
  return altegio - bankFull;
}

function clientDiffKop(
  client: AltegioDayAccountClient,
  bankGroup: BankAccountGroup | null,
): bigint | null {
  const namedFull = namedBankFullForClientKop(client, bankGroup);
  if (namedFull === 0n) return null;
  return BigInt(client.totalKop) - namedFull;
}

function dayDiffKop(altegio: AltegioDayGroup | null, bank: BankDayFlat | null): bigint {
  const altegioTotal = altegio ? BigInt(altegio.totalKop) : 0n;
  const bankFull = bank ? BigInt(bank.fullTotalKop) : 0n;
  return altegioTotal - bankFull;
}

function formatDiffDisplay(diffKop: bigint): { text: string; className: string } {
  if (diffKop === 0n) {
    return { text: "0,00", className: "text-gray-500" };
  }
  const sign = diffKop > 0n ? "+" : "";
  const className = diffKop > 0n ? "text-amber-800" : "text-red-700";
  return {
    text: `${sign}${formatMoney(diffKop.toString())}`,
    className,
  };
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
          diffKop={0n - bankGroupFullTotalKop(bankGroup)}
          className="border-t border-gray-100"
          title="Банк без Altegio: 0 − повна сума банку"
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
        title="Altegio − банк (повна) по рахунку"
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
                    : "Altegio − банк (повна) по іменованому платежу"
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

function formatClientCount(count: number): string {
  if (count === 1) return "1 клієнт";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} клієнти`;
  return `${count} клієнтів`;
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

function bankKindLabel(kind: BankIncomingItem["kind"]): string {
  if (kind === "universal_bank_aggregate") return "Еквайринг";
  if (kind === "named_incoming") return "Іменований";
  return "Інше";
}

function bankKindClass(kind: BankIncomingItem["kind"]): string {
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
};

export function IncomingSplitView({ onControlsReady }: IncomingSplitViewProps) {
  const [data, setData] = useState<IncomingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(() => new Set());
  const [altegioCashFilter, setAltegioCashFilter] = useState<AltegioCashFilter>("all");

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
      });
      const payload = (await res.json()) as IncomingPreview;
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Не вдалося завантажити вхідні платежі");
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Помилка завантаження");
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

  const altegioDays = data ? groupAltegioPayersByDay(data.altegio.byPayer) : [];
  const filteredAltegioDays = filterAltegioDaysByCash(altegioDays, altegioCashFilter);
  const filteredAltegioTotalKop = sumAltegioDaysKop(filteredAltegioDays);
  const bankDays = data ? regroupBankByDayWithAcquiringShift(data.bank.byDay) : [];
  const bankPeriodTotals = sumBankDaysTotals(bankDays);
  const periodDiffKop = BigInt(filteredAltegioTotalKop) - BigInt(bankPeriodTotals.fullTotalKop);
  const alignedDays = mergeAlignedDays(filteredAltegioDays, bankDays);
  const hasAnyData = altegioDays.length > 0 || bankDays.length > 0;

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
          Немає даних за період.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className={`${SPLIT_ROW_CLASS} border-b border-gray-200 bg-gray-50 text-[10px]`}>
            <table className={`${ALT_TABLE_CLASS} border-r border-gray-200`}>
              <AltegioColGroup />
              <tbody>
                <tr>
                  <td colSpan={4} className="px-1 py-1">
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
            <div className="flex flex-col justify-center border-x border-gray-200 bg-amber-50/50 px-1 py-1 text-center">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-900">Δ</div>
              <div
                className={`text-[10px] font-semibold tabular-nums ${formatDiffDisplay(periodDiffKop).className}`}
                title="Altegio − банк (повна) за період"
              >
                {formatDiffDisplay(periodDiffKop).text}
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
            {alignedDays.map((day) => {
              const accountRows = buildDayAccountAlignedRows(day.altegio, day.bank);

              return (
                <section key={day.kyivDay} className="border-t-2 border-gray-800 first:border-t-0">
                  <div className={`${SPLIT_ROW_CLASS} bg-gray-100 text-[10px]`}>
                    <table className={`${ALT_TABLE_CLASS} border-r border-gray-300`}>
                      <AltegioColGroup />
                      <tbody>
                        <tr>
                          <td colSpan={4} className="px-1 py-1">
                            <h3 className="font-bold uppercase tracking-wide text-gray-900">{day.dayLabel}</h3>
                          </td>
                          <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-emerald-900">
                            {day.altegio ? `${formatMoney(day.altegio.totalKop)} ₴` : "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="flex flex-col justify-center border-x border-gray-300 bg-amber-50/50 px-1 py-1">
                      <DiffValue
                        diffKop={dayDiffKop(day.altegio, day.bank)}
                        title="Altegio − банк (повна) за день"
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
                      <AltegioColGroup />
                      <thead>
                        <tr>
                          <th className="px-0.5 py-0.5" aria-hidden="true" />
                          <th className="px-1 py-0.5 font-medium">Клієнт</th>
                          <th className="px-1 py-0.5 font-medium">Час</th>
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
                    accountRows.map((accountRow) => (
                      <div
                        key={accountRow.matchKey}
                        className={`${SPLIT_ROW_CLASS} items-stretch border-t border-gray-200`}
                      >
                        <div className="border-r border-gray-200 bg-emerald-50/30">
                          {accountRow.altegioAccount ? (
                            <table className={`${ALT_TABLE_CLASS} text-[10px]`}>
                              <AltegioColGroup />
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
                                          {singleClient ? singleClient.payerName : formatClientCount(clientCount)}
                                        </td>
                                        <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-600">
                                          {formatKyivTime(singleClient?.latestOperationTime || account.latestOperationTime)}
                                        </td>
                                        <td className="px-1 py-0.5 font-medium text-gray-900" title={account.accountTitle}>
                                          {account.accountTitle}
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
                                                {client.payerName}
                                              </td>
                                              <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-500">
                                                {client.items.length === 1
                                                  ? formatKyivTime(client.items[0].operationTime)
                                                  : `${client.items.length} оп.`}
                                              </td>
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

                        <div className="border-x border-gray-200">
                          <AccountDiffColumn
                            accountRow={accountRow}
                            kyivDay={day.kyivDay}
                            expandedAccounts={expandedAccounts}
                          />
                        </div>

                        <div className="bg-blue-50/30">
                          {accountRow.bankGroup ? (
                            <table className={`${BANK_TABLE_CLASS} text-[10px]`}>
                              <BankColGroup />
                              <tbody>
                                {accountRow.bankGroup.rows.map((item) => (
                                  <tr key={item.id} className="border-t border-gray-100 hover:bg-blue-50/50">
                                    <td className="px-1 py-0.5 text-gray-800" title={item.accountTitle}>
                                      {item.accountTitle}
                                    </td>
                                    <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-600">
                                      {formatCompactDateTime(item.time)}
                                    </td>
                                    <td className="px-1 py-0.5 text-gray-800" title={bankCounterpartyLabel(item)}>
                                      {bankCounterpartyLabel(item)}
                                    </td>
                                    <td className="px-1 py-0.5">
                                      <span
                                        className={`inline-flex max-w-full truncate rounded px-1 py-0.5 text-[9px] font-medium ${bankKindClass(item.kind)}`}
                                      >
                                        {bankKindLabel(item.kind)}
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
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <EmptyDayCell tone="bank" />
                          )}
                        </div>
                      </div>
                    ))
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
