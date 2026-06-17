"use client";

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
    balanceAfter: string | null;
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
    matchedAt: string | null;
    reviewNote: string | null;
    telegramNotifiedAt: string | null;
    reconciliationNumber: number | null;
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
  { value: "open", label: "Не зведені" },
  { value: "linked", label: "Зведені" },
];

const ALTEGIO_COMPANY_ID = process.env.NEXT_PUBLIC_ALTEGIO_COMPANY_ID || "1169323";

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

function formatTelegramSentAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("uk-UA", {
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

function emptyTableMessage(status: string): string {
  if (status === "all") return "Платежів немає.";
  return status === "linked" ? "Зведених платежів немає." : "Незведених платежів немає.";
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

/** Призначення + опис банку (обидва рядки, якщо є). */
function bankPurposeLines(row: ReconciliationRow): string[] {
  const comment = row.bank.comment?.trim() || "";
  const description = row.bank.description?.trim() || "";
  const lines: string[] = [];
  if (comment) lines.push(comment);
  if (description && description !== comment) lines.push(description);
  return lines;
}

function clamp2Class(extra = ""): string {
  return `line-clamp-2 overflow-hidden leading-tight ${extra}`;
}

function altegioDocumentLink(altegio: ReconciliationRow["altegio"]): { href: string; label: string } | null {
  if (!altegio) return null;
  const href = `https://app.alteg.io/finances/transactions/edit/${ALTEGIO_COMPANY_ID}/${altegio.altegioId}`;
  if (altegio.documentId) {
    return {
      href,
      label: `Документ: ${altegio.documentId}`,
    };
  }
  return {
    href,
    label: `Операція: ${altegio.altegioId}`,
  };
}

function cellClass(extra = ""): string {
  return `h-10 max-h-10 overflow-hidden px-2 py-0.5 align-middle ${extra}`;
}

function actionsCellClass(): string {
  return "min-h-10 overflow-visible px-2 py-0.5 align-top";
}

function statusCellClass(): string {
  return "min-h-10 overflow-visible px-2 py-0.5 align-top";
}

export default function PaymentReconciliationPage() {
  const [status, setStatus] = useState("open");
  const [data, setData] = useState<ApiState>({ rows: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const rows = useMemo(() => filterRows(data.rows, status), [data.rows, status]);
  const statusCounts = useMemo(() => {
    const linked = data.rows.filter(isLinked).length;
    return {
      all: data.rows.length,
      open: data.rows.length - linked,
      linked,
    };
  }, [data.rows]);

  const query = useMemo(() => new URLSearchParams({ limit: "300" }).toString(), []);

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
      const result = payload.result as
        | { skipped?: boolean; reconciled?: boolean; sent?: number; reason?: string }
        | undefined;
      if (result?.skipped) {
        const reason =
          result.reason === "already_notified"
            ? "вже надіслано раніше"
            : result.reason === "already_linked"
              ? "платіж уже зведено"
              : result.reason === "awaiting_document"
                ? "очікує документ Altegio"
                : result.reason || "пропущено";
        setActionMessage(`${label}: ${reason}`);
      } else if (result?.reconciled) {
        setActionMessage(`${label}: автоматично зведено в Altegio`);
      } else if (typeof result?.sent === "number") {
        setActionMessage(`${label}: надіслано (${result.sent})`);
      } else {
        setActionMessage(`${label}: готово`);
      }
      await loadData();
    } catch (error) {
      setActionMessage(`${label}: ${error instanceof Error ? error.message : "помилка"}`);
    }
  }

  function formatStatusFilterLabel(value: string, label: string): string {
    if (value === "all") return `${label} (${statusCounts.all})`;
    if (value === "open") return `${label} (${statusCounts.open})`;
    if (value === "linked") return `${label} (${statusCounts.linked})`;
    return label;
  }

  return (
    <main className="min-h-screen bg-base-200 text-gray-900">
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-1 px-2 py-0.5">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium leading-4 ${
                status === option.value ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              onClick={() => setStatus(option.value)}
            >
              {formatStatusFilterLabel(option.value, option.label)}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <button
              className="btn btn-primary btn-xs h-6 min-h-0 px-2 text-[10px]"
              disabled={loading}
              onClick={() => void loadData()}
            >
              Оновити
            </button>
          </div>
        </div>
      </div>

      {actionMessage ? (
        <div className="mx-3 mt-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-900">
          {actionMessage}
        </div>
      ) : null}

      <div className="p-2">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-[1520px] w-full table-fixed text-left text-xs">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="w-[56px] px-2 py-1.5">№ зведення</th>
                <th className="w-[92px] px-2 py-1.5">Статус</th>
                <th className="w-[145px] px-2 py-1.5">Банк</th>
                <th className="w-[90px] px-2 py-1.5">Сума</th>
                <th
                  className="w-[120px] px-2 py-1.5"
                  title="Залишок на банківському рахунку після операції (monobank)"
                >
                  Залишки на рахунках
                </th>
                <th className="w-[160px] px-2 py-1.5">Документ</th>
                <th className="w-[260px] px-2 py-1.5">Контрагент / призначення</th>
                <th className="w-[190px] px-2 py-1.5">Стаття розходу</th>
                <th className="w-[300px] px-2 py-1.5">Коментар</th>
                <th className="w-[108px] px-2 py-1.5">Дії</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-2 py-8 text-center text-gray-500">
                    Завантаження...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 py-8 text-center text-gray-500">
                    {emptyTableMessage(status)}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const telegramSentAt = formatTelegramSentAt(row.match?.telegramNotifiedAt);
                  const matchedAt = formatTelegramSentAt(row.match?.matchedAt);
                  const commentText = paymentComment(row);
                  const purposeLines = bankPurposeLines(row);
                  return (
                  <tr
                    key={row.bank.id}
                    className={`min-h-10 border-t border-gray-100 ${
                      isLinked(row) ? "bg-emerald-50/70 hover:bg-emerald-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className={cellClass("text-center font-semibold tabular-nums text-gray-800")}>
                      {row.match?.reconciliationNumber ?? "—"}
                    </td>
                    <td className={statusCellClass()}>
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isLinked(row) ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {isLinked(row) ? "Зведено" : "Не зведено"}
                        </span>
                        {isLinked(row) && matchedAt ? (
                          <span className="text-[9px] leading-tight text-emerald-700" title="Дата зведення">
                            {matchedAt}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={cellClass()}>
                      <div className="font-medium">{formatDate(row.bank.time)}</div>
                      <div className="text-[11px] text-gray-500">
                        {row.bank.account.altegioAccountTitle || row.bank.account.maskedPan || row.bank.account.iban || "Рахунок"}
                      </div>
                    </td>
                    <td className={cellClass("font-semibold text-red-700")}>{formatMoney(row.bank.amount)}</td>
                    <td className={cellClass("font-medium tabular-nums text-gray-800")}>
                      {row.bank.balanceAfter ? `${formatMoney(row.bank.balanceAfter)} ₴` : "—"}
                    </td>
                    <td className={cellClass("text-[11px] text-gray-600")}>
                      {row.altegio ? (
                        <div className="flex flex-col">
                          {altegioDocumentLink(row.altegio) ? (
                            <a
                              href={altegioDocumentLink(row.altegio)?.href || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-700 underline-offset-2 hover:underline"
                            >
                              {altegioDocumentLink(row.altegio)?.label}
                            </a>
                          ) : (
                            <div>Документ: —</div>
                          )}
                          <span
                            className="truncate text-[10px] text-gray-500"
                            title={`Час операції в Altegio (коли запис створено в системі; банк: ${formatDate(row.bank.time)})`}
                          >
                            {formatDate(row.altegio.operationDate)} · {formatMoney(row.altegio.amount)}
                          </span>
                        </div>
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
                    <td className={cellClass()}>
                      <div className={clamp2Class("font-medium")}>{row.bank.counterName || "—"}</div>
                      {purposeLines.length > 0 ? (
                        purposeLines.map((line, index) => (
                          <div key={`${row.bank.id}-purpose-${index}`} className={clamp2Class("text-[11px] text-gray-600")}>
                            {line}
                          </div>
                        ))
                      ) : (
                        <div className={clamp2Class("text-[11px] text-gray-600")}>Без призначення</div>
                      )}
                    </td>
                    <td className={cellClass()}>
                      <div className={clamp2Class("font-medium")}>{expenseArticle(row)}</div>
                    </td>
                    <td className={cellClass()}>
                      <div className={clamp2Class("text-[11px] text-gray-600")} title={commentText}>
                        {commentText}
                      </div>
                    </td>
                    <td className={actionsCellClass()}>
                      <div className="flex min-w-[96px] flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <button
                            className={`btn btn-xs h-5 min-h-0 px-1.5 text-[10px] ${
                              telegramSentAt
                                ? "border-blue-500 bg-blue-100 text-blue-800 hover:bg-blue-200"
                                : ""
                            }`}
                            title={
                              telegramSentAt
                                ? `Повідомлення в Telegram надіслано ${telegramSentAt}`
                                : "Надіслати в Telegram для зведення"
                            }
                            onClick={() =>
                              runAction("Telegram", "/api/admin/bank/payment-reconciliation/notify-telegram", {
                                bankStatementItemId: row.bank.id,
                                force: Boolean(telegramSentAt),
                              })
                            }
                          >
                            Telegram
                          </button>
                          {row.altegio ? (
                            <button
                              className="btn btn-xs h-5 min-h-0 px-1.5 text-[10px]"
                              onClick={() =>
                                runAction("Відв'язати", "/api/admin/bank/payment-reconciliation/unmatch", {
                                  bankStatementItemId: row.bank.id,
                                })
                              }
                            >
                              Відв&apos;язати
                            </button>
                          ) : null}
                        </div>
                        {telegramSentAt ? (
                          <div className="text-[9px] leading-tight text-blue-700" title="Час відправки в Telegram">
                            {telegramSentAt}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
