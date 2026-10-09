"use client";

import { useCallback, useEffect, useState } from "react";
import { CashCountModal } from "./CashCountModal";

type CashTile = {
  id: number;
  title: string;
  currency: "UAH" | "USD" | "EUR";
  cash: boolean;
  balanceUah: number | null;
  balanceFx: number | null;
  openingPending: boolean;
  hasBank: boolean;
  countedUah: number | null;
  openPaymentsNet: number;
  openPaymentsCount: number;
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

function isCashTill(tile: CashTile): boolean {
  return tile.cash && !tile.openingPending;
}

/** М’які відтінки в палітрі картки запису: готівка трохи сильніше, рахунки ФОП — тихіше. */
function tileTint(tile: CashTile, index: number): string {
  if (tile.cash) {
    if (tile.currency === "USD") return "#e5f2e9";
    if (tile.currency === "EUR") return "#e6eef8";
    return "#e7eef6";
  }
  const bank = ["#f3f5f8", "#f6f3ee", "#f2f6f3", "#f5f3f7", "#f2f4f6"];
  return bank[index % bank.length];
}

const tileFaceClass =
  "relative flex w-full flex-col items-center justify-center min-h-[6.5rem] rounded-2xl border border-slate-200/80 px-3 py-3 text-center text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-8px_rgba(15,23,42,0.28)]";

const tileButtonClass = `${tileFaceClass} cursor-pointer select-none transition-[transform,box-shadow,filter] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_14px_24px_-8px_rgba(15,23,42,0.32)] active:translate-y-px active:scale-[0.97] active:brightness-[0.97] active:shadow-[inset_0_2px_8px_rgba(15,23,42,0.16),0_1px_2px_rgba(15,23,42,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400`;

function bookAmount(tile: CashTile): number | null {
  if (tile.currency === "UAH") return tile.balanceUah;
  return tile.balanceFx;
}

function OpenPaymentsLine({ tile }: { tile: CashTile }) {
  if (!tile.openPaymentsCount) return null;
  const net = tile.openPaymentsNet || 0;
  const unit = tile.currency === "UAH" ? "грн" : fxSymbol(tile.currency);
  return (
    <span className="text-[11px] font-medium tabular-nums text-gray-700" title="Ще не проведені платежі">
      {net > 0 ? "+" : ""}
      {money(net)} {unit} · {tile.openPaymentsCount}
    </span>
  );
}

function TileFace({ tile }: { tile: CashTile }) {
  const book = bookAmount(tile);
  const counted = tile.countedUah;
  const diff = counted != null && book != null ? Math.round((counted - book) * 100) / 100 : null;
  const unit = tile.currency === "UAH" ? "грн" : fxSymbol(tile.currency);
  return (
    <>
      <span className="text-[11px] font-medium text-gray-700 leading-tight">{tile.title}</span>
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
          {counted != null && (
            <span className="text-[11px] tabular-nums text-gray-500">
              ({money(counted)} {unit})
            </span>
          )}
          {diff != null && diff !== 0 && (
            <span className={`text-[11px] font-medium tabular-nums ${diff > 0 ? "text-green-600" : "text-red-600"}`}>
              {diff > 0 ? "+" : ""}
              {money(diff)} {unit}
            </span>
          )}
          <OpenPaymentsLine tile={tile} />
        </>
      ) : (
        <>
          <span className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{money(book || 0)} грн</span>
          {counted != null && (
            <span className="text-[11px] tabular-nums text-gray-500">({money(counted)} грн)</span>
          )}
          {diff != null && diff !== 0 && (
            <span className={`text-[11px] font-medium tabular-nums ${diff > 0 ? "text-green-600" : "text-red-600"}`}>
              {diff > 0 ? "+" : ""}
              {money(diff)} грн
            </span>
          )}
          <OpenPaymentsLine tile={tile} />
        </>
      )}
    </>
  );
}

export default function CashBalancesPage() {
  const [tiles, setTiles] = useState<CashTile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [countTile, setCountTile] = useState<CashTile | null>(null);

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
          Готівка — залишок на кінець 8 жовтня плюс платежі з 9 жовтня. Безготівка — фактичний баланс банку.
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-3xl">
        {tiles.map((tile, index) => {
          const face = <TileFace tile={tile} />;
          const tint = tileTint(tile, index);
          if (!isCashTill(tile)) {
            return (
              <div key={tile.id} className={tileFaceClass} style={{ background: tint }}>
                {face}
              </div>
            );
          }
          return (
            <button
              key={tile.id}
              type="button"
              className={tileButtonClass}
              style={{ background: tint }}
              aria-label={`Перерахунок ${tile.title}`}
              onClick={() => setCountTile(tile)}
            >
              {face}
            </button>
          );
        })}
      </div>
      {countTile && (
        <CashCountModal
          accountId={countTile.id}
          accountTitle={countTile.title}
          currency={countTile.currency}
          onClose={() => setCountTile(null)}
          onSaved={() => {
            setCountTile(null);
            void load();
          }}
        />
      )}
    </main>
  );
}
