"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ReconciliationRow = {
  bank: {
    id: string;
    time: string;
    description: string;
    comment: string | null;
    counterName: string | null;
    amount: string;
    hold: boolean;
    account: {
      altegioAccountTitle: string | null;
      maskedPan: string | null;
      iban: string | null;
    };
  };
  match: {
    id: string;
    status: string;
    matchType: string;
    matchScore: number | null;
    reviewNote: string | null;
    telegramNotifiedAt: string | null;
    pendingPayment: {
      id: string;
      purposeTitle: string;
      status: string;
      note: string | null;
      createdFrom: string;
      createdBy: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      purpose: {
        id: string;
        title: string;
      } | null;
    } | null;
  } | null;
  altegio: {
    id: string;
    altegioId: number;
    operationDate: string;
    amount: string;
    accountTitle: string | null;
    documentId: number | null;
    categoryTitle: string | null;
    paymentPurpose: string | null;
    comment: string | null;
  } | null;
  candidates?: Array<{
    id: string;
    altegioId: number;
    operationDate: string;
    amount: string;
    documentId: number | null;
    categoryTitle: string | null;
    paymentPurpose: string | null;
    comment: string | null;
  }>;
};

type ApiState = {
  rows: ReconciliationRow[];
  summary: Record<string, number>;
};

const STATUS_OPTIONS = [
  { value: "all", label: "Усі" },
  { value: "open", label: "Незведені" },
  { value: "linked", label: "Зведені" },
];

const ALTEGIO_COMPANY_ID = process.env.NEXT_PUBLIC_ALTEGIO_COMPANY_ID || "1169323";

function kyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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

function isLinked(row: ReconciliationRow): boolean {
  return Boolean(row.altegio);
}

function filterRows(rows: ReconciliationRow[], status: string): ReconciliationRow[] {
  if (status === "linked") return rows.filter(isLinked);
  if (status === "open") return rows.filter((row) => !isLinked(row));
  return rows;
}

function expenseArticle(row: ReconciliationRow): string {
  return (
    row.altegio?.categoryTitle ||
    row.match?.pendingPayment?.purposeTitle ||
    "—"
  );
}

function paymentComment(row: ReconciliationRow): string {
  return (
    row.altegio?.comment ||
    row.altegio?.paymentPurpose ||
    row.match?.pendingPayment?.note ||
    row.bank.comment ||
    row.bank.description ||
    "—"
  );
}

function clamp2Class(extra = ""): string {
  return `line-clamp-2 overflow-hidden leading-tight ${extra}`;
}

function altegioDocumentUrl(documentId: number | null): string | null {
  if (!documentId) return null;
  return `https://yclients.com/finances/documents/${ALTEGIO_COMPANY_ID}?document_id=${documentId}`;
}

export default function PaymentReconciliationPage() {
  const [status, setStatus] = useState("all");
  const [day, setDay] = useState("");
  const [data, setData] = useState<ApiState>({ rows: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionDay = day || kyivTodayYmd();
  const rows = useMemo(() => filterRows(data.rows, status), [data.rows, status]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "300" });
    if (day) {
      params.set("from", day);
      params.set("to", day);
    }
    return params.toString();
  }, [day]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/bank/payment-reconciliation?${query}`, {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Не вдалося завантажити зведення");
      }
      setData({ rows: payload.rows || [], summary: payload.summary || {} });
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function runAction(label: string, url: string, body: Record<string, unknown> = {}) {
    setActionMessage(`${label}: виконується...`);
    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Дія не виконана");
      }
      setActionMessage(`${label}: готово`);
      await loadData();
    } catch (error) {
      setActionMessage(`${label}: ${error instanceof Error ? error.message : "помилка"}`);
    }
  }

  return (
    <main className="min-h-screen bg-base-200 text-gray-900">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
          <Link href="/admin/direct" className="btn btn-ghost btn-xs">
            Direct
          </Link>
          <Link href="/admin/bank" className="btn btn-ghost btn-xs" target="_blank" rel="noopener noreferrer">
            Банк
          </Link>
          <h1 className="text-base font-semibold">Платежі</h1>
          <span className="text-xs text-gray-500">
            {day ? day : "усі дати"} · вихідні безготівкові
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              className="input input-xs input-bordered h-7 min-h-0"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
            <button className="btn btn-xs h-7 min-h-0" disabled={loading || !day} onClick={() => setDay("")}>
              Усі дати
            </button>
            <button
              className="btn btn-primary btn-xs h-7 min-h-0"
              disabled={loading}
              onClick={() =>
                runAction("Підтягнути сьогодні", "/api/admin/bank/payment-reconciliation/sync-today", { day: actionDay })
              }
            >
              Підтягнути сьогодні
            </button>
            <button
              className="btn btn-xs h-7 min-h-0"
              disabled={loading}
              onClick={() => runAction("Telegram", "/api/admin/bank/payment-reconciliation/notify-telegram", { limit: 10 })}
            >
              Telegram
            </button>
            <button className="btn btn-xs h-7 min-h-0" disabled={loading} onClick={() => void loadData()}>
              Оновити
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                status === option.value ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </button>
          ))}
          <span className="text-xs text-gray-500">
            зведено: {data.rows.filter(isLinked).length} · не зведено: {data.rows.filter((row) => !isLinked(row)).length}
          </span>
        </div>
      </div>

      {actionMessage ? (
        <div className="mx-3 mt-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-900">
          {actionMessage}
        </div>
      ) : null}

      <div className="p-2">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-[1240px] w-full table-fixed text-left text-xs">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="w-[92px] px-2 py-1.5">Статус</th>
                <th className="w-[145px] px-2 py-1.5">Банк</th>
                <th className="w-[90px] px-2 py-1.5">Сума</th>
                <th className="w-[260px] px-2 py-1.5">Контрагент / призначення</th>
                <th className="w-[190px] px-2 py-1.5">Стаття розходу</th>
                <th className="w-[300px] px-2 py-1.5">Коментар</th>
                <th className="w-[160px] px-2 py-1.5">Документ</th>
                <th className="w-[90px] px-2 py-1.5">Дії</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-2 py-8 text-center text-gray-500">
                    Завантаження...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-8 text-center text-gray-500">
                    Немає платежів для вибраного фільтра.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.bank.id}
                    className={`h-12 max-h-12 border-t border-gray-100 align-top ${
                      isLinked(row) ? "bg-emerald-50/70 hover:bg-emerald-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="h-12 px-2 py-1">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          isLinked(row) ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {isLinked(row) ? "Зведено" : "Не зведено"}
                      </span>
                    </td>
                    <td className="h-12 px-2 py-1">
                      <div className="font-medium">{formatDate(row.bank.time)}</div>
                      {row.bank.hold ? (
                        <div className="mt-0.5 inline-flex rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
                          Hold
                        </div>
                      ) : null}
                      <div className="text-[11px] text-gray-500">
                        {row.bank.account.altegioAccountTitle || row.bank.account.maskedPan || row.bank.account.iban || "Рахунок"}
                      </div>
                    </td>
                    <td className="h-12 px-2 py-1 font-semibold text-red-700">{formatMoney(row.bank.amount)}</td>
                    <td className="h-12 px-2 py-1">
                      <div className={clamp2Class("font-medium")}>{row.bank.counterName || "—"}</div>
                      <div className={clamp2Class("text-[11px] text-gray-600")}>
                        {row.bank.comment || row.bank.description || "Без призначення"}
                      </div>
                    </td>
                    <td className="h-12 px-2 py-1">
                      <div className={clamp2Class("font-medium")}>{expenseArticle(row)}</div>
                    </td>
                    <td className="h-12 px-2 py-1">
                      <div className={clamp2Class("text-[11px] text-gray-600")}>{paymentComment(row)}</div>
                    </td>
                    <td className="h-12 px-2 py-1 text-[11px] text-gray-600">
                      {row.altegio ? (
                        <>
                          <div>{formatDate(row.altegio.operationDate)}</div>
                          {altegioDocumentUrl(row.altegio.documentId) ? (
                            <a
                              href={altegioDocumentUrl(row.altegio.documentId) || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-700 underline-offset-2 hover:underline"
                            >
                              Документ: {row.altegio.documentId}
                            </a>
                          ) : (
                            <div>Документ: —</div>
                          )}
                          <div>ID: {row.altegio.altegioId}</div>
                          <div>Сума: {formatMoney(row.altegio.amount)}</div>
                        </>
                      ) : row.candidates && row.candidates.length > 0 ? (
                        <div className="space-y-1">
                          {row.candidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              className="block h-10 w-full overflow-hidden rounded border border-blue-200 bg-blue-50 px-2 py-1 text-left text-[11px] hover:bg-blue-100"
                              onClick={() =>
                                runAction("Ручне зведення", "/api/admin/bank/payment-reconciliation/match", {
                                  bankStatementItemId: row.bank.id,
                                  altegioFinanceTransactionId: candidate.id,
                                })
                              }
                            >
                              <div className={clamp2Class("font-medium")}>
                                #{candidate.altegioId} · {formatDate(candidate.operationDate)} · {formatMoney(candidate.amount)}
                              </div>
                              <div className={clamp2Class("text-gray-600")}>
                                {candidate.paymentPurpose || candidate.categoryTitle || candidate.comment || "Без призначення"}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="h-12 px-2 py-1">
                      <div className="flex flex-col gap-0.5">
                        <button
                          className="btn btn-xs h-6 min-h-0"
                          onClick={() =>
                            runAction("Telegram", "/api/admin/bank/payment-reconciliation/notify-telegram", {
                              bankStatementItemId: row.bank.id,
                              force: true,
                            })
                          }
                        >
                          Telegram
                        </button>
                        {row.altegio ? (
                          <button
                            className="btn btn-xs h-6 min-h-0"
                            onClick={() =>
                              runAction("Відв'язати", "/api/admin/bank/payment-reconciliation/unmatch", {
                                bankStatementItemId: row.bank.id,
                              })
                            }
                          >
                            Відв'язати
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
