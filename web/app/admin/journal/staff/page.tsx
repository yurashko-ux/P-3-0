"use client";

import { useCallback, useEffect, useState } from "react";

type StaffRow = {
  id: string;
  name: string;
  altegioStaffId: number;
  positionTitle: string;
  positionKind: string;
};

const KIND_LABEL: Record<string, string> = {
  master: "Майстер",
  assistant: "Асистент",
  admin: "Адміністратор",
  other: "Інше",
};

export default function JournalStaffPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/journal/staff", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
      setStaff(json.staff || []);
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
    <main className="p-3 space-y-3 max-w-4xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Штат журналу — працівники філії Altegio з посадою: майстри, асистенти, адміністратор. Без посади не показуємо.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <button className="btn btn-sm" disabled={loading} onClick={() => void load()}>
        {loading ? "Завантаження…" : "Оновити зі штату Altegio"}
      </button>
      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Працівник</th>
              <th>Посада</th>
              <th>id Altegio</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.positionTitle || KIND_LABEL[s.positionKind] || s.positionKind}</td>
                <td className="tabular-nums text-gray-500">{s.altegioStaffId}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && staff.length === 0 && (
          <p className="p-4 text-sm text-gray-500">Altegio не повернув працівників.</p>
        )}
      </div>
    </main>
  );
}
