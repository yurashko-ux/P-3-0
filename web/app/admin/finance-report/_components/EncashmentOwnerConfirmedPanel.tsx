"use client";

// Підтверджені власницею платежі інкасації (перегляд + скасування для розробника).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EncashmentPaymentRow } from "@/lib/finance/encashment-confirmation";
import { formatEncashmentAmount } from "@/lib/finance/encashment-account-bucket";
import {
  buildEncashmentReceiptDisplay,
  computeEncashmentOwnerReceiptTotals,
  formatEncashmentReceiptDisplayPending,
  formatEncashmentReceiptDisplayReceived,
} from "@/lib/finance/encashment-receipt-totals";

interface EncashmentOwnerConfirmedPanelProps {
  year: number;
  month: number;
  payments: EncashmentPaymentRow[];
  allPayments: EncashmentPaymentRow[];
  totalEncashmentUah: number;
  canRevoke: boolean;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" });
}

function formatConfirmedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" });
}

export function EncashmentOwnerConfirmedPanel({
  year,
  month,
  payments,
  allPayments,
  totalEncashmentUah,
  canRevoke,
}: EncashmentOwnerConfirmedPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRevoke = (altegioId: number) => {
    if (!canRevoke) return;

    setError(null);
    setRevokingId(altegioId);

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/finance-report/encashment-confirmation", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            year,
            month,
            altegioIds: [altegioId],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Не вдалося скасувати");
        }
        if (data.revoked === 0 && Array.isArray(data.errors) && data.errors.length > 0) {
          throw new Error(data.errors.join("; "));
        }
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Помилка скасування");
      } finally {
        setRevokingId(null);
      }
    });
  };

  const receiptDisplay = buildEncashmentReceiptDisplay(totalEncashmentUah, allPayments);
  const sentTotals = computeEncashmentOwnerReceiptTotals(allPayments).sent;

  if (sentTotals.uah === 0 && sentTotals.usd === 0 && sentTotals.eur === 0) {
    return <p className="text-xs text-gray-400 mt-1">Немає відправлених платежів на підтвердження.</p>;
  }

  return (
    <div className="mt-1 space-y-1">
      <div className="rounded-md border border-green-200 bg-green-50/80 p-2 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-gray-600">Сума інкасації:</span>
          <span className="font-semibold text-right">
            {formatEncashmentAmount(receiptDisplay.totalUah)} грн.
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-600">Отримано:</span>
          <span className="font-semibold text-green-700 text-right">
            {formatEncashmentReceiptDisplayReceived(receiptDisplay)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-600">Ще буде отримано:</span>
          <span className="font-semibold text-amber-700 text-right">
            {formatEncashmentReceiptDisplayPending(receiptDisplay)}
          </span>
        </div>
      </div>
      {canRevoke && payments.length > 0 && (
        <p className="text-[10px] text-gray-500">
          Тест: «Скасувати» повертає платіж у «Інкасація факт» зі статусом «Не відпр.»
        </p>
      )}
      {payments.length === 0 ? (
        <p className="text-xs text-gray-400">Поки немає підтверджених платежів.</p>
      ) : (
      <div className="max-h-96 overflow-y-auto rounded border border-green-200">
        <table className="table table-xs w-full">
          <thead>
            <tr className="bg-green-100">
              <th>Рахунок</th>
              <th>Сума</th>
              <th>Коментар</th>
              <th>Дата підтвердження</th>
              {canRevoke && <th className="w-20" />}
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.altegioId} className="bg-green-50 hover:bg-green-100">
                <td>
                  <p className="font-medium leading-tight">{payment.accountTitle}</p>
                  <p className="mt-0.5 text-[10px] text-gray-500 leading-tight">
                    {formatDate(payment.operationDate)}
                  </p>
                </td>
                <td className="whitespace-nowrap font-semibold text-green-800">
                  {payment.displayAmount}
                </td>
                <td className="max-w-[10rem] truncate" title={payment.comment || undefined}>
                  {payment.comment || "—"}
                </td>
                <td className="whitespace-nowrap text-[10px] text-green-800">
                  {formatConfirmedAt(payment.ownerConfirmedAt)}
                </td>
                {canRevoke && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-red-700 hover:bg-red-50 px-1"
                      onClick={() => handleRevoke(payment.altegioId)}
                      disabled={isPending && revokingId === payment.altegioId}
                      title="Повернути в Інкасація факт"
                    >
                      {isPending && revokingId === payment.altegioId ? "..." : "Скасувати"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {error && <p className="rounded bg-red-50 p-1 text-red-700">{error}</p>}
    </div>
  );
}
