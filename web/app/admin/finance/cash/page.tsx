"use client";

import { useCallback, useEffect, useState } from "react";
import { CashCountModal } from "./CashCountModal";
import { CashLedgerPanel } from "./CashLedgerPanel";
import { BankAccountPanel } from "./BankAccountPanel";
import { CashDocumentModal, type CashDocumentType } from "./CashDocumentModal";
import { CashAccountsModal } from "./CashAccountsModal";

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
  lastCountKyivDay: string | null;
  lastBundledAmount: number | null;
  variance: number | null;
};

/** На плитках показуємо до 1 грн / 1 од. валюти, без копійок. */
function money(n: number) {
  return Math.round(n).toLocaleString("uk-UA");
}

function fxSymbol(currency: CashTile["currency"]) {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return currency;
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
  "relative flex w-full flex-col items-center justify-center min-h-[4.5rem] rounded-xl border border-slate-200/80 px-2 py-1.5 text-center text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-8px_rgba(15,23,42,0.28)]";

const tileButtonClass = `${tileFaceClass} cursor-pointer select-none transition-[transform,box-shadow,filter] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_14px_24px_-8px_rgba(15,23,42,0.32)] active:translate-y-px active:scale-[0.97] active:brightness-[0.97] active:shadow-[inset_0_2px_8px_rgba(15,23,42,0.16),0_1px_2px_rgba(15,23,42,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400`;

/** Кнопки дій у тій самій палітрі й з тією самою тінню, що плитки. */
const actionButtonClass =
  "h-7 cursor-pointer select-none rounded-lg border border-slate-200/80 px-3 text-[11px] font-medium text-gray-800 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_10px_-6px_rgba(15,23,42,0.28)] transition-[transform,box-shadow,filter] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_8px_14px_-6px_rgba(15,23,42,0.32)] active:translate-y-px active:scale-[0.97] active:brightness-[0.97] disabled:cursor-default disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

function bookAmount(tile: CashTile): number | null {
  if (tile.currency === "UAH") return tile.balanceUah;
  return tile.balanceFx;
}

function VarianceLine({ tile }: { tile: CashTile }) {
  const variance = tile.variance;
  if (variance == null || Math.abs(Math.round(variance)) < 1) return null;
  const unit = tile.currency === "UAH" ? "грн" : fxSymbol(tile.currency);
  const shortage = variance < 0;
  return (
    <span
      className={`mt-0.5 text-[10px] font-medium leading-tight tabular-nums ${shortage ? "text-red-600" : "text-amber-700"}`}
      title={shortage ? "За останньою касовкою в касі менше, ніж за балансом" : "За останньою касовкою в касі більше, ніж за балансом"}
    >
      {shortage ? "недостача −" : "надлишок"} {money(Math.abs(variance))} {unit}
    </span>
  );
}

function LastCountLine({ tile }: { tile: CashTile }) {
  const day = formatKyivDayShort(tile.lastCountKyivDay);
  if (!tile.cash || !day) return null;
  return <span className="mt-0.5 text-[10px] leading-tight tabular-nums text-gray-500">касовка {day}</span>;
}

function TileFace({ tile }: { tile: CashTile }) {
  const book = bookAmount(tile);
  return (
    <>
      <span className="text-[10px] font-medium text-gray-700 leading-tight">{tile.title}</span>
      {tile.openingPending ? (
        <span className="mt-1 text-[11px] text-gray-500">Початковий залишок ще не заданий</span>
      ) : !tile.cash && !tile.hasBank ? (
        <span className="mt-1 text-[11px] text-gray-500">Немає банківського рахунку</span>
      ) : tile.balanceFx != null ? (
        <>
          <span className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
            {money(tile.balanceFx)} {fxSymbol(tile.currency)}
          </span>
          <LastCountLine tile={tile} />
          <VarianceLine tile={tile} />
        </>
      ) : (
        <>
          <span className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">{money(book || 0)} грн</span>
          <LastCountLine tile={tile} />
          <VarianceLine tile={tile} />
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
  const [ledgerReload, setLedgerReload] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Безготівковий рахунок, рухи якого показуємо замість готівки */
  const [bankTile, setBankTile] = useState<CashTile | null>(null);
  const [documentType, setDocumentType] = useState<CashDocumentType | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cashRes = await fetch("/api/admin/finance/cash", { credentials: "include", cache: "no-store" });
      const cashJson = await cashRes.json();
      if (!cashRes.ok || !cashJson.ok) throw new Error(cashJson.error || "Помилка завантаження");
      setTiles((cashJson.tiles || []) as CashTile[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pullFromAltegio() {
    setPulling(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/finance/cash/pull-today", { method: "POST", credentials: "include" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        day?: string;
        upserted?: number;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Не вдалося підтягнути рахунки з Altegio");
      }
      const [year, month, date] = String(payload.day || "").split("-");
      const dayLabel = year && month && date ? `${date}.${month}.${year}` : "сьогодні";
      setMessage(`Підтягнуто рахунки за ${dayLabel}: ${payload.upserted ?? 0} операцій`);
      void load();
      setLedgerReload((value) => value + 1);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не вдалося підтягнути рахунки з Altegio");
    } finally {
      setPulling(false);
    }
  }

  return (
    <main className="px-2 pb-6 pt-2 space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          className={actionButtonClass}
          style={{ background: "#e5f2e9" }}
          onClick={() => setDocumentType("income")}
        >
          + Прихід
        </button>
        <button
          type="button"
          className={actionButtonClass}
          style={{ background: "#f8ebe8" }}
          onClick={() => setDocumentType("expense")}
        >
          + Розхід
        </button>
        <button
          type="button"
          className={actionButtonClass}
          style={{ background: "#e6eef8" }}
          onClick={() => setDocumentType("transfer")}
        >
          + Переміщення
        </button>
        <button
          type="button"
          className={actionButtonClass}
          style={{ background: "#f3f5f8" }}
          onClick={() => setAccountsOpen(true)}
        >
          Рахунки
        </button>
        <button
          type="button"
          className={actionButtonClass}
          style={{ background: "#f6f3ee" }}
          disabled={pulling}
          onClick={() => void pullFromAltegio()}
          title="Підтягнути з Altegio лише рахунки за поточний день"
        >
          {pulling ? "Підтягую..." : "Підтягнути з Альтеджіо"}
        </button>
        <button
          type="button"
          className={actionButtonClass}
          style={{ background: "#e7eef6" }}
          disabled={loading || pulling}
          onClick={() => {
            void load();
            setLedgerReload((value) => value + 1);
          }}
        >
          Оновити
        </button>
      </div>

      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-900">{message}</div>
      )}
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}

      {loading && tiles.length === 0 && !error && (
        <p className="text-sm text-gray-500">Завантаження…</p>
      )}

      {!loading && !error && tiles.length === 0 && (
        <p className="text-sm text-gray-500">Рахунків немає.</p>
      )}

      {/* Плитки на всю ширину: нові рахунки стають у той самий ряд */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {tiles.map((tile, index) => {
          const face = <TileFace tile={tile} />;
          const tint = tileTint(tile, index);
          if (!tile.cash && tile.hasBank) {
            const selected = bankTile?.id === tile.id;
            return (
              <button
                key={tile.id}
                type="button"
                className={`${tileButtonClass} ${selected ? "ring-2 ring-blue-500" : ""}`}
                style={{ background: tint }}
                aria-label={`Рухи рахунку ${tile.title}`}
                title="Показати рухи рахунку"
                onClick={() => setBankTile(selected ? null : tile)}
              >
                {face}
              </button>
            );
          }
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
      {bankTile ? (
        <BankAccountPanel
          accountId={bankTile.id}
          accountTitle={bankTile.title}
          reloadToken={ledgerReload}
          onClose={() => setBankTile(null)}
        />
      ) : (
        <CashLedgerPanel reloadToken={ledgerReload} onCountsChanged={() => void load()} />
      )}
      {documentType && (
        <CashDocumentModal
          type={documentType}
          onClose={() => setDocumentType(null)}
          onSaved={() => {
            setDocumentType(null);
            void load();
            setLedgerReload((value) => value + 1);
          }}
        />
      )}
      {accountsOpen && (
        <CashAccountsModal
          onClose={() => setAccountsOpen(false)}
          onChanged={() => {
            void load();
            setLedgerReload((value) => value + 1);
          }}
        />
      )}
      {countTile && (
        <CashCountModal
          accountId={countTile.id}
          accountTitle={countTile.title}
          currency={countTile.currency}
          initialBundledAmount={countTile.lastBundledAmount}
          book={bookAmount(countTile)}
          lastCountLabel={formatKyivDayShort(countTile.lastCountKyivDay)}
          onClose={() => setCountTile(null)}
          onSaved={() => {
            setCountTile(null);
            void load();
            setLedgerReload((value) => value + 1);
          }}
        />
      )}
    </main>
  );
}
