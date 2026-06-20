"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";

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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function DaySection({
  dayLabel,
  totalKop,
  children,
}: {
  dayLabel: string;
  totalKop: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t-2 border-gray-800 first:border-t-0">
      <div className="flex items-center justify-between bg-gray-100 px-2 py-1.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-900">{dayLabel}</h3>
        <span className="text-[11px] font-semibold tabular-nums text-gray-900">{formatMoney(totalKop)} ₴</span>
      </div>
      <div className="bg-emerald-50/30">{children}</div>
    </section>
  );
}

function AccountDayBlock({
  title,
  totalKop,
  tone,
  children,
}: {
  title: string;
  totalKop: string;
  tone: "altegio" | "bank";
  children: ReactNode;
}) {
  const toneClass = tone === "altegio" ? "bg-emerald-50/80" : "bg-blue-50/80";
  return (
    <div className={`${toneClass} border-b border-gray-100 last:border-b-0`}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-700">{title}</span>
        <span className="text-[10px] font-semibold tabular-nums text-gray-800">{formatMoney(totalKop)} ₴</span>
      </div>
      <div className="px-1 pb-1">{children}</div>
    </div>
  );
}

export function IncomingSplitView() {
  const [data, setData] = useState<IncomingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(() => new Set());

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

  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
        <span>
          Період <strong>{periodLabel}</strong> (з 10.06.2026 по сьогодні). Дані Altegio — online + БД. Еквайрінг у
          банку зазвичай надходить <strong>наступного дня</strong>.
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
      ) : (
        <div className="grid min-h-[480px] grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-emerald-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-emerald-900">Altegio — платежі</h2>
                <span className="text-[11px] font-semibold tabular-nums text-emerald-900">
                  {formatMoney(data?.altegio.totalKop)} ₴
                </span>
              </div>
              <p className="text-[10px] text-emerald-800">
                {periodLabel} · рахунок за день (▶ — якщо кілька клієнтів)
              </p>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {!data?.altegio.byPayer.length ? (
                <div className="px-3 py-8 text-center text-xs text-gray-500">Немає платежів за період.</div>
              ) : (
                groupAltegioPayersByDay(data.altegio.byPayer).map((day) => (
                  <DaySection key={day.kyivDay} dayLabel={day.dayLabel} totalKop={day.totalKop}>
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[10px] uppercase text-gray-500">
                        <tr className="border-b border-gray-200">
                          <th className="w-5 px-1 py-1" aria-hidden="true" />
                          <th className="px-2 py-1">Клієнт</th>
                          <th className="px-2 py-1">Дата</th>
                          <th className="px-2 py-1">Рахунок</th>
                          <th className="px-2 py-1 text-right">Сума</th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.accounts.map((account) => {
                          const accountKey = `${day.kyivDay}|${account.accountTitle}`;
                          const expanded = expandedAccounts.has(accountKey);
                          const clientCount = account.clients.length;
                          const singleClient = clientCount === 1 ? account.clients[0] : null;
                          const canExpand = clientCount > 1;

                          return (
                            <Fragment key={accountKey}>
                              <tr className="border-t border-gray-100 hover:bg-emerald-50/60">
                                <td className="px-1 py-1 align-middle">
                                  {canExpand ? (
                                    <ExpandTriangle
                                      expanded={expanded}
                                      label={`${expanded ? "Згорнути" : "Розгорнути"} клієнтів для ${account.accountTitle}`}
                                      onClick={() => toggleAccount(accountKey)}
                                    />
                                  ) : null}
                                </td>
                                <td className="px-2 py-1 text-gray-600">
                                  {singleClient
                                    ? singleClient.payerName
                                    : formatClientCount(clientCount)}
                                </td>
                                <td className="px-2 py-1 tabular-nums text-gray-600">
                                  {formatKyivTime(
                                    singleClient?.latestOperationTime || account.latestOperationTime,
                                  )}
                                </td>
                                <td className="px-2 py-1 font-semibold text-gray-900">{account.accountTitle}</td>
                                <td className="px-2 py-1 text-right font-semibold tabular-nums text-emerald-800">
                                  {formatMoney(account.totalKop)}
                                </td>
                              </tr>
                              {canExpand && expanded
                                ? account.clients.map((client) => (
                                    <tr
                                      key={`${accountKey}|${client.payerName}`}
                                      className="border-t border-gray-50 bg-emerald-50/40"
                                    >
                                      <td className="px-1 py-1" />
                                      <td className="px-2 py-0.5 pl-5 font-medium text-gray-800">{client.payerName}</td>
                                      <td className="px-2 py-0.5 tabular-nums text-[10px] text-gray-500">
                                        {client.items.length === 1
                                          ? formatKyivTime(client.items[0].operationTime)
                                          : `${client.items.length} оп.`}
                                      </td>
                                      <td className="px-2 py-0.5 text-[10px] text-gray-500">↳</td>
                                      <td className="px-2 py-0.5 text-right font-medium tabular-nums text-emerald-700">
                                        {formatMoney(client.totalKop)}
                                      </td>
                                    </tr>
                                  ))
                                : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </DaySection>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-blue-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-blue-900">Банк — вхідні</h2>
                <span className="text-[11px] font-semibold tabular-nums text-blue-900">
                  {formatMoney(data?.bank.totalKop)} ₴
                </span>
              </div>
              <p className="text-[10px] text-blue-800">{periodLabel} · хронологія, групування по рахунках у межах дня</p>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {!data?.bank.byDay.length ? (
                <div className="px-3 py-8 text-center text-xs text-gray-500">
                  Немає вхідних банківських операцій за період.
                </div>
              ) : (
                data.bank.byDay.map((day) => (
                  <DaySection key={day.kyivDay} dayLabel={day.dayLabel} totalKop={day.totalKop}>
                    {day.byAccount.map((account) => (
                      <AccountDayBlock
                        key={`${day.kyivDay}-${account.accountId || "na"}-${account.accountTitle}`}
                        title={account.accountTitle}
                        totalKop={account.totalKop}
                        tone="bank"
                      >
                        <table className="w-full text-left text-[11px]">
                          <thead className="text-[10px] uppercase text-gray-500">
                            <tr>
                              <th className="px-2 py-1">Дата</th>
                              <th className="px-2 py-1">Тип</th>
                              <th className="px-2 py-1 text-right">Сума</th>
                            </tr>
                          </thead>
                          <tbody>
                            {account.items.map((item) => (
                              <tr key={item.id} className="border-t border-white/80 hover:bg-white/60">
                                <td className="px-2 py-1 align-top">
                                  <div>{formatDateTime(item.time)}</div>
                                  <div
                                    className="line-clamp-2 text-[10px] text-gray-600"
                                    title={`${item.description} ${item.comment || ""}`}
                                  >
                                    {item.counterName || item.description || item.comment || "—"}
                                  </div>
                                  {item.commissionRaw ? (
                                    <div className="text-[10px] text-violet-700">{item.commissionRaw}</div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1 align-top">
                                  <span
                                    className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${bankKindClass(item.kind)}`}
                                  >
                                    {bankKindLabel(item.kind)}
                                  </span>
                                </td>
                                <td className="px-2 py-1 text-right align-top font-semibold tabular-nums text-green-700">
                                  {formatMoney(item.amountKop)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </AccountDayBlock>
                    ))}
                  </DaySection>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
