// web/app/(admin)/admin/campaigns/page.tsx
'use client';

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Counters = { v1: number; v2: number; exp: number };
type Base    = { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
type Item = {
  id: string;
  name?: string;
  v1?: string;
  v2?: string;
  base?: Base;
  counters?: Counters;
  createdAt?: number;
};

export default function CampaignsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/campaigns", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Помилка завантаження");
      setItems(j.items || []);
    } catch (e: any) {
      setError(e?.message || "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onDelete(id: string) {
    if (!confirm("Видалити кампанію?")) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не вдалося видалити");
      await load();
    } catch (e: any) {
      alert(e?.message || "Помилка видалення");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Кампанії</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/admin/campaigns/new")}
            className="rounded-md bg-blue-600 px-4 py-2 text-white"
          >
            + Нова кампанія
          </button>
          <button
            onClick={() => load()}
            className="rounded-md border px-4 py-2"
          >
            Оновити
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border bg-red-50 text-red-700 px-3 py-2">{error}</div>
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Дата/ID</th>
              <th className="px-4 py-3 text-left">Назва</th>
              <th className="px-4 py-3 text-left">Сутність</th>
              <th className="px-4 py-3 text-left">Воронка</th>
              <th className="px-4 py-3 text-left">Лічильник</th>
              <th className="px-4 py-3 text-right">Дії</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-center" colSpan={6}>Завантаження…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="px-4 py-12 text-center text-gray-500" colSpan={6}>Кампаній поки немає</td></tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-4 py-3">{it.createdAt || it.id}</td>
                  <td className="px-4 py-3">{it.name || "—"}</td>
                  <td className="px-4 py-3">
                    v1: {it.v1 ?? "—"} • v2: {it.v2 ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {it.base?.pipelineName || "—"}
                  </td>
                  <td className="px-4 py-3">
                    v1: {it.counters?.v1 ?? 0} • v2: {it.counters?.v2 ?? 0} • exp: {it.counters?.exp ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onDelete(it.id)}
                      disabled={busyId === it.id}
                      className="rounded-md bg-red-600 px-3 py-2 text-white disabled:opacity-60"
                    >
                      {busyId === it.id ? "..." : "Видалити"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
