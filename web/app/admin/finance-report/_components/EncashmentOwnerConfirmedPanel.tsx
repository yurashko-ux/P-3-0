"use client";

// Підтверджені власницею платежі інкасації (перегляд + скасування для розробника).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EncashmentPaymentRow } from "@/lib/finance/encashment-confirmation";

interface EncashmentOwnerConfirmedPanelProps {
  year: number;
  month: number;
  payments: EncashmentPaymentRow[];
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

  if (payments.length === 0) {
    return <p className="text-xs text-gray-400 mt-1">Немає підтверджених платежів за цей період.</p>;
  }

  return (
    <div className="mt-1 space-y-1">
      {canRevoke && (
        <p className="text-[10px] text-gray-500">
          Тест: «Скасувати» повертає платіж у «Інкасація факт» зі статусом «Не відпр.»
        </p>
      )}
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
      {error && <p className="rounded bg-red-50 p-1 text-red-700">{error}</p>}
    </div>
  );
}
