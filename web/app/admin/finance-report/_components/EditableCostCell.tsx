"use client";

// web/app/admin/finance-report/_components/EditableCostCell.tsx
// Компонент для редагування собівартості в таблиці (захищений CRON_SECRET)
// Показує значення + олівець, при натисканні з'являється поле для редагування

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EditableCostCellProps {
  year: number;
  month: number;
  currentCost: number;
}

export function EditableCostCell({
  year,
  month,
  currentCost,
}: EditableCostCellProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [secret, setSecret] = useState("");
  const [cost, setCost] = useState(String(currentCost));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Оновлюємо значення, коли currentCost змінюється
  useEffect(() => {
    setCost(String(currentCost));
  }, [currentCost]);

  const handleEditClick = () => {
    if (isEditing) {
      // Якщо вже редагуємо, закриваємо
      setIsEditing(false);
      setCost(String(currentCost));
      setIsAuthorized(false);
      setSecret("");
      setError(null);
      return;
    }

    // Запитуємо секрет
    const enteredSecret = prompt(
      "Введіть CRON_SECRET для редагування собівартості:",
    );
    if (!enteredSecret) {
      return;
    }

    // Перевіряємо секрет через API
    fetch(
      `/api/admin/finance-report/cost?secret=${encodeURIComponent(enteredSecret)}&year=${year}&month=${month}`,
    )
      .then((res) => {
        if (res.ok) {
          setIsAuthorized(true);
          setSecret(enteredSecret);
          setIsEditing(true);
        } else {
          alert("Невірний CRON_SECRET");
        }
      })
      .catch((err) => {
        console.error("Failed to verify secret:", err);
        alert("Помилка перевірки секрету");
      });
  };

  const handleSave = () => {
    const costValue = parseFloat(cost);
    if (isNaN(costValue) || costValue < 0) {
      setError("Собівартість має бути невід'ємним числом");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/cost?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, month, cost: costValue }),
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Помилка збереження");
        }

        const data = await res.json();
        console.log("[EditableCostCell] Saved cost:", data);

        setSuccessMessage(`Збережено`);
        setError(null);
        setCost(String(costValue));
        
        // Закриваємо поле редагування
        setIsEditing(false);
        setIsAuthorized(false);
        setSecret("");

        router.refresh();

        setTimeout(() => {
          setSuccessMessage(null);
        }, 2000);
      } catch (err: any) {
        console.error("[EditableCostCell] Save error:", err);
        setError(err.message || "Помилка збереження");
      }
    });
  };

  const handleCancel = () => {
    setCost(String(currentCost));
    setIsEditing(false);
    setIsAuthorized(false);
    setSecret("");
    setError(null);
  };

  // Форматування числа з роздільниками тисяч
  const formatMoney = (value: number) => {
    return Math.round(value).toLocaleString("uk-UA", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  // Якщо редагуємо, показуємо поле вводу
  if (isEditing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center justify-end gap-1">
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Собівартість"
            className="input input-bordered input-xs w-24 text-right"
            min="0"
            step="0.01"
            disabled={isPending}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSave();
              } else if (e.key === "Escape") {
                handleCancel();
              }
            }}
          />
          <span className="text-xs text-gray-600">грн.</span>
          <button
            onClick={handleSave}
            className="btn btn-xs btn-primary"
            disabled={isPending}
            title="Зберегти"
          >
            {isPending ? "..." : "💾"}
          </button>
          <button
            onClick={handleCancel}
            className="btn btn-xs btn-ghost"
            disabled={isPending}
            title="Скасувати"
          >
            ✕
          </button>
        </div>
        {error && (
          <div className="text-xs text-error">{error}</div>
        )}
        {successMessage && (
          <div className="text-xs text-success">{successMessage}</div>
        )}
      </div>
    );
  }

  // За замовчуванням показуємо значення + олівець
  return (
    <div className="flex items-center justify-end gap-1 w-full">
      <span className="text-xs font-bold whitespace-nowrap">
        {formatMoney(currentCost)} грн.
      </span>
      <button
        onClick={handleEditClick}
        className="btn btn-xs btn-ghost p-0.5 opacity-60 hover:opacity-100 inline-flex items-center shrink-0"
        title="Редагувати собівартість (потрібен CRON_SECRET)"
      >
        ✏️
      </button>
    </div>
  );
}
