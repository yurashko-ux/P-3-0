"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

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
      <div>{children}</div>
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

function PayerSection({
  payerName,
  totalKop,
  transactionCount,
  children,
}: {
  payerName: string;
  totalKop: string;
  transactionCount: number;
  children: ReactNode;
}) {
  return (
    <section className="border-t-2 border-gray-800 first:border-t-0">
      <div className="flex items-center justify-between bg-emerald-50 px-2 py-1.5">
        <h3 className="text-[11px] font-bold text-gray-900">{payerName}</h3>
        <div className="flex items-center gap-2 text-[10px] text-gray-600">
          <span>{transactionCount} оп.</span>
          <span className="font-semibold tabular-nums text-emerald-900">{formatMoney(totalKop)} ₴</span>
        </div>
      </div>
      <div className="bg-emerald-50/40 px-1 py-1">{children}</div>
    </section>
  );
}

export function IncomingSplitView() {
  const [data, setData] = useState<IncomingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                {periodLabel} · усі рахунки, агреговано по платнику
              </p>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {!data?.altegio.byPayer.length ? (
                <div className="px-3 py-8 text-center text-xs text-gray-500">Немає платежів за період.</div>
              ) : (
                data.altegio.byPayer.map((payer) => (
                  <PayerSection
                    key={payer.payerName}
                    payerName={payer.payerName}
                    totalKop={payer.totalKop}
                    transactionCount={payer.transactionCount}
                  >
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[10px] uppercase text-gray-500">
                        <tr>
                          <th className="px-2 py-1">Дата</th>
                          <th className="px-2 py-1">Рахунок</th>
                          <th className="px-2 py-1 text-right">Сума</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payer.items.map((item) => (
                          <tr
                            key={`${payer.payerName}-${item.altegioId}-${item.operationTime}`}
                            className="border-t border-white/80 hover:bg-white/60"
                          >
                            <td className="px-2 py-1 tabular-nums text-gray-600">
                              {formatDateTime(item.operationTime)}
                            </td>
                            <td className="px-2 py-1 text-gray-800">{item.accountTitle}</td>
                            <td className="px-2 py-1 text-right font-semibold tabular-nums text-emerald-800">
                              {formatMoney(item.amountKop)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </PayerSection>
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
