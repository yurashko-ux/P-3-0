"use client";

// Редагування підписаної місяцевої зміни складу (rollforward від ручного якоря попереднього місяця).

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EditWarehouseMonthNetFieldProps {
  year: number;
  month: number;
  /** null — у KV немає ключа */
  currentValue: number | null;
}

export function EditWarehouseMonthNetField({
  year,
  month,
  currentValue,
}: EditWarehouseMonthNetFieldProps) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [secret, setSecret] = useState("");
  const [value, setValue] = useState(currentValue === null ? "" : String(currentValue));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setValue(currentValue === null ? "" : String(currentValue));
  }, [currentValue]);

  const handleUnlock = () => {
    const enteredSecret = prompt(
      "Введіть CRON_SECRET для редагування «зміни складу за місяць»:",
    );
    if (!enteredSecret) {
      return;
    }

    fetch(
      `/api/admin/finance-report/warehouse-month-net?secret=${encodeURIComponent(enteredSecret)}&year=${year}&month=${month}`,
    )
      .then((res) => {
        if (res.ok) {
          setIsAuthorized(true);
          setSecret(enteredSecret);
          return res.json();
        }
        alert("Невірний CRON_SECRET");
        return null;
      })
      .then((data) => {
        if (data && typeof data.value === "number") {
          setValue(String(data.value));
        } else if (data && data.value === null) {
          setValue("");
        }
      })
      .catch((err) => {
        console.error("[EditWarehouseMonthNetField] verify:", err);
        alert("Помилка перевірки секрету");
      });
  };

  const handleSave = () => {
    const trimmed = value.trim();
    if (trimmed === "") {
      setError("Введіть число (можна від’ємне)");
      return;
    }
    const valueNum = parseFloat(trimmed.replace(",", "."));
    if (!Number.isFinite(valueNum)) {
      setError("Некоректне число");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/finance-report/warehouse-month-net?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year, month, value: valueNum }),
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Помилка збереження");
        }

        const data = await res.json();
        console.log("[EditWarehouseMonthNetField] Saved:", data);

        setSuccessMessage(`Збережено: ${valueNum.toLocaleString("uk-UA")} грн`);
        setValue(String(valueNum));
        setIsAuthorized(false);
        setSecret("");
        router.refresh();
        setTimeout(() => setSuccessMessage(null), 3000);
      } catch (err: unknown) {
        console.error("[EditWarehouseMonthNetField] Save error:", err);
        setError(err instanceof Error ? err.message : "Помилка збереження");
      }
    });
  };

  const handleCancel = () => {
    setValue(currentValue === null ? "" : String(currentValue));
    setIsAuthorized(false);
    setSecret("");
    setError(null);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {isAuthorized ? (
          <>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="грн"
              className="input input-bordered input-sm w-36"
              step="any"
              disabled={isPending}
            />
            <span className="text-sm text-gray-600">грн</span>
            <button
              type="button"
              onClick={handleSave}
              className="btn btn-sm btn-primary"
              disabled={isPending}
            >
              {isPending ? "..." : "💾"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="btn btn-sm btn-ghost"
              disabled={isPending}
            >
              ✕
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleUnlock}
            className="btn btn-sm btn-ghost text-xs p-1"
            title="Редагувати зміну складу за місяць (CRON_SECRET)"
          >
            ✏️
          </button>
        )}
      </div>
      {error && (
        <div className="text-xs text-error bg-error/10 p-1 rounded">{error}</div>
      )}
      {successMessage && (
        <div className="text-xs text-success bg-success/10 p-1 rounded">{successMessage}</div>
      )}
    </div>
  );
}
