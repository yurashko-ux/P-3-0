"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EditCostIconButtonProps {
  year: number;
  month: number;
}

export function EditCostIconButton({ year, month }: EditCostIconButtonProps) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleEditClick = () => {
    if (isProcessing) return;

    const enteredSecret = prompt(
      "Введіть CRON_SECRET для редагування собівартості:",
    );
    if (!enteredSecret) {
      return;
    }

    setIsProcessing(true);

    // Перевіряємо секрет через API
    fetch(
      `/api/admin/finance-report/cost?secret=${encodeURIComponent(enteredSecret)}&year=${year}&month=${month}`,
    )
      .then((res) => {
        if (res.ok) {
          const costValue = prompt("Введіть нову собівартість:");
          if (costValue !== null) {
            const cost = parseFloat(costValue);
            if (!isNaN(cost) && cost >= 0) {
              return fetch(
                `/api/admin/finance-report/cost?secret=${encodeURIComponent(enteredSecret)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ year, month, cost }),
                },
              ).then((res) => {
                if (res.ok) {
                  router.refresh();
                } else {
                  alert("Помилка збереження");
                }
              });
            } else {
              alert("Невірне значення собівартості");
            }
          }
        } else {
          alert("Невірний CRON_SECRET");
        }
      })
      .catch((err) => {
        console.error("Failed to verify secret:", err);
        alert("Помилка перевірки секрету");
      })
      .finally(() => {
        setIsProcessing(false);
      });
  };

  return (
    <button
      onClick={handleEditClick}
      disabled={isProcessing}
      className="btn btn-xs btn-ghost p-0 opacity-60 hover:opacity-100 inline-flex items-center shrink-0 h-auto min-h-0 -mr-0.5"
      title="Редагувати собівартість (потрібен CRON_SECRET)"
    >
      <span className="text-xs leading-none">✏️</span>
    </button>
  );
}
