"use client";

// Підтверджені власницею платежі інкасації (лише перегляд).

import type { EncashmentPaymentRow } from "@/lib/finance/encashment-confirmation";

interface EncashmentOwnerConfirmedPanelProps {
  payments: EncashmentPaymentRow[];
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

export function EncashmentOwnerConfirmedPanel({ payments }: EncashmentOwnerConfirmedPanelProps) {
  if (payments.length === 0) {
    return <p className="text-xs text-gray-400 mt-1">Немає підтверджених платежів за цей період.</p>;
  }

  return (
    <div className="mt-1 max-h-96 overflow-y-auto rounded border border-green-200">
      <table className="table table-xs w-full">
        <thead>
          <tr className="bg-green-100">
            <th>Рахунок</th>
            <th>Сума</th>
            <th>Коментар</th>
            <th>Дата підтвердження</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
