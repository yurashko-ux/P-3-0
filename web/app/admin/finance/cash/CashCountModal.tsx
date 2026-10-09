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
  const [confirmed, setConfirmed] = useState<boolean[]>(() => denoms.map(() => false));
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

  function confirmAndNext(index: number) {
    setConfirmed((prev) => prev.map((value, i) => (i === index ? true : value)));
    const next = inputs.current[index + 1];
    if (next) next.focus();
  }

  function editAgain(index: number) {
    setConfirmed((prev) => prev.map((value, i) => (i === index ? false : value)));
    requestAnimationFrame(() => inputs.current[index]?.focus());
  }

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
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Касовка</div>
            <div className="text-xs text-gray-500">{accountTitle}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} disabled={busy}>
            Закрити
          </button>
        </div>
        <div className="space-y-2">
          {denoms.map((denomination, index) => {
            const pieces = lineQty(index);
            const sum = pieces * denomination;
            return (
              <div key={denomination} className="flex items-center gap-2">
                <div className="flex h-10 w-24 shrink-0 items-center justify-center rounded-lg border-2 border-gray-200 text-sm font-medium">
                  {denomination} {unit}
                </div>
                {confirmed[index] ? (
                  <button
                    type="button"
                    className="h-10 flex-1 rounded-md border border-gray-300 px-2 text-left text-sm tabular-nums"
                    onClick={() => editAgain(index)}
                  >
                    {money(sum)} {unit}
                  </button>
                ) : (
                  <input
                    ref={(node) => {
                      inputs.current[index] = node;
                    }}
                    className="input input-bordered h-10 flex-1 text-sm"
                    inputMode="numeric"
                    value={qty[index]}
                    placeholder="шт"
                    onChange={(event) => {
                      const next = event.target.value.replace(/[^\d]/g, "");
                      setQty((prev) => prev.map((value, i) => (i === index ? next : value)));
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      confirmAndNext(index);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {error && <div className="alert alert-error mt-3 py-2 text-sm">{error}</div>}
        <button type="button" className="btn btn-primary btn-sm mt-3 w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? "…" : "Зберегти"}
        </button>
      </div>
    </div>
  );
}
