"use client";

// web/app/admin/finance-report/_components/EditNumberField.tsx
// Компонент для редагування числових полів (захищений CRON_SECRET)

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EditNumberFieldProps {
  year: number;
  month: number;
  fieldKey: string; // Унікальний ключ поля (наприклад, "consultations_count", "new_paid_clients")
  label: string; // Назва поля для відображення
  currentValue: number;
  unit?: string; // Одиниця виміру (наприклад, "шт.", за замовчуванням немає)
}

export function EditNumberField({
  year,
  month,
  fieldKey,
  label,
  currentValue,
  unit = "",
}: EditNumberFieldProps) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [secret, setSecret] = useState("");
  const [value, setValue] = useState(String(currentValue));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Оновлюємо значення, коли currentValue змінюється
  useEffect(() => {
    setValue(String(currentValue));
  }, [currentValue]);

  const handleUnlock = () => {
    const enteredSecret = prompt(
      `Введіть CRON_SECRET для редагування "${label}":`,
    );
    if (!enteredSecret) {
      return;
    }

    // Перевіряємо секрет через API
    fetch(
      `/api/admin/finance-report/expense-field?secret=${encodeURIComponent(enteredSecret)}&year=${year}&month=${month}&field=${fieldKey}`,
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
    const valueNum = parseFloat(value);
    if (isNaN(valueNum) || valueNum < 0) {
      setError("Значення має бути невід'ємним числом");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/expense-field?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, month, fieldKey, value: valueNum }),
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Помилка збереження");
        }

        const data = await res.json();
        console.log(`[EditNumberField] Saved ${fieldKey}:`, data);

        setSuccessMessage(`Збережено: ${valueNum.toLocaleString("uk-UA")}${unit ? ` ${unit}` : ""}`);
        setError(null);
        setValue(String(valueNum));
        
        // Блокуємо поле після збереження
        setIsAuthorized(false);
        setSecret("");

        router.refresh();

        setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      } catch (err: any) {
        console.error(`[EditNumberField] Save error:`, err);
        setError(err.message || "Помилка збереження");
      }
    });
  };

  const handleCancel = () => {
    setValue(String(currentValue));
    setIsAuthorized(false);
    setSecret("");
    setError(null);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={label}
          className="input input-bordered input-sm w-32"
          min="0"
          step="1"
          disabled={!isAuthorized || isPending}
          readOnly={!isAuthorized}
        />
        {unit && <span className="text-sm text-gray-600">{unit}</span>}
        {!isAuthorized ? (
          <button
            onClick={handleUnlock}
            className="btn btn-sm btn-ghost text-xs"
            title={`Розблокувати для редагування (потрібен CRON_SECRET)`}
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
