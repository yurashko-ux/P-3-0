"use client";

import { useMemo, useState } from "react";
import { TEAM_PAY_KIND_LABELS, type TeamPayKind } from "@/lib/team/constants";
import {
  collisionWarningText,
  stackPayAccrual,
  type SchemeRef,
} from "@/lib/team/scheme-stack";

function parseAmount(raw: string): number {
  const n = Number(String(raw).replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function money(n: number): string {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function PaySchemePreview({
  personName,
  schemes,
  onClose,
}: {
  personName: string;
  schemes: SchemeRef[];
  onClose: () => void;
}) {
  const [services, setServices] = useState("10000");
  const [goods, setGoods] = useState("2000");
  const [hair, setHair] = useState("0");
  const [days, setDays] = useState("20");

  const stacked = useMemo(
    () =>
      stackPayAccrual(schemes, {
        servicesUah: parseAmount(services),
        goodsUah: parseAmount(goods),
        hairSalesUah: parseAmount(hair),
        workDays: parseAmount(days),
      }),
    [schemes, services, goods, hair, days],
  );
  const warning = collisionWarningText(stacked.collisions);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-sm">Подивитись: {personName}</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Приклад. Схеми додаються. Виплата в Altegio не змінюється.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-xs btn-circle" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SampleField label="Послуги, грн" value={services} onChange={setServices} />
          <SampleField label="Товари, грн" value={goods} onChange={setGoods} />
          <SampleField label="З них волосся, грн" value={hair} onChange={setHair} />
          <SampleField label="Дні" value={days} onChange={setDays} />
        </div>

        {warning && <div className="alert alert-warning text-xs py-2">{warning}</div>}

        <div className="flex flex-col items-stretch gap-1">
          {stacked.parts.map((part, index) => (
            <div key={part.schemeId}>
              {index > 0 && <div className="text-center text-xs text-gray-400 py-0.5">+</div>}
              <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{part.title}</span>
                  <span className="tabular-nums text-sm font-semibold">{money(part.amountUah)} грн</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {TEAM_PAY_KIND_LABELS[part.kind as TeamPayKind] || part.kind}
                  {" · "}
                  {part.breakdown}
                </p>
              </div>
            </div>
          ))}
          <div className="text-center text-xs text-gray-400 py-0.5">↓</div>
          <div className="border-2 border-gray-800 rounded-lg px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Разом нараховано</span>
              <span className="tabular-nums text-sm font-bold">{money(stacked.totalUah)} грн</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SampleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-control">
      <span className="label py-0 min-h-0">
        <span className="label-text text-[11px] text-gray-500">{label}</span>
      </span>
      <input
        className="input input-bordered input-sm h-8"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
