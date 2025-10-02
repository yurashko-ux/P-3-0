// web/app/(admin)/admin/campaigns/new/page.tsx
"use client";

import { useState } from "react";

export default function NewCampaignPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const fd = new FormData(e.currentTarget);

    // ВИТЯГУЄМО значення з полів твоєї форми (підстав ключі своїх name=)
    const body = {
      name: String(fd.get("name") || "").trim(),
      base: pickPair(fd, "base"),  // очікує name="base.pipeline" та name="base.status"
      t1: pickPair(fd, "t1"),
      t2: pickPair(fd, "t2"),
      texp: pickPair(fd, "texp"),
      v1: val(fd.get("v1")),
      v2: val(fd.get("v2")),
    };

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const isJson = res.headers.get("content-type")?.includes("application/json");
      const data = isJson ? await res.json() : null;

      if (!res.ok) {
        setError(data?.error || `Помилка створення (${res.status})`);
        return;
      }

      // success -> назад до списку
      window.location.href = "/admin/campaigns";
    } catch (e: any) {
      setError(e?.message || "Мережева помилка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 space-y-4">
      {/* залиш свій існуючий UI; важливо, щоб name= збігалися з pickPair нижче */}
      {/* ... */}
      {error && (
        <div className="rounded-md bg-red-50 text-red-700 p-3 text-sm">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-xl shadow bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Зберегти
        </button>
        <a href="/admin/campaigns" className="px-4 py-2 rounded-xl shadow">
          Скасувати
        </a>
      </div>
    </form>
  );
}

function pickPair(fd: FormData, prefix: string) {
  // Підтримує name="prefix.pipeline" і name="prefix.status"
  const pipeline = val(fd.get(`${prefix}.pipeline`));
  const status = val(fd.get(`${prefix}.status`));
  if (!pipeline && !status) return undefined;
  return { pipeline, status };
}

function val(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}
