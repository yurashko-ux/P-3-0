"use client";

// web/app/admin/finance-report/_components/EditCostButton.tsx
// Компонент для редагування собівартості товарів (захищений CRON_SECRET)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface EditCostButtonProps {
  year: number;
  month: number;
  currentCost: number;
  onUpdate: (newCost: number) => void;
}

export function EditCostButton({
  year,
  month,
  currentCost,
  onUpdate,
}: EditCostButtonProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [secret, setSecret] = useState("");
  const [cost, setCost] = useState(String(currentCost));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const handleStartEdit = () => {
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
          setIsEditing(true);
          setSecret(enteredSecret);
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
        onUpdate(data.cost);
        setIsEditing(false);
        setSecret("");
        // Оновлюємо сторінку для відображення нових даних
        router.refresh();
      } catch (err: any) {
        setError(err.message || "Помилка збереження");
      }
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setSecret("");
    setCost(String(currentCost));
    setError(null);
    setIsAuthorized(false);
  };

  if (!isEditing) {
    return (
      <button
        onClick={handleStartEdit}
        className="btn btn-sm btn-ghost text-xs"
        title="Редагувати собівартість (потрібен CRON_SECRET)"
      >
        ✏️ Редагувати
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="Собівартість"
          className="input input-bordered input-sm w-32"
          min="0"
          step="0.01"
          disabled={isPending}
        />
        <span className="text-sm text-gray-600">грн.</span>
        <button
          onClick={handleSave}
          className="btn btn-sm btn-primary"
          disabled={isPending}
        >
          {isPending ? "Збереження..." : "💾 Зберегти"}
        </button>
        <button
          onClick={handleCancel}
          className="btn btn-sm btn-ghost"
          disabled={isPending}
        >
          Скасувати
        </button>
      </div>
      {error && (
        <div className="text-xs text-error bg-error/10 p-2 rounded">
          {error}
        </div>
      )}
    </div>
  );
}
