// web/app/(admin)/admin/campaigns/new/page.tsx
'use client';

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PIPELINES, statusesForPipeline } from "@/lib/lookups";

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pipeline, setPipeline] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const statusOptions = useMemo(() => statusesForPipeline(pipeline), [pipeline]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Вкажіть назву кампанії");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          base: { pipeline: pipeline || undefined, status: status || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Помилка збереження");
      }
      // назад у список
      router.push("/admin/campaigns");
      router.refresh?.();
    } catch (err: any) {
      setError(err?.message || "Помилка збереження");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold mb-6">Нова кампанія</h1>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1">Назва кампанії</label>
          <input
            className="w-full rounded-md border px-3 py-2"
            placeholder="Напр.: UI-created"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Воронка</label>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={pipeline}
            onChange={(e) => {
              const p = e.target.value;
              setPipeline(p);
              // якщо змінюємо воронку і поточний статус їй не належить — скинемо
              if (!statusesForPipeline(p).some(s => s.id === status)) {
                setStatus("");
              }
            }}
          >
            <option value="">—</option>
            {PIPELINES.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Статус</label>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={!pipeline}
          >
            <option value="">—</option>
            {statusOptions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {!pipeline && (
            <p className="text-xs text-gray-500 mt-1">
              Спочатку оберіть воронку — тоді зʼявляться доступні статуси.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 text-red-700 px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? "Збереження..." : "Зберегти"}
        </button>
      </form>
    </div>
  );
}
