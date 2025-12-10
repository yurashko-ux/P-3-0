"use client";

// Компонент для перемикання режиму редагування layout дашборду (захищений CRON_SECRET)

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EditLayoutButtonProps {
  storageKey: string;
  onEditModeChange: (enabled: boolean) => void;
  onSave?: (layout: any[]) => void;
}

export function EditLayoutButton({
  storageKey,
  onEditModeChange,
  onSave,
}: EditLayoutButtonProps) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [secret, setSecret] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleUnlock = () => {
    const enteredSecret = prompt(
      `Введіть CRON_SECRET для редагування layout дашборду:`,
    );
    if (!enteredSecret) {
      return;
    }

    // Перевіряємо секрет через API
    fetch(
      `/api/admin/dashboard-layout?secret=${encodeURIComponent(enteredSecret)}&storageKey=${encodeURIComponent(storageKey)}`,
    )
      .then((res) => {
        if (res.ok) {
          setIsAuthorized(true);
          setSecret(enteredSecret);
          onEditModeChange(true);
        } else {
          alert("Невірний CRON_SECRET");
        }
      })
      .catch((err) => {
        console.error("Failed to verify secret:", err);
        alert("Помилка перевірки секрету");
      });
  };

  const handleSaveLayout = useCallback((layout: any[]) => {
    if (!secret) return;

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/dashboard-layout?secret=${encodeURIComponent(secret)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storageKey, layout }),
          },
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Помилка збереження");
        }

        const data = await res.json();
        console.log(`[EditLayoutButton] Saved layout:`, data);

        setSuccessMessage(`✅ Layout збережено (${layout.length} блоків)`);
        setError(null);
        
        // Викликаємо callback для збереження
        if (onSave) {
          onSave(layout);
        }

        router.refresh();

        setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      } catch (err: any) {
        console.error(`[EditLayoutButton] Save error:`, err);
        setError(err.message || "Помилка збереження");
      }
    });
  }, [secret, storageKey, onSave, router]);

  const handleLock = () => {
    setIsAuthorized(false);
    setSecret("");
    onEditModeChange(false);
    setError(null);
    setSuccessMessage(null);
  };

  return (
    <div className="space-y-2">
      {!isAuthorized ? (
        <button
          onClick={handleUnlock}
          className="btn btn-sm btn-outline text-xs font-semibold"
          title={`Розблокувати для редагування layout (потрібен CRON_SECRET)`}
        >
          🔓 Редагувати layout
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleLock}
              className="btn btn-sm btn-ghost text-xs"
              disabled={isPending}
            >
              🔒 Заблокувати
            </button>
            <span className="text-xs text-green-600 font-semibold">✓ Режим редагування активний</span>
          </div>
          <button
            onClick={() => {
              // Отримуємо layout з localStorage
              const savedLayout = localStorage.getItem(storageKey);
              if (savedLayout) {
                try {
                  const layout = JSON.parse(savedLayout);
                  handleSaveLayout(layout);
                } catch (e) {
                  setError("Помилка читання layout з localStorage");
                }
              } else {
                setError("Layout не знайдено в localStorage");
              }
            }}
            className="btn btn-sm btn-primary text-xs font-semibold"
            disabled={isPending}
          >
            {isPending ? "Збереження..." : "💾 Зберегти layout"}
          </button>
        </div>
      )}
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
      {isAuthorized && (
        <div className="text-xs text-gray-500 mt-1">
          💡 Перемістіть та змініть розмір блоків, потім натисніть "Зберегти layout"
        </div>
      )}
    </div>
  );
}

// Експортуємо функцію для збереження layout
export function saveLayoutToServer(
  storageKey: string,
  layout: any[],
  secret: string,
): Promise<void> {
  return fetch(`/api/admin/dashboard-layout?secret=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storageKey, layout }),
  }).then((res) => {
    if (!res.ok) {
      return res.json().then((data) => {
        throw new Error(data.error || "Помилка збереження");
      });
    }
  });
}

