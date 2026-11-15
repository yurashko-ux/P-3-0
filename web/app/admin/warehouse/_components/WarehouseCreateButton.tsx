"use client";

import { useState } from "react";

export function WarehouseCreateButton({
  kind,
  onCreated,
  compact,
}: {
  kind: "storage" | "group";
  onCreated: (row: { id: string; title: string; isHair?: boolean }) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isHair, setIsHair] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = kind === "storage" ? "Склад" : "Група";
  const placeholder = kind === "storage" ? "Назва складу" : "Назва групи";

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const url = kind === "storage" ? "/api/admin/warehouse/storages" : "/api/admin/warehouse/catalog";
      const body = kind === "storage" ? { title: trimmed } : { action: "group", title: trimmed, isHair };
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка створення");
      const row = kind === "storage" ? json.storage : json.group;
      onCreated({ id: row.id, title: row.title, isHair: row.isHair });
      setTitle("");
      setIsHair(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="h-8 shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-gray-700 hover:bg-slate-100"
        title={`Створити: ${label}`}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {compact ? "+" : `+ ${label}`}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <input
          className="h-8 w-40 rounded-lg border border-slate-200 bg-white px-2.5 text-xs focus:border-blue-300 focus:outline-none"
          autoFocus
          placeholder={placeholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {kind === "group" && (
          <label className="flex items-center gap-1 text-[11px] whitespace-nowrap">
            <input type="checkbox" checked={isHair} onChange={(e) => setIsHair(e.target.checked)} />
            волосся
          </label>
        )}
        <button
          type="button"
          className="h-8 rounded-lg border border-slate-200 bg-[#e3edf9] px-2.5 text-xs font-medium text-gray-900 hover:brightness-[0.96] disabled:opacity-60"
          disabled={saving || !title.trim()}
          onClick={() => void submit()}
        >
          {saving ? "…" : "OK"}
        </button>
        <button type="button" className="h-8 rounded-lg px-2 text-xs text-gray-500 hover:bg-slate-100" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600 max-w-[240px]">{error}</p>}
    </div>
  );
}
