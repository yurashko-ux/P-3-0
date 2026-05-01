"use client";

// web/app/admin/finance-report/_components/EditWarehouseBalanceButton.tsx
// Компонент для редагування балансу складу (захищений CRON_SECRET)

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EditWarehouseBalanceButtonProps {
  year: number;
  month: number;
  currentBalance: number;
}

export function EditWarehouseBalanceButton({
  year,
  month,
  currentBalance,
}: EditWarehouseBalanceButtonProps) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [secret, setSecret] = useState("");
  const [balance, setBalance] = useState(String(currentBalance));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Оновлюємо значення, коли currentBalance змінюється
  useEffect(() => {
    setBalance(String(currentBalance));
  }, [currentBalance]);

  const handleUnlock = () => {
    const enteredSecret = prompt(
      "Введіть CRON_SECRET для редагування балансу складу:",
    );
    if (!enteredSecret) {
      return;
    }

    // Перевіряємо секрет через API
    fetch(
      `/api/admin/finance-report/warehouse-balance?secret=${encodeURIComponent(enteredSecret)}&year=${year}&month=${month}`,
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
    const balanceValue = parseFloat(balance);
    if (isNaN(balanceValue) || balanceValue < 0) {
      setError("Баланс складу має бути невід'ємним числом");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/warehouse-balance?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, month, balance: balanceValue }),
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Помилка збереження");
        }

        const data = await res.json();
        console.log("[EditWarehouseBalanceButton] Saved balance:", data);

        // Показуємо повідомлення про успіх
        setSuccessMessage(`Збережено: ${balanceValue.toLocaleString("uk-UA")} грн.`);
        setError(null);

        // Оновлюємо локальний стан перед оновленням сторінки
        setBalance(String(balanceValue));
        
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
        console.error("[EditWarehouseBalanceButton] Save error:", err);
        setError(err.message || "Помилка збереження");
      }
    });
  };

  /** Підставити в KV суму з попереднього місяця (якір на кшталт 31.03 → старт для квітня). */
  const handleCopyFromPreviousMonth = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/warehouse-balance?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, month, copyFromPreviousMonth: true }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Помилка копіювання");
        }
        const copied = typeof data.balance === "number" ? data.balance : parseFloat(String(data.balance));
        setSuccessMessage(
          `Скопійовано з ${data.copiedFromMonth}.${data.copiedFromYear}: ${copied.toLocaleString("uk-UA")} грн. (KV). За потреби відкоригуйте й натисніть 💾.`,
        );
        setBalance(String(copied));
        setError(null);
        router.refresh();
        setTimeout(() => setSuccessMessage(null), 5000);
      } catch (err: unknown) {
        console.error("[EditWarehouseBalanceButton] Copy from previous error:", err);
        setError(err instanceof Error ? err.message : "Помилка копіювання");
      }
    });
  };

  const handleCancel = () => {
    setBalance(String(currentBalance));
    setIsAuthorized(false);
    setSecret("");
    setError(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {isAuthorized ? (
          <>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="Баланс складу"
              className="input input-bordered input-sm w-32"
              min="0"
              step="0.01"
              disabled={isPending}
            />
            <span className="text-sm text-gray-600">грн.</span>
            <button
              type="button"
              onClick={handleCopyFromPreviousMonth}
              className="btn btn-sm btn-outline"
              disabled={isPending}
              title="Скопіювати в цей місяць ручне значення з попереднього місяця (KV)"
            >
              ← місяць
            </button>
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
        ) : (
          <button
            onClick={handleUnlock}
            className="btn btn-sm btn-ghost text-xs p-1"
            title="Ручний баланс у KV має пріоритет над знімком Altegio та live API. Потрібен CRON_SECRET."
          >
            ✏️
          </button>
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
