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
        await onStatusCreated();
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
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Статуси</h2>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setIsCreating(!isCreating)}
          >
            {isCreating ? "Скасувати" : "+ Створити статус"}
          </button>
        </div>

        {isCreating && (
          <div className="border rounded-lg p-4 mb-4 bg-base-200">
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

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {statuses.map((status) => (
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
          ))}
        </div>
      </div>
    </div>
  );
}
