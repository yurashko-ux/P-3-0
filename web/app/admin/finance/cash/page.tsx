"use client";

import { useCallback, useEffect, useState } from "react";

type CashTile = {
  id: number;
  title: string;
  currency: "UAH" | "USD" | "EUR";
  cash: boolean;
  balanceUah: number | null;
  balanceFx: number | null;
  openingPending: boolean;
  hasBank: boolean;
};

function money(n: number, digits = 0) {
  return n.toLocaleString("uk-UA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits === 0 && Number.isInteger(n) ? 0 : 2,
  });
}

function fxSymbol(currency: CashTile["currency"]) {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return currency;
}

export default function CashBalancesPage() {
  const [tiles, setTiles] = useState<CashTile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/cash", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка завантаження");
      setTiles(json.tiles || []);
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
        <p className="text-xs text-gray-600">
          Готівка — залишок на кінець 8 жовтня плюс рухи Kresco з 9 жовтня. Безготівка — фактичний баланс банку.
        </p>
        <button type="button" className="btn btn-sm ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "Оновити"}
        </button>
      </div>

      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      {loading && tiles.length === 0 && !error && (
        <p className="text-sm text-gray-500">Завантаження…</p>
      )}

      {!loading && !error && tiles.length === 0 && (
        <p className="text-sm text-gray-500">Рахунків немає.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-3xl">
        {tiles.map((tile) => (
          <div
            key={tile.id}
            className="flex flex-col items-center justify-center min-h-[6.5rem] rounded-lg border-2 border-gray-200 bg-white px-3 py-3 text-center"
          >
            <span className="text-[11px] font-medium text-gray-800 leading-tight">{tile.title}</span>
            {tile.openingPending ? (
              <span className="mt-1 text-[11px] text-gray-500">Початковий залишок ще не заданий</span>
            ) : !tile.cash && !tile.hasBank ? (
              <span className="mt-1 text-[11px] text-gray-500">Немає банківського рахунку</span>
            ) : tile.balanceFx != null ? (
              <>
                <span className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
                  {money(tile.balanceFx)} {fxSymbol(tile.currency)}
                </span>
                {tile.balanceUah != null && (
                  <span className="text-[11px] tabular-nums text-gray-500">{money(tile.balanceUah)} грн</span>
                )}
              </>
            ) : (
              <span className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
                {money(tile.balanceUah || 0)} грн
              </span>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
