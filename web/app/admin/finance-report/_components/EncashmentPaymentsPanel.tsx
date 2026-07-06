"use client";

// Панель підтвердження інкасації: список платежів, галочки, відправка власниці.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EncashmentConfirmationSummary } from "@/lib/finance/encashment-confirmation";

interface EncashmentPaymentsPanelProps {
  year: number;
  month: number;
  initialSummary: EncashmentConfirmationSummary;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" });
}

function statusLabel(status: EncashmentConfirmationSummary["payments"][0]["status"]): string {
  switch (status) {
    case "not_sent":
      return "Не відправлено";
    case "pending_owner":
      return "Очікує власниці";
    case "owner_confirmed":
      return "Підтверджено ✓";
    case "rejected":
      return "Відхилено";
    case "cancelled":
      return "Скасовано";
    default:
      return status;
  }
}

export function EncashmentPaymentsPanel({
  year,
  month,
  initialSummary,
}: EncashmentPaymentsPanelProps) {
  const router = useRouter();
  const summary = initialSummary;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [webhookPending, startWebhookTransition] = useTransition();
  const [webhookMessage, setWebhookMessage] = useState<string | null>(null);

  const selectablePayments = useMemo(
    () => summary.payments.filter((p) => p.status === "not_sent"),
    [summary],
  );

  const toggleSelect = (altegioId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(altegioId)) next.delete(altegioId);
      else next.add(altegioId);
      return next;
    });
  };

  const handleSend = () => {
    if (selectedIds.size === 0) {
      setError("Оберіть хоча б один платіж");
      return;
    }

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/finance-report/encashment-confirmation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            year,
            month,
            altegioIds: Array.from(selectedIds),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Не вдалося відправити");
        }

        const parts = [`Відправлено: ${data.sent}`];
        if (data.skipped) parts.push(`пропущено: ${data.skipped}`);
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          parts.push(data.errors.join("; "));
        }
        setSuccess(parts.join(". "));
        setSelectedIds(new Set());
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Помилка відправки");
      }
    });
  };

  const handleRegisterWebhook = () => {
    setWebhookMessage(null);
    setError(null);

    startWebhookTransition(async () => {
      try {
        const res = await fetch("/api/admin/finance-report/register-reports-telegram-webhook", {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Не вдалося підключити webhook");
        }
        setWebhookMessage(
          data.registered
            ? "Бот звітів підключено. Тепер натисніть /start у Telegram і повторіть відправку."
            : `Webhook зареєстровано: ${data.webhookUrl || "—"}. Натисніть /start у боті.`,
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Помилка підключення бота");
      }
    });
  };

  const periodBanner = (() => {
    if (summary.periodStatus === "closed") {
      return (
        <p className="mt-2 rounded bg-green-100 p-1.5 text-green-800 font-semibold">
          Інкасація підтверджена, період закрито
          {summary.periodClosedAt ? ` (${formatDate(summary.periodClosedAt)})` : ""}
        </p>
      );
    }
    if (summary.periodStatus === "partially_confirmed") {
      return (
        <p className="mt-2 rounded bg-amber-50 p-1.5 text-amber-800">
          Інкасація підтверджена частково
        </p>
      );
    }
    return null;
  })();

  return (
    <div className="mt-2 border-t border-blue-100 pt-2 text-xs">
      {periodBanner}

      <div className="mt-2">
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Сховати платежі" : "Показати платежі"}
        </button>
      </div>

      {!summary.ownerChatIdsConfigured && (
        <div className="mt-2 rounded-md border-2 border-amber-400 bg-amber-50 p-2 space-y-2">
          {summary.ownerSetupHint && (
            <p className="text-amber-900 leading-snug">{summary.ownerSetupHint}</p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm w-full sm:w-auto font-semibold shadow-sm"
            onClick={handleRegisterWebhook}
            disabled={webhookPending}
          >
            {webhookPending ? "Підключення..." : "Підключити бот звітів (ZVIT_HoB_)"}
          </button>
          {webhookMessage && (
            <p className="rounded bg-green-100 p-1.5 text-green-800 font-medium">{webhookMessage}</p>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          {summary.payments.length === 0 ? (
            <p className="text-gray-400">Немає платежів інкасації за цей період.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded border border-blue-100">
              <table className="table table-xs w-full">
                <thead>
                  <tr className="bg-blue-50">
                    <th className="w-8" />
                    <th>Дата</th>
                    <th>Рахунок</th>
                    <th>Сума</th>
                    <th>Коментар</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.payments.map((payment) => {
                    const selectable = payment.status === "not_sent";
                    return (
                      <tr key={payment.altegioId} className="hover:bg-blue-50/50">
                        <td>
                          {selectable ? (
                            <input
                              type="checkbox"
                              className="checkbox checkbox-xs"
                              checked={selectedIds.has(payment.altegioId)}
                              onChange={() => toggleSelect(payment.altegioId)}
                            />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td>{formatDate(payment.operationDate)}</td>
                        <td>{payment.accountTitle}</td>
                        <td>{payment.displayAmount}</td>
                        <td className="max-w-[10rem] truncate" title={payment.comment || undefined}>
                          {payment.comment || "—"}
                        </td>
                        <td className={payment.status === "owner_confirmed" ? "text-green-700 font-medium" : ""}>
                          {statusLabel(payment.status)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!summary.ownerChatIdsConfigured && (
              <button
                type="button"
                className="btn btn-outline btn-primary btn-xs font-semibold"
                onClick={handleRegisterWebhook}
                disabled={webhookPending}
              >
                {webhookPending ? "..." : "Підключити бот"}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={handleSend}
              disabled={isPending || selectedIds.size === 0}
            >
              {isPending ? "Відправка..." : "Відправити на підтвердження власниці"}
            </button>
            {selectablePayments.length > 0 && (
              <span className="text-gray-500">Обрано: {selectedIds.size}</span>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-1 rounded bg-red-50 p-1 text-red-700">{error}</p>}
      {success && <p className="mt-1 rounded bg-green-50 p-1 text-green-700">{success}</p>}
    </div>
  );
}
