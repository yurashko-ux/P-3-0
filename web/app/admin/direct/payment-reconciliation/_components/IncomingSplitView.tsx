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

function formatMoney(kopiykas: string | null | undefined): string {
  const value = Number(kopiykas || 0) / 100;
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPeriodLabel(dateFrom: string, dateTo: string): string {
  const from = dateFrom.split("-").reverse().join(".");
  const to = dateTo.split("-").reverse().join(".");
  return from === to ? from : `${from} — ${to}`;
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
  rows: BankDayItemRow[];
};

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
    const totalKop = rows.reduce((sum, row) => sum + BigInt(row.amountKop), 0n);
    return {
      kyivDay,
      dayLabel: formatKyivDayLabel(kyivDay),
      totalKop: totalKop.toString(),
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

function EmptyDayCell({ tone }: { tone: "altegio" | "bank" }) {
  const bg = tone === "altegio" ? "bg-emerald-50/20" : "bg-blue-50/20";
  return <div className={`flex h-full min-h-[2.5rem] items-center justify-center px-2 py-3 text-[10px] text-gray-400 ${bg}`}>—</div>;
}

export function IncomingSplitView() {
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

  const periodLabel = data ? formatPeriodLabel(data.dateFrom, data.dateTo) : "10.06.2026 — …";
  const altegioDays = data ? groupAltegioPayersByDay(data.altegio.byPayer) : [];
  const filteredAltegioDays = filterAltegioDaysByCash(altegioDays, altegioCashFilter);
  const filteredAltegioTotalKop = sumAltegioDaysKop(filteredAltegioDays);
  const bankDays = data ? regroupBankByDayWithAcquiringShift(data.bank.byDay) : [];
  const alignedDays = mergeAlignedDays(filteredAltegioDays, bankDays);
  const hasAnyData = altegioDays.length > 0 || bankDays.length > 0;

  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
        <span>
          Період <strong>{periodLabel}</strong> (з 10.06.2026 по сьогодні). Дані Altegio — online + БД. Еквайринг у
          банку для звірки зсунуто на <strong>−1 день</strong> (дата в рядку — фактична).
        </span>
        {data?.hints.commissionPercent != null ? (
          <span className="rounded bg-white px-2 py-0.5">Комісія: {data.hints.commissionPercent}%</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-xs h-7 min-h-0 px-2 text-[10px]"
          disabled={loading}
          onClick={() => void loadData()}
        >
          Оновити
        </button>
        {data ? (
          <span className="text-[10px] text-gray-500">
            Джерело Altegio:{" "}
            {data.altegio.source === "db" ? "БД" : data.altegio.source === "live" ? "Online" : "Online + БД"}
            {data.altegio.stats
              ? ` · online ${data.altegio.stats.liveRows}, БД ${data.altegio.stats.dbRows}, разом ${data.altegio.stats.mergedRows}`
              : ""}
          </span>
        ) : null}
      </div>

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
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="grid grid-cols-2 border-b border-gray-200">
            <div className="border-r border-gray-200 bg-emerald-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-emerald-900">Altegio — платежі</h2>
                <span className="text-[11px] font-semibold tabular-nums text-emerald-900">
                  {formatMoney(filteredAltegioTotalKop)} ₴
                </span>
              </div>
              <p className="text-[10px] text-emerald-800">{periodLabel} · рахунок/день (▶ — кілька клієнтів)</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {ALTEGIO_CASH_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
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
            </div>
            <div className="bg-blue-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-blue-900">Банк — вхідні</h2>
                <span className="text-[11px] font-semibold tabular-nums text-blue-900">
                  {formatMoney(data?.bank.totalKop)} ₴
                </span>
              </div>
              <p className="text-[10px] text-blue-800">{periodLabel} · рахунки навпроти Altegio · колонка «Повна» = сума + комісія</p>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {alignedDays.map((day) => {
              const accountRows = buildDayAccountAlignedRows(day.altegio, day.bank);

              return (
                <section key={day.kyivDay} className="border-t-2 border-gray-800 first:border-t-0">
                  <div className="grid grid-cols-2 bg-gray-100">
                    <div className="flex items-center justify-between border-r border-gray-300 px-2 py-1">
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-900">{day.dayLabel}</h3>
                      <span className="text-[11px] font-semibold tabular-nums text-emerald-900">
                        {day.altegio ? `${formatMoney(day.altegio.totalKop)} ₴` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-2 py-1">
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-900">{day.dayLabel}</h3>
                      <span className="text-[11px] font-semibold tabular-nums text-blue-900">
                        {day.bank ? `${formatMoney(day.bank.totalKop)} ₴` : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50/90 text-[9px] uppercase text-gray-500">
                    <table className="w-full table-fixed border-r border-gray-200 text-left">
                      <thead>
                        <tr>
                          <th className="w-4 px-0.5 py-0.5" aria-hidden="true" />
                          <th className="w-[28%] px-1 py-0.5 font-medium">Клієнт</th>
                          <th className="w-[14%] px-1 py-0.5 font-medium">Час</th>
                          <th className="w-[28%] px-1 py-0.5 font-medium">Рахунок</th>
                          <th className="w-[18%] px-1 py-0.5 text-right font-medium">Сума</th>
                        </tr>
                      </thead>
                    </table>
                    <table className="w-full table-fixed text-left">
                      <thead>
                        <tr>
                          <th className="w-[20%] px-1 py-0.5 font-medium">Рахунок</th>
                          <th className="w-[14%] px-1 py-0.5 font-medium">Дата</th>
                          <th className="w-[22%] px-1 py-0.5 font-medium">Контрагент</th>
                          <th className="w-[12%] px-1 py-0.5 font-medium">Тип</th>
                          <th className="w-[9%] px-1 py-0.5 text-right font-medium">Ком.</th>
                          <th className="w-[11%] px-1 py-0.5 text-right font-medium">Сума</th>
                          <th className="w-[12%] px-1 py-0.5 text-right font-medium">Повна</th>
                        </tr>
                      </thead>
                    </table>
                  </div>

                  {accountRows.length === 0 ? (
                    <div className="grid grid-cols-2">
                      <EmptyDayCell tone="altegio" />
                      <EmptyDayCell tone="bank" />
                    </div>
                  ) : (
                    accountRows.map((accountRow) => (
                      <div
                        key={accountRow.matchKey}
                        className="grid grid-cols-2 items-stretch border-t border-gray-200"
                      >
                        <div className="border-r border-gray-200 bg-emerald-50/30">
                          {accountRow.altegioAccount ? (
                            <table className="w-full table-fixed text-left text-[10px]">
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
                                        <td className="truncate px-1 py-0.5 text-gray-800" title={singleClient?.payerName}>
                                          {singleClient ? singleClient.payerName : formatClientCount(clientCount)}
                                        </td>
                                        <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-600">
                                          {formatKyivTime(singleClient?.latestOperationTime || account.latestOperationTime)}
                                        </td>
                                        <td className="truncate px-1 py-0.5 font-medium text-gray-900" title={account.accountTitle}>
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
                                              <td className="truncate px-1 py-0.5 pl-3 font-medium text-gray-800" title={client.payerName}>
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

                        <div className="bg-blue-50/30">
                          {accountRow.bankGroup ? (
                            <table className="w-full table-fixed text-left text-[10px]">
                              <tbody>
                                {accountRow.bankGroup.rows.map((item) => (
                                  <tr key={item.id} className="border-t border-gray-100 hover:bg-blue-50/50">
                                    <td className="truncate px-1 py-0.5 text-gray-800" title={item.accountTitle}>
                                      {item.accountTitle}
                                    </td>
                                    <td className="whitespace-nowrap px-1 py-0.5 tabular-nums text-gray-600">
                                      {formatCompactDateTime(item.time)}
                                    </td>
                                    <td className="truncate px-1 py-0.5 text-gray-800" title={bankCounterpartyLabel(item)}>
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
        </div>
      )}
    </div>
  );
}
