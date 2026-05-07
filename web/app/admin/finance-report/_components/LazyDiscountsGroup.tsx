"use client";

import { useEffect, useMemo, useState } from "react";
import type { DiscountVisitDetail } from "@/lib/altegio/records";
import { buildAltegioClientsSearchUrl } from "@/app/admin/direct/_components/direct-client-table-activity";
import { CollapsibleGroup } from "./CollapsibleGroup";

type DiscountsPayload = {
  ok?: boolean;
  discountAmount?: number;
  discountDetails?: DiscountVisitDetail[];
  error?: string;
};

type LazyDiscountsGroupProps = {
  year: number;
  month: number;
};

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rounded);
}

function getAltegioClientUrl(client: Pick<DiscountVisitDetail, "clientId" | "clientName" | "clientLastName">): string | null {
  const clientName = String(client.clientName || client.clientLastName || "").trim();
  const query = clientName || (client.clientId ? String(client.clientId) : "");
  if (!query) return null;
  return buildAltegioClientsSearchUrl(query);
}

export function LazyDiscountsGroup({ year, month }: LazyDiscountsGroupProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountDetails, setDiscountDetails] = useState<DiscountVisitDetail[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDiscounts() {
      setLoading(true);
      setError(null);
      setDiscountAmount(0);
      setDiscountDetails([]);

      try {
        const params = new URLSearchParams({
          year: String(year),
          month: String(month),
        });
        const res = await fetch(`/api/admin/finance-report/discounts?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as DiscountsPayload;
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        setDiscountAmount(Number(data.discountAmount) || 0);
        setDiscountDetails(Array.isArray(data.discountDetails) ? data.discountDetails : []);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadDiscounts();

    return () => controller.abort();
  }, [year, month]);

  const discountDetailsTotal = useMemo(
    () => discountDetails.reduce((sum, row) => sum + (Number(row.discount) || 0), 0),
    [discountDetails],
  );
  const undistributedDiscount = Math.round((discountAmount - discountDetailsTotal) * 100) / 100;
  const totalFormatted = loading ? "завантаження..." : formatMoney(discountAmount);

  return (
    <CollapsibleGroup
      title="Знижки"
      totalFormatted={totalFormatted}
      defaultCollapsed={true}
    >
      {loading && (
        <p className="rounded bg-blue-50 px-1 py-0.5 text-[11px] text-blue-700">
          Завантажуємо знижки після відкриття сторінки, щоб фінзвіт не чекав Altegio.
        </p>
      )}

      {!loading && error && (
        <p className="rounded bg-red-50 px-1 py-0.5 text-[11px] text-red-700">
          Не вдалося завантажити знижки: {error}
        </p>
      )}

      {!loading && !error && discountAmount <= 0 && (
        <p className="rounded bg-gray-50 px-1 py-0.5 text-[11px] text-gray-600">
          Знижок за цей період не знайдено.
        </p>
      )}

      {!loading && !error && discountAmount > 0 && (
        <div className="flex justify-between items-center bg-red-50 px-1 py-0.5 rounded">
          <span className="text-xs font-medium">Знижки</span>
          <span className="text-xs font-bold">
            {formatMoney(discountAmount)} грн.
          </span>
        </div>
      )}

      {!loading && !error && discountDetails.length > 0 && (
        <div className="rounded border border-red-100 bg-white px-1 py-1">
          <div className="mb-1 flex justify-between gap-2 text-[11px] text-gray-500">
            <span>Деталізація знижок по клієнтах і датах візитів</span>
            <span className="font-semibold text-gray-700">
              {discountDetails.length} рядків · деталізовано {formatMoney(discountDetailsTotal)} з {formatMoney(discountAmount)} грн.
            </span>
          </div>
          <div className="space-y-0.5 pr-1">
            {discountDetails.map((row, idx) => {
              const clientUrl = getAltegioClientUrl(row);
              const clientLabel = row.clientName || row.clientLastName;
              return (
                <div
                  key={`${row.visitId || row.recordId || idx}-${row.serviceTitle}-${row.discount}`}
                  className="grid grid-cols-[2rem_1.2fr_0.9fr_1.2fr_auto] items-start gap-2 rounded bg-red-50/60 px-1 py-0.5 text-[11px]"
                >
                  <span className="font-semibold text-gray-600">
                    {row.visitDate ? new Date(row.visitDate).getDate() : "-"}
                  </span>
                  {clientUrl ? (
                    <a
                      href={clientUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-700 underline-offset-2 hover:underline"
                      title={`Відкрити клієнта в Altegio: ${clientLabel}`}
                    >
                      {clientLabel}
                    </a>
                  ) : (
                    <span className="font-medium text-gray-800">{clientLabel}</span>
                  )}
                  <span className="truncate text-gray-600" title={row.staffName || "без майстра"}>
                    {row.staffName || "без майстра"}
                  </span>
                  <span className="truncate text-gray-500" title={row.serviceTitle}>
                    {row.serviceTitle}
                  </span>
                  <span className="font-bold text-red-700">
                    {formatMoney(row.discount)} грн.
                  </span>
                </div>
              );
            })}
            {Math.abs(undistributedDiscount) >= 1 && (
              <div className="grid grid-cols-[2rem_1.2fr_0.9fr_1.2fr_auto] items-start gap-2 rounded bg-yellow-50 px-1 py-0.5 text-[11px]">
                <span className="font-semibold text-yellow-700">-</span>
                <span className="font-medium text-yellow-800">Нерозподілено</span>
                <span className="text-yellow-700">без майстра</span>
                <span className="text-yellow-700">
                  Z-звіт / товари / інші знижки без деталізації в records
                </span>
                <span className="font-bold text-yellow-800">
                  {formatMoney(undistributedDiscount)} грн.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && !error && discountAmount > 0 && discountDetails.length === 0 && (
        <p className="rounded bg-yellow-50 px-1 py-0.5 text-[11px] text-yellow-700">
          Деталізація по візитах недоступна: сума знижок взята з агрегованого звіту Altegio.
        </p>
      )}
    </CollapsibleGroup>
  );
}
