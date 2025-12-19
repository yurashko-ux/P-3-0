// web/app/admin/direct/_components/StatusManager.tsx
// Управління статусами (конструктор статусів)

"use client";

import { useState } from "react";
import type { DirectStatus } from "@/lib/direct-types";

type StatusManagerProps = {
  statuses: DirectStatus[];
  onStatusCreated: () => Promise<void>;
};

export function StatusManager({ statuses, onStatusCreated }: StatusManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
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
      {/* Кнопка для відкриття модального вікна */}
      <div className="flex justify-end">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => setIsModalOpen(true)}
        >
          + Створити статус
        </button>
      </div>

      {/* Модальне вікно */}
      {isModalOpen && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-4xl">
            <h3 className="font-bold text-lg mb-4">Управління статусами</h3>
            
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

            {/* Список існуючих статусів */}
            <div>
              <h4 className="text-md font-semibold mb-4">Існуючі статуси ({statuses.length})</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-96 overflow-y-auto">
                {statuses.length === 0 ? (
                  <div className="col-span-full text-center text-gray-500 py-8">
                    Немає статусів. Створіть перший статус.
                  </div>
                ) : (
                  statuses.map((status) => (
                    <div
                      key={status.id}
                      className="border rounded-lg p-2 flex items-center justify-between"
                      style={{ borderLeft: `4px solid ${status.color}` }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{status.name}</div>
                        {status.isDefault && (
                          <div className="text-xs text-gray-500">(за замовчуванням)</div>
                        )}
                      </div>
                      <button
                        className="btn btn-xs btn-ghost text-error"
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

            {/* Кнопки закриття */}
            <div className="modal-action">
              <button
                className="btn"
                onClick={() => {
                  setIsModalOpen(false);
                  setIsCreating(false);
                }}
              >
                Закрити
              </button>
            </div>
          </div>
          {/* Backdrop для закриття по кліку */}
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => {
              setIsModalOpen(false);
              setIsCreating(false);
            }}>close</button>
          </form>
        </dialog>
      )}
    </>
  );
}
