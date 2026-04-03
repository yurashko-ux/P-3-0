// web/app/admin/direct/_components/StatusManager.tsx
// Управління статусами (конструктор статусів)

"use client";

import { useState, useEffect, useRef } from "react";
import type { DirectStatus } from "@/lib/direct-types";

// Розміри прямокутника-бейджа (однакові для всіх статусів)
const BADGE_HEIGHT = 28;
const BADGE_MIN_WIDTH = 120;

// Палітра кольорів для вибору (включає сітло-сірий як у колонці Днів до 60)
const COLOR_PALETTE = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#e5e7eb", // сітло-сірий як bg-gray-200 (колонка Днів до 60 днів)
  "#ec4899",
  "#6b7280",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#fbbf24",
  "#84cc16",
  "#a855f7",
  "#22d3ee",
];

/** Контрастний колір тексту для фону: білий або темний */
function getContrastFg(hexBg: string): string {
  const hex = hexBg.replace(/^#/, "");
  if (hex.length !== 6) return "#ffffff";
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.5 ? "#111827" : "#ffffff";
}

async function fetchStatusApi(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 28_000);

    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } catch (err) {
      const isRetryableNetwork =
        err instanceof Error &&
        (err.name === "AbortError" || /Failed to fetch|NetworkError|Load failed/i.test(err.message));

      if (!isRetryableNetwork || attempt >= maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Не вдалося виконати запит до статусів");
}

function StatusBadge({
  name,
  color,
  compact = false,
  className = "",
}: {
  name: string;
  color: string;
  compact?: boolean;
  className?: string;
}) {
  const fg = getContrastFg(color || "#6b7280");
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg text-[11px] font-normal px-3 truncate max-w-full ${className}`}
      style={{
        backgroundColor: color || "#6b7280",
        color: fg,
        minWidth: compact ? 60 : BADGE_MIN_WIDTH,
        height: compact ? 24 : BADGE_HEIGHT,
      }}
    >
      {name || "—"}
    </span>
  );
}

type StatusManagerProps = {
  statuses: DirectStatus[];
  onStatusCreated: () => Promise<void>;
  /** Якщо передано — використовується замість onStatusCreated для мʼякого оновлення без перезавантаження сторінки */
  onStatusesRefresh?: () => Promise<void>;
  shouldOpenCreate?: boolean;
  onOpenCreateChange?: (open: boolean) => void;
};

export function StatusManager({
  statuses,
  onStatusCreated,
  onStatusesRefresh,
  shouldOpenCreate,
  onOpenCreateChange,
}: StatusManagerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refresh = onStatusesRefresh ?? onStatusCreated;

  useEffect(() => {
    if (shouldOpenCreate) {
      setIsModalOpen(true);
      setIsCreating(true);
      onOpenCreateChange?.(false);
    }
  }, [shouldOpenCreate, onOpenCreateChange]);

  const handleCreate = async (color: string) => {
    const name = newStatusName.trim();
    if (!name) {
      alert("Введіть назву статусу");
      return;
    }

    try {
      const res = await fetchStatusApi(`/api/admin/direct/statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          color,
          order: statuses.length + 1,
          isDefault: false,
        }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setNewStatusName("");
        setIsCreating(false);
        await refresh();
      } else {
        alert(data.error || "Помилка створення статусу");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUpdate = async (statusId: string, color: string) => {
    const name = editName.trim();
    if (!name) {
      alert("Введіть назву статусу");
      return;
    }

    try {
      const res = await fetchStatusApi(`/api/admin/direct/statuses/${statusId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setEditingId(null);
        setEditName("");
        await refresh();
      } else {
        alert(data.error || "Помилка збереження");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (statusId: string) => {
    if (!confirm("Видалити статус? Це не можна скасувати.")) return;

    try {
      const res = await fetchStatusApi(`/api/admin/direct/statuses/${statusId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        await refresh();
      } else {
        alert(data.error || "Помилка видалення");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  return (
    <>
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          onClick={() => {
            setIsModalOpen(false);
            setIsCreating(false);
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-[240px] w-full mx-4 max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Управління статусами</h3>
                <button
                  className="btn btn-xs btn-circle btn-ghost"
                  onClick={() => {
                    setIsModalOpen(false);
                    setIsCreating(false);
                    setEditingId(null);
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Блок створення нового статусу */}
              {!isCreating ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline w-full justify-center mb-3"
                  onClick={() => setIsCreating(true)}
                >
                  + Додати статус
                </button>
              ) : (
                <div className="border rounded-lg p-2 bg-base-200 mb-3">
                  <input
                    type="text"
                    className="input input-bordered input-sm w-full mb-2"
                    placeholder="Назва статусу"
                    value={newStatusName}
                    onChange={(e) => setNewStatusName(e.target.value)}
                    autoFocus
                  />
                  <div className="flex flex-wrap gap-1">
                    {COLOR_PALETTE.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="w-6 h-6 rounded border-2 border-gray-300 hover:border-primary hover:scale-110 transition-all"
                        style={{ backgroundColor: color }}
                        title={color}
                        onClick={() => handleCreate(color)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost mt-2 w-full"
                    onClick={() => {
                      setIsCreating(false);
                      setNewStatusName("");
                    }}
                  >
                    Скасувати
                  </button>
                </div>
              )}

              {/* Випадаючий список збережених статусів */}
              <div ref={dropdownRef}>
                <button
                  type="button"
                  className="w-full text-left border rounded-lg px-3 py-2 text-xs flex items-center justify-between hover:bg-base-200"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <span className="truncate">
                    {statuses.length === 0
                      ? "Немає статусів"
                      : `Статуси (${statuses.length})`}
                  </span>
                  <span className="shrink-0 ml-1">
                    {dropdownOpen ? "▲" : "▼"}
                  </span>
                </button>
                {dropdownOpen && (
                  <div className="mt-1 border rounded-lg max-h-48 overflow-y-auto py-1">
                    {statuses.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-gray-500">
                        Немає статусів
                      </div>
                    ) : (
                      statuses.map((status) => (
                        <div key={status.id} className="px-2 py-1">
                          {editingId === status.id ? (
                            <div className="border rounded p-2 bg-base-100">
                              <input
                                type="text"
                                className="input input-bordered input-sm w-full mb-2"
                                placeholder="Назва статусу"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                autoFocus
                              />
                              <div className="flex flex-wrap gap-1 mb-2">
                                {COLOR_PALETTE.map((color) => (
                                  <button
                                    key={color}
                                    type="button"
                                    className="w-5 h-5 rounded border-2 border-gray-300 hover:border-primary hover:scale-110 transition-all"
                                    style={{ backgroundColor: color }}
                                    title={color}
                                    onClick={() =>
                                      handleUpdate(status.id, color)
                                    }
                                  />
                                ))}
                              </div>
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost w-full"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditName("");
                                }}
                              >
                                Скасувати
                              </button>
                            </div>
                          ) : (
                            <div className="group flex items-center gap-1 hover:bg-base-200 rounded">
                              <span
                                title={
                                  status.isDefault
                                    ? `${status.name} (за замовчуванням)`
                                    : status.name
                                }
                                className="flex-1 min-w-0 overflow-hidden"
                              >
                                <StatusBadge
                                  name={status.name}
                                  color={status.color}
                                  compact
                                />
                              </span>
                              <button
                                className="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0 min-h-0 h-5"
                                onClick={() => {
                                  setEditingId(status.id);
                                  setEditName(status.name);
                                }}
                                title="Редагувати"
                              >
                                ✎
                              </button>
                              <button
                                className="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0 min-h-0 h-5"
                                onClick={() => handleDelete(status.id)}
                                title="Видалити"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
