// web/app/admin/direct/_components/StatusManager.tsx
// Управління статусами (конструктор статусів)

"use client";

import { useState, useEffect } from "react";
import type { DirectStatus } from "@/lib/direct-types";

// Розміри прямокутника-бейджа (однакові для всіх статусів)
const BADGE_HEIGHT = 28;
const BADGE_MIN_WIDTH = 120;

/** Контрастний колір тексту для фону: білий або темний */
function getContrastFg(hexBg: string): string {
  const hex = hexBg.replace(/^#/, '');
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.5 ? '#111827' : '#ffffff';
}

function StatusBadge({
  name,
  color,
  className = '',
}: {
  name: string;
  color: string;
  className?: string;
}) {
  const fg = getContrastFg(color || '#6b7280');
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg text-[11px] font-normal px-3 ${className}`}
      style={{
        backgroundColor: color || '#6b7280',
        color: fg,
        minWidth: BADGE_MIN_WIDTH,
        height: BADGE_HEIGHT,
      }}
    >
      {name || '—'}
    </span>
  );
}

type StatusManagerProps = {
  statuses: DirectStatus[];
  onStatusCreated: () => Promise<void>;
  shouldOpenCreate?: boolean;
  onOpenCreateChange?: (open: boolean) => void;
};

export function StatusManager({ statuses, onStatusCreated, shouldOpenCreate, onOpenCreateChange }: StatusManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  // Відкриваємо модальне вікно, якщо shouldOpenCreate змінився на true
  useEffect(() => {
    if (shouldOpenCreate) {
      setIsModalOpen(true);
      setIsCreating(true);
      onOpenCreateChange?.(false);
    }
  }, [shouldOpenCreate, onOpenCreateChange]);
  const [newStatus, setNewStatus] = useState({
    name: "",
    color: "#6b7280",
    order: statuses.length + 1,
    isDefault: false,
  });

  const handleCreate = async () => {
    if (!newStatus.name.trim()) {
      alert("Введіть назву статусу");
      return;
    }

    try {
      const res = await fetch(`/api/admin/direct/statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStatus),
      });
      const data = await res.json();
      if (data.ok) {
        setNewStatus({ name: "", color: "#6b7280", order: statuses.length + 2, isDefault: false });
        setIsCreating(false);
        
        // Затримка перед оновленням для eventual consistency KV
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Оновлюємо кілька разів з затримками для надійності
        for (let attempt = 1; attempt <= 3; attempt++) {
          await onStatusCreated();
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Перевіряємо, чи статус з'явився
          const checkRes = await fetch('/api/admin/direct/statuses');
          const checkData = await checkRes.json();
          if (checkData.ok && checkData.statuses) {
            const found = checkData.statuses.find((s: any) => s.id === data.status?.id);
            if (found) {
              console.log(`[StatusManager] Status ${data.status.id} found after ${attempt} attempt(s)`);
              break;
            }
          }
        }
      } else {
        alert(data.error || "Failed to create status");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (statusId: string) => {
    if (!confirm("Видалити статус? Це не можна скасувати.")) return;

    try {
      const res = await fetch(`/api/admin/direct/statuses/${statusId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        await onStatusCreated();
      } else {
        alert(data.error || "Failed to delete status");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      {/* Модальне вікно */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={() => {
            setIsModalOpen(false);
            setIsCreating(false);
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">Управління статусами</h3>
                <button
                  className="btn btn-sm btn-circle btn-ghost"
                  onClick={() => {
                    setIsModalOpen(false);
                    setIsCreating(false);
                  }}
                >
                  ✕
                </button>
              </div>
              
              {/* Форма створення статусу */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-md font-semibold">Створити новий статус</h4>
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={() => setIsCreating(!isCreating)}
                  >
                    {isCreating ? "Сховати форму" : "Показати форму"}
                  </button>
                </div>

                {isCreating && (
                  <div className="border rounded-lg p-4 bg-base-200">
                    {/* Превʼю прямокутника (завжди однаковий за розмірами) */}
                    <div className="mb-4">
                      <label className="label label-text text-xs mb-1">Превʼю</label>
                      <StatusBadge
                        name={newStatus.name || 'Назва'}
                        color={newStatus.color}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="label label-text text-xs">Назва статусу</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full"
                          placeholder="Наприклад: Новий"
                          value={newStatus.name}
                          onChange={(e) => setNewStatus({ ...newStatus, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label label-text text-xs">Колір</label>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            className="input input-bordered input-sm w-20"
                            value={newStatus.color}
                            onChange={(e) => setNewStatus({ ...newStatus, color: e.target.value })}
                          />
                          <input
                            type="text"
                            className="input input-bordered input-sm flex-1"
                            value={newStatus.color}
                            onChange={(e) => setNewStatus({ ...newStatus, color: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="label label-text text-xs">Порядок</label>
                        <input
                          type="number"
                          className="input input-bordered input-sm w-full"
                          value={newStatus.order}
                          onChange={(e) => setNewStatus({ ...newStatus, order: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="flex items-end">
                        <label className="label cursor-pointer">
                          <span className="label-text text-xs mr-2">За замовчуванням</span>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={newStatus.isDefault}
                            onChange={(e) => setNewStatus({ ...newStatus, isDefault: e.target.checked })}
                          />
                        </label>
                      </div>
                    </div>
                    <div className="mt-4">
                      <button className="btn btn-sm btn-primary" onClick={handleCreate}>
                        Створити
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Список існуючих статусів (прямокутники з кольором) */}
              <div>
                <h4 className="text-md font-semibold mb-4">Існуючі статуси ({statuses.length})</h4>
                <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
                  {statuses.length === 0 ? (
                    <div className="w-full text-center text-gray-500 py-8">
                      Немає статусів. Створіть перший статус.
                    </div>
                  ) : (
                    statuses.map((status) => (
                      <div
                        key={status.id}
                        className="group flex items-center gap-1"
                      >
                        <span
                          title={status.isDefault ? `${status.name} (за замовчуванням)` : status.name}
                          className="inline-block"
                        >
                          <StatusBadge
                            name={status.name}
                            color={status.color}
                          />
                        </span>
                        <button
                          className="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleDelete(status.id)}
                          title="Видалити"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
