"use client";

import { useCallback, useEffect, useState } from "react";
import { summarizeOpenCashForAccount } from "@/lib/finance/cash-ledger-aggregate";
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
  openPaymentsFromKyivDay: string | null;
  lastBundledAmount: number | null;
};

type LedgerApiRow = {
  accountId: number;
  currency: string;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
  occurredAt: string;
  title: string;
  clientName: string;
  recordId: number | null;
  posted: boolean;
  accountTitle: string;
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

function paymentsWord(count: number): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  if (n >= 11 && n <= 14) return "платежів";
  if (last === 1) return "платіж";
  if (last >= 2 && last <= 4) return "платежі";
  return "платежів";
}

function formatKyivDayShort(ymd: string | null | undefined): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [, month, day] = ymd.split("-");
  return `${day}.${month}.${ymd.slice(2, 4)}`;
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
  if (!tile.cash || !tile.openPaymentsCount) return null;
  const count = tile.openPaymentsCount;
  const net = tile.openPaymentsNet || 0;
  const unit = tile.currency === "UAH" ? "грн" : fxSymbol(tile.currency);
  const from = formatKyivDayShort(tile.openPaymentsFromKyivDay);
  const tone = net < 0 ? "text-red-600" : "text-emerald-700";
  return (
    <span
      className={`mt-0.5 text-[11px] font-medium leading-tight tabular-nums ${tone}`}
      title="Непроведені платежі після останньої збіжної касовки"
    >
      {count} {paymentsWord(count)}
      {from ? ` з ${from}` : ""}{" "}
      {net > 0 ? "+" : ""}
      {money(net)} {unit}
    </span>
  );
}

function TileFace({ tile }: { tile: CashTile }) {
  const book = bookAmount(tile);
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
          <OpenPaymentsLine tile={tile} />
        </>
      ) : (
        <>
          <span className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{money(book || 0)} грн</span>
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
      // Баланс з /cash, непроведені — з того самого ledger, що вкладка «Готівка».
      const [cashRes, ledgerRes] = await Promise.all([
        fetch("/api/admin/finance/cash", { credentials: "include", cache: "no-store" }),
        fetch("/api/admin/finance/cash/ledger", { credentials: "include", cache: "no-store" }),
      ]);
      const cashJson = await cashRes.json();
      if (!cashRes.ok || !cashJson.ok) throw new Error(cashJson.error || "Помилка завантаження");
      const tilesRaw = (cashJson.tiles || []) as CashTile[];

      let ledger: LedgerApiRow[] = [];
      if (ledgerRes.ok) {
        const ledgerJson = await ledgerRes.json();
        if (ledgerJson.ok && Array.isArray(ledgerJson.rows)) {
          ledger = ledgerJson.rows as LedgerApiRow[];
        } else {
          console.warn("[finance/cash] Ledger для непроведених не завантажився, лишаємо дані з /cash");
        }
      } else {
        console.warn("[finance/cash] Ledger HTTP", ledgerRes.status);
      }

      setTiles(
        tilesRaw.map((tile) => {
          if (!tile.cash || tile.openingPending || ledger.length === 0) return tile;
          const open = summarizeOpenCashForAccount(ledger, tile.id, tile.currency);
          return {
            ...tile,
            openPaymentsNet: open.net,
            openPaymentsCount: open.count,
            openPaymentsFromKyivDay: open.fromKyivDay,
          };
        }),
      );
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
      <div className="flex items-center">
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
          initialBundledAmount={countTile.lastBundledAmount}
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
