"use client";

import { useCallback, useEffect, useState } from "react";

type DocRow = {
  id: string;
  type: string;
  status: string;
  syncStatus: string;
  syncError: string | null;
  title: string | null;
  amountUah: number;
  currency: string;
  amountFx: number | null;
  kyivDay: string;
  occurredAt: string;
  accountId: number;
  accountTitle: string | null;
  counterAccountId: number | null;
  counterAccountTitle: string | null;
  purposeTitle: string | null;
  comment: string | null;
  altegioTransactionId: number | null;
  altegioCounterTransactionId: number | null;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  income: "Прихід",
  expense: "Розхід",
  transfer: "Переміщення",
};

function money(n: number) {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FinanceDocumentsPage() {
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/documents?limit=80", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка завантаження");
      setDocuments(json.documents || []);
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
    <main className="p-3 space-y-3 max-w-6xl">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-gray-600">
          Журнал ручних документів. Створюються вони в розділі Каса й лишаються лише в Креско, в Альтеджіо не йдуть.
        </p>
        <button type="button" className="btn btn-sm btn-ghost ml-auto" onClick={() => void load()} disabled={loading}>
          Оновити
        </button>
      </div>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-500">Завантаження…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-gray-500">Документів ще немає.</p>
      ) : (
        <div className="overflow-x-auto bg-white border rounded-xl">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>День</th>
                <th>Тип</th>
                <th>Сума</th>
                <th>Рахунок</th>
                <th>Стаття</th>
                <th>Статус</th>
                <th>Altegio</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap text-xs">{d.kyivDay}</td>
                  <td className="text-xs">{TYPE_LABEL[d.type] || d.type}</td>
                  <td className="text-xs font-medium whitespace-nowrap">
                    {d.amountFx != null ? `${money(d.amountFx)} ${d.currency === "USD" ? "$" : "€"}` : money(d.amountUah)}
                  </td>
                  <td className="text-xs">
                    {d.accountTitle || d.accountId}
                    {d.type === "transfer" && d.counterAccountTitle
                      ? ` → ${d.counterAccountTitle}`
                      : ""}
                  </td>
                  <td className="text-xs">{d.purposeTitle || d.title || "—"}</td>
                  <td className="text-xs">
                    {d.syncStatus === "local" ? (
                      <span className="text-success">лише Kresco</span>
                    ) : d.syncStatus === "synced" ? (
                      <span className="text-success">synced</span>
                    ) : d.syncStatus === "error" ? (
                      <span className="text-error" title={d.syncError || ""}>
                        error
                      </span>
                    ) : (
                      d.syncStatus
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {d.altegioTransactionId ?? "—"}
                    {d.altegioCounterTransactionId ? ` / ${d.altegioCounterTransactionId}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
