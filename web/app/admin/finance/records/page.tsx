"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type RecordRow = {
  id: string;
  number: string;
  kyivDay: string;
  time: string;
  client: string;
  phone: string | null;
  master: string;
  status: string;
  serviceTitle: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "очікує",
  synced: "у Kresco",
  sync_error: "помилка",
  deleted: "скасовано",
};

export default function FinanceKrescoRecordsPage() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/records?limit=300", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка завантаження");
      setRecords(json.records || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="px-3 pb-6 pt-2 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-gray-600">Записи, створені в Kresco. Нумерація з 00001 за часом створення.</p>
        <button type="button" className="btn btn-sm ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "Оновити"}
        </button>
      </div>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <div className="bg-white border rounded-xl overflow-auto max-h-[calc(100vh-11rem)]">
        <table className="table table-xs w-full">
          <thead className="sticky top-0 z-10 bg-[#eef1f6] [&_th]:bg-[#eef1f6]">
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Час</th>
              <th>Клієнт</th>
              <th>Телефон</th>
              <th>Майстер</th>
              <th>Послуги</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {records.map((row) => (
              <tr key={row.id}>
                <td className="tabular-nums whitespace-nowrap">
                  <Link
                    href={`/admin/journal?day=${row.kyivDay}&appointment=${row.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-hover"
                  >
                    {row.number}
                  </Link>
                </td>
                <td className="tabular-nums whitespace-nowrap">{row.kyivDay}</td>
                <td className="tabular-nums whitespace-nowrap">{row.time}</td>
                <td>{row.client}</td>
                <td className="whitespace-nowrap">{row.phone || "—"}</td>
                <td>{row.master}</td>
                <td className="text-xs">{row.serviceTitle || "—"}</td>
                <td className={row.status === "deleted" ? "text-gray-400" : ""}>
                  {STATUS_LABEL[row.status] || row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && records.length === 0 && <p className="p-4 text-sm text-gray-500">Записів Kresco ще немає.</p>}
        {loading && records.length === 0 && <p className="p-4 text-sm text-gray-500">Завантаження…</p>}
      </div>
    </main>
  );
}
