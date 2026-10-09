"use client";

import { useEffect, useRef, useState } from "react";
import { cashCountUnit, noteDenoms, type CashCountCurrency } from "@/lib/finance/cash-denominations";

function money(n: number) {
  return n.toLocaleString("uk-UA", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });
}

type Props = {
  accountId: number;
  accountTitle: string;
  currency: CashCountCurrency;
  onClose: () => void;
  onSaved: () => void;
};

export function CashCountModal({ accountId, accountTitle, currency, onClose, onSaved }: Props) {
  const denoms = noteDenoms(currency);
  const unit = cashCountUnit(currency);
  const [qty, setQty] = useState<string[]>(() => denoms.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  function lineQty(index: number): number {
    const raw = qty[index].trim();
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  function focusNext(index: number) {
    const next = inputs.current[index + 1];
    if (next) next.focus();
  }

  const total = denoms.reduce((sum, denomination, index) => sum + lineQty(index) * denomination, 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const lines = denoms.map((denomination, index) => ({
        denomination,
        qty: lineQty(index),
      }));
      const res = await fetch("/api/admin/finance/cash/count", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, lines }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не пораховано");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка касовки");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-[#f3f4f6] shadow-[0_12px_40px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">Касовка</div>
            <div className="text-xs text-gray-500">{accountTitle}</div>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 active:scale-95"
            onClick={onClose}
            disabled={busy}
          >
            Закрити
          </button>
        </div>

        <div className="space-y-2 p-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-10px_rgba(15,23,42,0.25)]">
            <div className="text-[11px] font-medium text-gray-500">Загальна сума</div>
            <div className="text-xl font-semibold tabular-nums text-gray-900">
              {money(total)} {unit}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_18px_-12px_rgba(15,23,42,0.2)]">
            <div className="mb-1.5 grid grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              <span />
              <span className="text-center">шт</span>
              <span className="pr-2 text-right">сума</span>
            </div>
            <div className="space-y-2">
              {denoms.map((denomination, index) => {
                const pieces = lineQty(index);
                const sum = pieces * denomination;
                const empty = qty[index].trim() === "";
                return (
                  <div
                    key={denomination}
                    className="grid grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2"
                  >
                    <div className="flex h-10 items-center justify-center rounded-xl bg-[#ebedf2] text-sm font-medium text-gray-800">
                      {denomination} {unit}
                    </div>
                    <input
                      ref={(node) => {
                        inputs.current[index] = node;
                      }}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-1 text-center text-sm tabular-nums shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
                      inputMode="numeric"
                      value={qty[index]}
                      placeholder="0"
                      disabled={busy}
                      aria-label={`${denomination} ${unit}, штук`}
                      onChange={(event) => {
                        const next = event.target.value.replace(/[^\d]/g, "");
                        setQty((prev) => prev.map((value, i) => (i === index ? next : value)));
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        focusNext(index);
                      }}
                    />
                    <div
                      className={`flex h-10 items-center justify-end rounded-xl border border-slate-100 bg-[#f7f8fa] px-2.5 text-sm font-medium tabular-nums ${
                        empty ? "text-gray-400" : "text-gray-900"
                      }`}
                    >
                      {money(sum)} {unit}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {error && <div className="alert alert-error py-2 text-sm">{error}</div>}
          <button
            type="button"
            className="w-full rounded-2xl bg-[#5c6a7c] py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_6px_14px_-6px_rgba(15,23,42,0.35)] transition duration-150 hover:bg-[#526070] active:scale-[0.98] active:shadow-[inset_0_2px_6px_rgba(15,23,42,0.28)] disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "…" : "Зберегти"}
          </button>
        </div>
      </div>
    </div>
  );
}
