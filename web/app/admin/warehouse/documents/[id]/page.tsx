"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { navTileClass } from "@/app/admin/_components/nav-tile";
import {
  Banner,
  DOC_TINT,
  StatusPill,
  cardClass,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
  tintButtonClass,
  trClass,
} from "../../_components/warehouse-ui";

const TYPE_LABEL: Record<string, string> = {
  intake: "Прийомка",
  write_off: "Списання",
  inventory_count: "Інвентаризація",
  transfer: "Переміщення",
};

function docTint(data: { type: string; kind?: string | null }): string {
  if (data.type === "intake") return data.kind === "hair" ? DOC_TINT.hair : DOC_TINT.goods;
  if (data.type === "write_off") return DOC_TINT.write_off;
  if (data.type === "inventory_count") return DOC_TINT.inventory;
  if (data.type === "transfer") return DOC_TINT.transfer;
  return "#f3f5f8";
}

function money(value: number | null | undefined, digits = 0): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-baseline gap-2 text-xs">
      <span className="text-gray-600">{label}</span>
      <span className="min-w-0 text-gray-900">{children}</span>
    </div>
  );
}

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

  if (!data && !error) return <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження…</p>;
  if (!data) {
    return (
      <main className="mx-auto max-w-5xl space-y-2 p-3">
        <Banner tone="error">{error}</Banner>
        <Link href="/admin/warehouse/documents" className={navTileClass(false)}>
          ← Документи
        </Link>
      </main>
    );
  }

  const mismatch = Boolean(data.weightMismatch);
  const tint = docTint(data);
  const syncFailed = data.syncStatus === "error" || data.status === "sync_error";
  const storageLabel =
    data.type === "transfer"
      ? `${data.fromStorage?.title || "?"} → ${data.toStorage?.title || "?"}`
      : data.toStorage?.title || data.fromStorage?.title || "—";
  const lines: any[] = data.lines || [];
  const isInventory = data.type === "inventory_count";
  const showUsd = lines.some((line) => line.costUsd);
  const showGrams = lines.some((line) => line.weightGrams ?? line.product?.weightGrams);

  return (
    <main className="mx-auto max-w-5xl space-y-2 p-3">
      <Link href="/admin/warehouse/documents" className={navTileClass(false)}>
        ← Документи
      </Link>
      {error && <Banner tone="error">{error}</Banner>}

      <div className={`${cardClass} overflow-hidden ${mismatch ? "border-red-400" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" style={{ background: tint }}>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">
              {data.number ? `№ ${data.number} · ` : ""}
              {data.salonCheckout ? "Продаж" : TYPE_LABEL[data.type] || data.type}
              {data.kind === "hair" ? " · волосся" : ""}
            </div>
            <h2 className="truncate text-sm font-bold text-gray-900">{data.title || data.comment || data.type}</h2>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {syncFailed ? (
              <StatusPill tone="error">помилка Altegio</StatusPill>
            ) : data.syncStatus === "synced" ? (
              <StatusPill tone="ok">проведено</StatusPill>
            ) : data.syncStatus === "local" ? (
              <StatusPill tone="muted">лише Kresco</StatusPill>
            ) : (
              <StatusPill tone="muted">{data.syncStatus}</StatusPill>
            )}
          </div>
        </div>
        <div className="space-y-1.5 px-4 py-3">
          <InfoRow label="Дата">{data.kyivDay}</InfoRow>
          <InfoRow label="Склад">{storageLabel}</InfoRow>
          {data.invoiceAmount != null && (
            <InfoRow label="Накладна">
              <span className="font-semibold tabular-nums">
                {money(data.invoiceAmount, 2)} {data.currencyCode || ""}
              </span>
              {data.deliveryAmount ? <span className="text-gray-600"> · доставка {money(data.deliveryAmount, 2)}</span> : null}
            </InfoRow>
          )}
          {data.fxRateUsdUah ? <InfoRow label="Курс закупки">{data.fxRateUsdUah} грн/$</InfoRow> : null}
          {data.invoiceWeightGrams != null && (
            <InfoRow label="Вага накладної">
              <span className={mismatch ? "font-semibold text-red-600" : ""}>
                {money(data.invoiceWeightGrams)} г, дельта {data.weightDeltaGrams} г
              </span>
            </InfoRow>
          )}
          {data.comment && data.comment !== data.title ? <InfoRow label="Коментар">{data.comment}</InfoRow> : null}
          <InfoRow label="Altegio">
            <span className="tabular-nums">{data.altegioTxId || "—"}</span>
            {data.syncError ? <span className="block text-[11px] text-red-700">{data.syncError}</span> : null}
          </InfoRow>
          {syncFailed && (
            <div className="pt-1">
              <button
                type="button"
                className={tintButtonClass()}
                style={{ background: DOC_TINT.write_off }}
                disabled={retrying}
                onClick={() => void retry()}
              >
                {retrying ? "Повтор…" : "Повторити запис у Altegio"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        <table className={tableClass}>
          <thead>
            <tr className={theadRowClass}>
              <th className={`${thClass} w-24`}>Код</th>
              <th className={thClass}>Товар</th>
              {showGrams && <th className={`${thClass} text-right`}>Вага, г</th>}
              <th className={`${thClass} text-right`}>{isInventory ? "Облік" : "К-сть"}</th>
              {isInventory && <th className={`${thClass} text-right`}>Факт</th>}
              {showUsd && <th className={`${thClass} text-right`}>USD</th>}
              <th className={`${thClass} text-right`}>Собівартість, грн</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const diff = isInventory && line.countedQty != null ? Number(line.countedQty) - Number(line.quantity) : 0;
              return (
                <tr key={line.id} className={`${trClass} ${diff !== 0 ? "bg-amber-50" : ""}`}>
                  <td className={`${tdClass} tabular-nums text-gray-500`}>{line.product?.sku ?? "—"}</td>
                  <td className={`${tdClass} text-gray-900`}>{line.product?.title}</td>
                  {showGrams && (
                    <td className={`${tdClass} text-right tabular-nums`}>{line.weightGrams ?? line.product?.weightGrams ?? "—"}</td>
                  )}
                  <td className={`${tdClass} text-right tabular-nums`}>{line.quantity}</td>
                  {isInventory && (
                    <td
                      className={`${tdClass} text-right font-semibold tabular-nums ${
                        diff > 0 ? "text-green-700" : diff < 0 ? "text-red-600" : ""
                      }`}
                    >
                      {line.countedQty ?? "—"}
                    </td>
                  )}
                  {showUsd && <td className={`${tdClass} text-right tabular-nums`}>{line.costUsd ?? "—"}</td>}
                  <td className={`${tdClass} text-right font-semibold tabular-nums`}>{money(line.costPerUnit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(data.children || []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-600">Пов’язані документи:</span>
          {data.children.map((child: any) => (
            <Link key={child.id} className={navTileClass(false)} href={`/admin/warehouse/documents/${child.id}`}>
              {TYPE_LABEL[child.type] || child.type} · {child.title || ""}
            </Link>
          ))}
        </div>
      )}
      {data.parent && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-600">Створено з:</span>
          <Link className={navTileClass(false)} href={`/admin/warehouse/documents/${data.parent.id}`}>
            {TYPE_LABEL[data.parent.type] || data.parent.type} · {data.parent.title || ""}
          </Link>
        </div>
      )}
    </main>
  );
}
