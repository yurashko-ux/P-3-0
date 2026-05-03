"use client";

// Запис у KV оціночної чистої зміни складу з розрахунку fetchGoodsSalesSummary

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function ApplyWarehouseNetSuggestionButton({
  year,
  month,
  suggestedValue,
  buttonLabel = "Записати цю оцінку в KV",
}: {
  year: number;
  month: number;
  suggestedValue: number;
  /** Підпис кнопки (наприклад, окремо для Δ за методом карток товарів) */
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const secret = prompt(
      "Введіть CRON_SECRET, щоб записати оціночну зміну складу в KV (finance:warehouse:month_net_change):",
    );
    if (!secret) return;

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/warehouse-month-net?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, month, value: suggestedValue }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Помилка збереження");
        }
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <button
      type="button"
      className="btn btn-xs btn-outline mt-1"
      disabled={isPending || !Number.isFinite(suggestedValue)}
      onClick={handleClick}
    >
      {isPending ? "…" : buttonLabel}
    </button>
  );
}
