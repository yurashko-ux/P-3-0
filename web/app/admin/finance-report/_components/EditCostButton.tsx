"use client";

// web/app/admin/finance-report/_components/EditCostButton.tsx
// Компонент для редагування собівартості товарів (захищений CRON_SECRET)

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EditCostButtonProps {
  year: number;
  month: number;
  currentCost: number;
}

export function EditCostButton({
  year,
  month,
  currentCost,
}: EditCostButtonProps) {
  const router = useRouter();
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

  const handleUnlock = () => {
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
        console.log("[EditCostButton] Saved cost:", data);

        // Показуємо повідомлення про успіх
        setSuccessMessage(`Збережено: ${costValue.toLocaleString("uk-UA")} грн.`);
        setError(null);

        // Оновлюємо локальний стан перед оновленням сторінки
        setCost(String(costValue));
        
        // Блокуємо поле після збереження
        setIsAuthorized(false);
        setSecret("");

        // Оновлюємо сторінку для відображення нових даних
        router.refresh();

        // Прибираємо повідомлення через 3 секунди
        setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      } catch (err: any) {
        console.error("[EditCostButton] Save error:", err);
        setError(err.message || "Помилка збереження");
      }
    });
  };

  const handleCancel = () => {
    setCost(String(currentCost));
    setIsAuthorized(false);
    setSecret("");
    setError(null);
  };

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
          disabled={!isAuthorized || isPending}
          readOnly={!isAuthorized}
        />
        <span className="text-sm text-gray-600">грн.</span>
        {!isAuthorized ? (
          <button
            onClick={handleUnlock}
            className="btn btn-sm btn-ghost text-xs"
            title="Розблокувати для редагування (потрібен CRON_SECRET)"
          >
            ✏️
          </button>
        ) : (
          <>
            <button
              onClick={handleSave}
              className="btn btn-sm btn-primary"
              disabled={isPending}
            >
              {isPending ? "..." : "💾"}
            </button>
            <button
              onClick={handleCancel}
              className="btn btn-sm btn-ghost"
              disabled={isPending}
            >
              ✕
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="text-xs text-error bg-error/10 p-2 rounded">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="text-xs text-success bg-success/10 p-2 rounded">
          {successMessage}
        </div>
      )}
    </div>
  );
}

