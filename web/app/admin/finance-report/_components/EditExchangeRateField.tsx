"use client";

// web/app/admin/finance-report/_components/EditExchangeRateField.tsx
// Компонент для редагування курсу долара (захищений CRON_SECRET)

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EditExchangeRateFieldProps {
  year: number;
  month: number;
  currentRate: number;
}

export function EditExchangeRateField({
  year,
  month,
  currentRate,
}: EditExchangeRateFieldProps) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [secret, setSecret] = useState("");
  const [rate, setRate] = useState(String(currentRate));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Оновлюємо значення, коли currentRate змінюється
  useEffect(() => {
    setRate(String(currentRate));
  }, [currentRate]);

  const handleUnlock = () => {
    const enteredSecret = prompt(
      "Введіть CRON_SECRET для редагування курсу долара:",
    );
    if (!enteredSecret) {
      return;
    }

    // Перевіряємо секрет через API
    fetch(
      `/api/admin/finance-report/exchange-rate?secret=${encodeURIComponent(enteredSecret)}&year=${year}&month=${month}`,
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
    const rateValue = parseFloat(rate);
    if (isNaN(rateValue) || rateValue <= 0) {
      setError("Курс має бути додатним числом");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/exchange-rate?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, month, rate: rateValue }),
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Помилка збереження");
        }

        const data = await res.json();
        console.log("[EditExchangeRateField] Saved rate:", data);

        setSuccessMessage(`Збережено: ${rateValue.toFixed(2)} грн./USD`);
        setError(null);
        setRate(String(rateValue));
        
        // Блокуємо поле після збереження
        setIsAuthorized(false);
        setSecret("");

        router.refresh();

        setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      } catch (err: any) {
        console.error("[EditExchangeRateField] Save error:", err);
        setError(err.message || "Помилка збереження");
      }
    });
  };

  const handleCancel = () => {
    setRate(String(currentRate));
    setIsAuthorized(false);
    setSecret("");
    setError(null);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {isAuthorized ? (
          <>
            <input
              type="number"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="Курс долара"
              className="input input-bordered input-sm w-32"
              min="0.01"
              step="0.01"
              disabled={isPending}
            />
            <span className="text-sm text-gray-600">грн./USD</span>
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
            title="Розблокувати для редагування (потрібен CRON_SECRET)"
          >
            ✏️
          </button>
        )}
      </div>
      {error && (
        <div className="text-xs text-error bg-error/10 p-1 rounded">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="text-xs text-success bg-success/10 p-1 rounded">
          {successMessage}
        </div>
      )}
    </div>
  );
}
