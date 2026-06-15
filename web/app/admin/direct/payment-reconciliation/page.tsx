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
  { value: "needs_review", label: "Потребують розбору" },
  { value: "conflict", label: "Конфлікти" },
  { value: "awaiting_altegio_document", label: "Очікують Altegio" },
  { value: "auto_matched", label: "Авто" },
  { value: "manual_matched", label: "Ручні" },
  { value: "ignored", label: "Ігноровані" },
  { value: "unmatched", label: "Без статусу" },
];

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

function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "auto_matched":
      return "Авто";
    case "manual_matched":
      return "Ручне";
    case "needs_review":
      return "Розбір";
    case "conflict":
      return "Конфлікт";
    case "awaiting_altegio_document":
      return "Очікує Altegio";
    case "ignored":
      return "Ігнор";
    default:
      return "Без статусу";
  }
}

function statusClass(status: string | null | undefined): string {
  switch (status) {
    case "auto_matched":
    case "manual_matched":
      return "bg-emerald-100 text-emerald-800";
    case "conflict":
      return "bg-red-100 text-red-800";
    case "awaiting_altegio_document":
      return "bg-blue-100 text-blue-800";
    case "ignored":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function isTransferPending(row: ReconciliationRow): boolean {
  return row.match?.pendingPayment?.purposeTitle?.trim().toLowerCase().startsWith("переміщення") ?? false;
}

export default function PaymentReconciliationPage() {
  const [status, setStatus] = useState("all");
  const [day, setDay] = useState("");
  const [data, setData] = useState<ApiState>({ rows: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionDay = day || kyivTodayYmd();

  const query = useMemo(() => {
    const params = new URLSearchParams({
      status,
      limit: "300",
    });
    if (day) {
      params.set("from", day);
      params.set("to", day);
    }
    return params.toString();
  }, [day, status]);

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
      const result = payload.result || {};
      const purposeTitles = Array.isArray(result.purposes)
        ? result.purposes.slice(0, 8).map((purpose: { title?: string; externalId?: string }) =>
            `${purpose.title || "Без назви"}${purpose.externalId ? ` #${purpose.externalId}` : ""}`,
          )
        : [];
      const details =
        typeof result.foundPurposes === "number"
          ? `: знайдено статей ${result.foundPurposes}, імпортовано ${result.upserted || 0}${
              purposeTitles.length > 0 ? ` (${purposeTitles.join(", ")})` : ""
            }`
          : "";
      setActionMessage(`${label}: готово${details}`);
      await loadData();
    } catch (error) {
      setActionMessage(`${label}: ${error instanceof Error ? error.message : "помилка"}`);
    }
  }

  return (
    <main className="min-h-screen bg-base-200 text-gray-900">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Link href="/admin/direct" className="btn btn-ghost btn-sm">
            Direct
          </Link>
          <Link href="/admin/bank" className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer">
            Банк
          </Link>
          <h1 className="text-lg font-semibold">Зведення платежів</h1>
          <span className="text-xs text-gray-500">
            {day ? `день ${day}` : "усі підвантажені дати"}, лише вихідні безготівкові платежі
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <input
              type="date"
              className="input input-sm input-bordered"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
            <button className="btn btn-sm" disabled={loading || !day} onClick={() => setDay("")}>
              Усі дати
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={loading}
              onClick={() =>
                runAction("Підтягнути сьогодні", "/api/admin/bank/payment-reconciliation/sync-today", { day: actionDay })
              }
            >
              Підтягнути сьогодні
            </button>
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() =>
                runAction("Sync Altegio", "/api/admin/altegio/finance-transactions-sync", {
                  dateFrom: actionDay,
                  dateTo: actionDay,
                })
              }
            >
              Sync Altegio день
            </button>
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() =>
                runAction("Тест статей", "/api/admin/altegio/payment-purposes-import", {
                  dateFrom: "2026-06-01",
                  dateTo: actionDay,
                  dryRun: true,
                  maxPages: 5,
                })
              }
            >
              Тест статей
            </button>
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() =>
                runAction("Імпорт статей", "/api/admin/altegio/payment-purposes-import", {
                  dateFrom: "2026-06-01",
                  dateTo: actionDay,
                  dryRun: false,
                  maxPages: 5,
                })
              }
            >
              Імпорт статей
            </button>
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() => runAction("Звести", "/api/admin/bank/payment-reconciliation/reconcile", { from: actionDay, to: actionDay })}
            >
              Звести
            </button>
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() => runAction("Telegram", "/api/admin/bank/payment-reconciliation/notify-telegram", { limit: 10 })}
            >
              Telegram
            </button>
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() =>
                runAction("Webhook TG", "/api/admin/bank/payment-reconciliation/register-telegram-webhook")
              }
            >
              Webhook TG
            </button>
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() =>
                runAction("Видалити TG тест", "/api/admin/bank/payment-reconciliation/delete-telegram-messages", {
                  day: actionDay,
                  dryRun: false,
                })
              }
            >
              Видалити TG тест
            </button>
            <button className="btn btn-sm" disabled={loading} onClick={() => void loadData()}>
              Оновити
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`rounded-full px-3 py-1 text-xs ${
                status === option.value ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </button>
          ))}
          <span className="text-xs text-gray-500">
            auto: {data.summary.auto_matched || 0} · manual: {data.summary.manual_matched || 0} · review:{" "}
            {data.summary.needs_review || 0} · conflict: {data.summary.conflict || 0}
          </span>
        </div>
      </div>

      {actionMessage ? (
        <div className="mx-4 mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {actionMessage}
        </div>
      ) : null}

      <div className="p-4">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-[1200px] w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Банк</th>
                <th className="px-3 py-2">Сума</th>
                <th className="px-3 py-2">Контрагент / призначення</th>
                <th className="px-3 py-2">Altegio</th>
                <th className="px-3 py-2">Документ</th>
                <th className="px-3 py-2">Дії</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                    Завантаження...
                  </td>
                </tr>
              ) : data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                    Немає платежів для вибраного фільтра.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.bank.id} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.match?.status)}`}>
                        {statusLabel(row.match?.status)}
                      </span>
                      {row.match?.matchScore != null ? (
                        <div className="mt-1 text-xs text-gray-500">score {row.match.matchScore}</div>
                      ) : null}
                      {row.match?.pendingPayment ? (
                        <div
                          className={`mt-2 rounded-md px-2 py-1 text-[11px] ${
                            isTransferPending(row) ? "bg-purple-50 text-purple-800" : "bg-blue-50 text-blue-800"
                          }`}
                        >
                          <div className="font-semibold">
                            {isTransferPending(row) ? "Переміщення" : "Очікує статтю"}
                          </div>
                          <div>{row.match.pendingPayment.purposeTitle}</div>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{formatDate(row.bank.time)}</div>
                      {row.bank.hold ? (
                        <div className="mt-1 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">
                          Hold
                        </div>
                      ) : null}
                      <div className="text-xs text-gray-500">
                        {row.bank.account.altegioAccountTitle || row.bank.account.maskedPan || row.bank.account.iban || "Рахунок"}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-red-700">{formatMoney(row.bank.amount)}</td>
                    <td className="px-3 py-2 max-w-[360px]">
                      <div className="font-medium">{row.bank.counterName || "—"}</div>
                      <div className="text-xs text-gray-600">{row.bank.comment || row.bank.description || "Без призначення"}</div>
                    </td>
                    <td className="px-3 py-2 max-w-[320px]">
                      {row.altegio ? (
                        <>
                          <div className="font-medium">{formatDate(row.altegio.operationDate)}</div>
                          <div className="text-xs text-gray-600">
                            {row.altegio.paymentPurpose || row.altegio.categoryTitle || row.altegio.comment || "Без призначення"}
                          </div>
                        </>
                      ) : row.candidates && row.candidates.length > 0 ? (
                        <div className="space-y-1">
                          {row.candidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              className="block w-full rounded border border-blue-200 bg-blue-50 px-2 py-1 text-left text-xs hover:bg-blue-100"
                              onClick={() =>
                                runAction("Ручне зведення", "/api/admin/bank/payment-reconciliation/match", {
                                  bankStatementItemId: row.bank.id,
                                  altegioFinanceTransactionId: candidate.id,
                                })
                              }
                            >
                              <div className="font-medium">
                                #{candidate.altegioId} · {formatDate(candidate.operationDate)} · {formatMoney(candidate.amount)}
                              </div>
                              <div className="text-gray-600">
                                {candidate.paymentPurpose || candidate.categoryTitle || candidate.comment || "Без призначення"}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">Не прив'язано</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {row.altegio ? (
                        <>
                          <div>ID: {row.altegio.altegioId}</div>
                          <div>Документ: {row.altegio.documentId || "—"}</div>
                          <div>Сума: {formatMoney(row.altegio.amount)}</div>
                        </>
                      ) : row.match?.pendingPayment ? (
                        <>
                          <div className="font-medium">
                            {isTransferPending(row) ? "Очікує переміщення Altegio" : "Очікує документ Altegio"}
                          </div>
                          <div>{row.match.pendingPayment.purposeTitle}</div>
                          {row.match.pendingPayment.note ? <div>{row.match.pendingPayment.note}</div> : null}
                        </>
                      ) : (
                        row.match?.reviewNote || "Очікує дії"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <button
                          className="btn btn-xs"
                          onClick={() =>
                            runAction("Telegram", "/api/admin/bank/payment-reconciliation/notify-telegram", {
                              bankStatementItemId: row.bank.id,
                              force: true,
                            })
                          }
                        >
                          Telegram
                        </button>
                        <button
                          className="btn btn-xs"
                          onClick={() =>
                            runAction("Ігнор", "/api/admin/bank/payment-reconciliation/match", {
                              bankStatementItemId: row.bank.id,
                              action: "ignore",
                            })
                          }
                        >
                          Ігнор
                        </button>
                        {row.altegio ? (
                          <button
                            className="btn btn-xs"
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
