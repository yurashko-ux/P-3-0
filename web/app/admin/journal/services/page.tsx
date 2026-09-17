"use client";

import { useCallback, useEffect, useState } from "react";

type ServiceRow = {
  id: string;
  title: string;
  kind: string;
  durationSec: number;
  altegioServiceId: number;
  isActive: boolean;
};

const KIND_LABEL: Record<string, string> = {
  consultation: "Консультація",
  hair: "Нарощування",
  other: "Інше",
};

export default function JournalServicesPage() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/journal/services?all=1", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
      setServices(json.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importFromAltegio = async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка імпорту");
      setServices(json.services || []);
      setNotice(`Імпорт: нових ${json.result?.imported ?? 0}, оновлено ${json.result?.updated ?? 0}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setImporting(false);
    }
  };

  const setKind = async (id: string, kind: string) => {
    setError(null);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kind", id, kind }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
      setServices((prev) => prev.map((s) => (s.id === id ? { ...s, kind } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  };

  return (
    <main className="p-3 space-y-3 max-w-4xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Довідник послуг дзеркалить Altegio. Тип (консультація / нарощування / інше) потрібен журналу і Direct. Regex — лише для першого імпорту.
      </p>
      {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <button className="btn btn-sm btn-primary" disabled={importing} onClick={() => void importFromAltegio()}>
        {importing ? "Імпорт…" : "Імпорт з Altegio"}
      </button>
      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Послуга</th>
              <th>Тип</th>
              <th>Хв</th>
              <th>id Altegio</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td>{s.title}</td>
                <td>
                  <select className="select select-bordered select-xs" value={s.kind} onChange={(e) => void setKind(s.id, e.target.value)}>
                    {Object.entries(KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </td>
                <td className="tabular-nums">{Math.round((s.durationSec || 0) / 60)}</td>
                <td className="tabular-nums text-gray-500">{s.altegioServiceId}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && services.length === 0 && <p className="p-4 text-sm text-gray-500">Поки порожньо. Натисніть «Імпорт з Altegio».</p>}
      </div>
    </main>
  );
}
