"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function WarehouseDocumentDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/admin/warehouse/documents?id=${params.id}`, { credentials: "include" });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Не знайдено");
    setData(json.document);
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Помилка"));
  }, [params.id]);

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/warehouse/documents/${params.id}/retry`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка retry");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setRetrying(false);
    }
  };

  if (!data && !error) return <p className="p-4 text-sm">Завантаження…</p>;
  if (!data) {
    return (
      <main className="p-4">
        <p className="text-error">{error}</p>
        <Link href="/admin/warehouse/documents" className="btn btn-sm mt-2">Назад</Link>
      </main>
    );
  }

  const mismatch = Boolean(data.weightMismatch);

  return (
    <main className="max-w-5xl mx-auto p-3 space-y-3">
      <Link href="/admin/warehouse/documents" className="text-sm underline">← Документи</Link>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <div className={`bg-white border rounded-xl p-3 space-y-1 ${mismatch ? "border-red-400" : ""}`}>
        <h2 className="font-bold">{data.title || data.comment || data.type}</h2>
        <p className="text-sm text-gray-600">
          {data.kyivDay} · {data.type} · {data.kind || ""} · {data.toStorage?.title || data.fromStorage?.title || ""}
        </p>
        <p className="text-sm">
          Накладна: {data.invoiceAmount ?? "—"} {data.currencyCode || ""}
          {data.deliveryAmount ? ` · доставка ${data.deliveryAmount}` : ""}
        </p>
        {data.fxRateUsdUah ? <p className="text-sm">Курс закупки: {data.fxRateUsdUah} грн/$</p> : null}
        {data.invoiceWeightGrams != null && (
          <p className={`text-sm ${mismatch ? "text-red-600 font-semibold" : ""}`}>
            Грами накладної: {data.invoiceWeightGrams}, дельта {data.weightDeltaGrams} г
          </p>
        )}
        <p className="text-xs text-gray-500">Altegio id: {data.altegioTxId || "—"} · статус {data.syncStatus} {data.syncError || ""}</p>
        {(data.syncStatus === "error" || data.status === "sync_error") && (
          <button className="btn btn-sm btn-warning" disabled={retrying} onClick={() => void retry()}>
            {retrying ? "Повтор…" : "Повторити запис у Altegio"}
          </button>
        )}
      </div>
      <div className="overflow-x-auto bg-white rounded-xl border">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>№</th>
              <th>Товар</th>
              <th>г</th>
              <th className="text-right">К-сть</th>
              <th className="text-right">USD</th>
              <th className="text-right">грн</th>
              <th>Факт</th>
            </tr>
          </thead>
          <tbody>
            {(data.lines || []).map((line: any) => (
              <tr key={line.id}>
                <td>{line.product?.sku ?? "—"}</td>
                <td>{line.product?.title}</td>
                <td>{line.weightGrams ?? line.product?.weightGrams ?? "—"}</td>
                <td className="text-right">{line.quantity}</td>
                <td className="text-right">{line.costUsd ?? "—"}</td>
                <td className="text-right">{Math.round(line.costPerUnit || 0)}</td>
                <td>{line.countedQty ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data.children || []).length > 0 && (
        <p className="text-sm">
          Пов’язані:{" "}
          {data.children.map((child: any) => (
            <Link key={child.id} className="underline mr-2" href={`/admin/warehouse/documents/${child.id}`}>
              {child.type} {child.title || ""}
            </Link>
          ))}
        </p>
      )}
    </main>
  );
}
