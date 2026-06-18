"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

type AltegioClientAggregate = {
  payerName: string;
  totalKop: string;
  transactionCount: number;
  items: Array<{
    altegioId: number;
    documentId: number | null;
    amountKop: string;
    paymentPurpose: string | null;
    paymentMethodUnknown: boolean;
  }>;
};

type AltegioAccountAggregate = {
  accountTitle: string;
  accountId: string | null;
  totalKop: string;
  byClient: AltegioClientAggregate[];
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

type BankAccountAggregate = {
  accountLabel: string;
  accountId: string;
  totalKop: string;
  items: BankIncomingItem[];
};

type IncomingPreview = {
  ok: boolean;
  error?: string;
  dateFrom: string;
  dateTo: string;
  altegio: {
    totalKop: string;
    source: "db" | "live" | "mixed";
    byAccount: AltegioAccountAggregate[];
  };
  bank: {
    totalKop: string;
    byAccount: BankAccountAggregate[];
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

function formatDate(value: string): string {
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

function AccountSection({
  title,
  totalKop,
  children,
}: {
  title: string;
  totalKop: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t-2 border-gray-800 first:border-t-0">
      <div className="flex items-center justify-between bg-gray-50 px-2 py-1.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-800">{title}</h3>
        <span className="text-[11px] font-semibold tabular-nums text-gray-900">{formatMoney(totalKop)} ₴</span>
      </div>
      <div className="px-1 py-1">{children}</div>
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
                <h2 className="text-sm font-semibold text-emerald-900">Altegio — безготівкові</h2>
                <span className="text-[11px] font-semibold tabular-nums text-emerald-900">
                  {formatMoney(data?.altegio.totalKop)} ₴
                </span>
              </div>
              <p className="text-[10px] text-emerald-800">
                {periodLabel} · агреговано по платнику
              </p>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {!data?.altegio.byAccount.length ? (
                <div className="px-3 py-8 text-center text-xs text-gray-500">
                  Немає безготівкових доходів за період.
                </div>
              ) : (
                data.altegio.byAccount.map((account) => (
                  <AccountSection
                    key={`${account.accountId || "na"}-${account.accountTitle}`}
                    title={account.accountTitle}
                    totalKop={account.totalKop}
                  >
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[10px] uppercase text-gray-500">
                        <tr>
                          <th className="px-2 py-1">Платник</th>
                          <th className="px-2 py-1 text-right">Оп.</th>
                          <th className="px-2 py-1 text-right">Сума</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.byClient.map((client) => (
                          <tr
                            key={`${account.accountTitle}-${client.payerName}`}
                            className="border-t border-gray-100 hover:bg-gray-50"
                          >
                            <td className="px-2 py-1 font-medium text-gray-900">{client.payerName}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-gray-600">{client.transactionCount}</td>
                            <td className="px-2 py-1 text-right font-semibold tabular-nums text-emerald-800">
                              {formatMoney(client.totalKop)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </AccountSection>
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
              <p className="text-[10px] text-blue-800">{periodLabel} · операції з розділу Банк</p>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {!data?.bank.byAccount.length ? (
                <div className="px-3 py-8 text-center text-xs text-gray-500">
                  Немає вхідних банківських операцій за період.
                </div>
              ) : (
                data.bank.byAccount.map((account) => (
                  <AccountSection key={account.accountId} title={account.accountLabel} totalKop={account.totalKop}>
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
                          <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-2 py-1 align-top">
                              <div>{formatDate(item.time)}</div>
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
                  </AccountSection>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
