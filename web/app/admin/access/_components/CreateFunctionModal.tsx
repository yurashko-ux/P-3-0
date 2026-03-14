"use client";

import { useState } from "react";
import { PERMISSION_CATEGORIES, DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import type { PermissionKey } from "@/lib/auth-rbac";

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function CreateFunctionModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<Record<string, string>>(
    Object.fromEntries(
      PERMISSION_CATEGORIES.map((c) => [c.key, DEFAULT_PERMISSIONS[c.key] ?? "edit"])
    )
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (key: PermissionKey, value: "edit" | "view" | "none") => {
    setPermissions((p) => ({ ...p, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/access/functions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), permissions }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Помилка створення");
        return;
      }
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-4">Створити функцію (посаду)</h3>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Назва посади</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input input-bordered w-full"
              placeholder="Наприклад: Адміністратор, Дірект-менеджер"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">
              Доступи (за замовчуванням — все відмічено)
            </label>
            <div className="space-y-2 border border-gray-200 rounded p-3 bg-gray-50">
              {PERMISSION_CATEGORIES.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <span className="text-sm">{label}</span>
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name={key}
                        checked={permissions[key] === "edit"}
                        onChange={() => handleToggle(key as PermissionKey, "edit")}
                      />
                      змінювати
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name={key}
                        checked={permissions[key] === "view"}
                        onChange={() => handleToggle(key as PermissionKey, "view")}
                      />
                      бачити
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name={key}
                        checked={permissions[key] === "none"}
                        onChange={() => handleToggle(key as PermissionKey, "none")}
                      />
                      ні
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Створення…" : "Створити функцію"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
