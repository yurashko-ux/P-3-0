"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navTileClass } from "@/app/admin/_components/nav-tile";
import { FINANCE_HEADER_ACTIONS_ID } from "@/app/admin/finance/_components/FinanceChrome";
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
    return "#f6efdf";
  }
  const bank = ["#f3f5f8", "#f6f3ee", "#f2f6f3", "#f5f3f7", "#f2f4f6"];
  return bank[index % bank.length];
}

/** Квадрат касовки: той самий відтінок, що плитка, трохи насиченіший. */
function countButtonTint(tile: CashTile): string {
  if (tile.currency === "USD") return "#cfe6d7";
  if (tile.currency === "EUR") return "#d0dff2";
  return "#ead9b4";
}

const tileFaceClass =
  "relative flex w-full flex-col items-center justify-center min-h-[4.5rem] rounded-xl border border-slate-200/80 px-2 py-1.5 text-center text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-8px_rgba(15,23,42,0.28)]";

const tileButtonClass = `${tileFaceClass} cursor-pointer select-none transition-[transform,box-shadow,filter] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_14px_24px_-8px_rgba(15,23,42,0.32)] active:translate-y-px active:scale-[0.97] active:brightness-[0.97] active:shadow-[inset_0_2px_8px_rgba(15,23,42,0.16),0_1px_2px_rgba(15,23,42,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400`;

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
      {/* Назву каси показує символ валюти в квадраті касовки; рахунки ФОП лишаються з назвою */}
      {tile.cash ? null : <span className="text-[10px] font-medium text-gray-700 leading-tight">{tile.title}</span>}
      {tile.openingPending ? (
        <span className="mt-1 text-[11px] text-gray-500">Початковий залишок ще не заданий</span>
      ) : !tile.cash && !tile.hasBank ? (
        <span className="mt-1 text-[11px] text-gray-500">Немає банківського рахунку</span>
      ) : tile.balanceFx != null ? (
        <>
          <span className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
            {/* Валюту каси показує квадрат касовки — після суми її не пишемо */}
            {money(tile.balanceFx)}
          </span>
          <LastCountLine tile={tile} />
          <VarianceLine tile={tile} />
        </>
      ) : (
        <>
          <span className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">{money(book || 0)}
            {tile.cash ? "" : " грн"}
          </span>
          <LastCountLine tile={tile} />
          <VarianceLine tile={tile} />
        </>
      )}
    </>
  );
}

export default function CashBalancesPage() {
  const [tiles, setTiles] = useState<CashTile[]>([]);
  const [deposits, setDeposits] = useState<{ total: number; clients: number; snapshotAt: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/admin/finance/cash/deposits-total", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok) setDeposits({ total: data.total, clients: data.clients, snapshotAt: data.snapshotAt });
      })
      .catch((err) => console.error("[cash] Завдатки не завантажено:", err));
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [countTile, setCountTile] = useState<CashTile | null>(null);
  const [ledgerReload, setLedgerReload] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Висота панелі Фінансів і плиток — щоб плитки й колонка касовок закріплювались під ними */
  const [financeHeaderH, setFinanceHeaderH] = useState(0);
  const [tilesH, setTilesH] = useState(0);
  const tilesRef = useRef<HTMLDivElement>(null);
  /** Місце в панелі Фінансів після «Звіт» */
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  /** За замовчуванням показуємо всі рахунки; натискання на плитку виключає її рахунок (повторне — повертає) */
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const toggleTile = (id: number) =>
    setExcludedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  const selectedBankTiles = tiles.filter((tile) => !tile.cash && tile.hasBank && !excludedIds.includes(tile.id));
  const selectedCashTitles = tiles
    .filter((tile) => isCashTill(tile) && !excludedIds.includes(tile.id))
    .map((tile) => tile.title);
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

  useEffect(() => {
    const slot = document.getElementById(FINANCE_HEADER_ACTIONS_ID);
    setHeaderSlot(slot);
    const header = slot?.closest("header");
    const tiles = tilesRef.current;
    const measure = () => {
      setFinanceHeaderH(header?.getBoundingClientRect().height ?? 0);
      setTilesH(tiles?.getBoundingClientRect().height ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    if (tiles) observer.observe(tiles);
    return () => observer.disconnect();
  }, []);

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
      // Успіх не показуємо окремим рядком: нові операції просто з’являються в таблиці
      void load();
      setLedgerReload((value) => value + 1);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не вдалося підтягнути рахунки з Altegio");
    } finally {
      setPulling(false);
    }
  }

  return (
    <main
      className="px-2 pb-6 space-y-2"
      style={{ "--cash-sticky-top": `${financeHeaderH + tilesH}px` } as React.CSSProperties}
    >
      {headerSlot
        ? createPortal(
            <>
              <button
                type="button"
                className={navTileClass(false)}
                disabled={pulling}
                onClick={() => void pullFromAltegio()}
                title="Підтягнути з Altegio лише рахунки за поточний день"
              >
                {pulling ? "Підтягую..." : "Підтягнути з Альтеджіо"}
              </button>
              <button type="button" className={navTileClass(false)} onClick={() => setAccountsOpen(true)}>
                Архів рахунків
              </button>
            </>,
            headerSlot,
          )
        : null}
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

      {/* Плитки на всю ширину й закріплені під панеллю Фінансів: список рухів гортається під ними */}
      <div
        ref={tilesRef}
        className="sticky z-10 -mx-2 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 bg-[#f6f7fb] px-2 py-2"
        style={{ top: `calc(var(--admin-nav-h, 0px) + ${financeHeaderH}px)` }}
      >
        {tiles.map((tile, index) => {
          const face = <TileFace tile={tile} />;
          const tint = tileTint(tile, index);
          if (!tile.cash && tile.hasBank) {
            const excluded = excludedIds.includes(tile.id);
            return (
              <button
                key={tile.id}
                type="button"
                className={`${tileButtonClass} ${excluded ? "opacity-40 grayscale" : ""}`}
                style={{ background: tint }}
                aria-label={`Рухи рахунку ${tile.title}`}
                aria-pressed={!excluded}
                title={excluded ? "Показати рухи рахунку" : "Сховати рухи рахунку"}
                onClick={() => toggleTile(tile.id)}
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
          // Плитка каси: натискання показує її рухи, маленький квадрат у куті — касовка
          const excluded = excludedIds.includes(tile.id);
          return (
            <div key={tile.id} className={`relative ${excluded ? "opacity-40 grayscale" : ""}`}>
              <button
                type="button"
                className={tileButtonClass}
                style={{ background: tint }}
                aria-label={`Рухи каси ${tile.title}`}
                aria-pressed={!excluded}
                title={excluded ? "Показати рухи каси" : "Сховати рухи каси"}
                onClick={() => toggleTile(tile.id)}
              >
                {face}
              </button>
              <button
                type="button"
                className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center text-[15px] font-semibold leading-none text-gray-700 rounded-md border border-slate-300/80 shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition hover:brightness-95 active:scale-95"
                style={{ background: countButtonTint(tile) }}
                aria-label={`Касовка ${tile.title}`}
                title="Касовка"
                onClick={() => setCountTile(tile)}
              >
                {tile.currency === "USD" ? "$" : tile.currency === "EUR" ? "€" : "₴"}
              </button>
            </div>
          );
        })}
        {/* Плитка «Завдатки»: залишки клієнтів на «Рахунки клієнта» (знімок Altegio) */}
        <div className={tileFaceClass} style={{ background: "#fde68a" }} title={deposits ? `Клієнтів із залишком: ${deposits.clients}` : undefined}>
          <span className="text-[10px] font-medium text-amber-950 leading-tight">Завдатки</span>
          <span className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">{deposits ? `${money(deposits.total)} грн` : "…"}</span>
          {deposits?.snapshotAt ? (
            <span className="text-[10px] text-gray-600">
              знімок{" "}
              {new Date(deposits.snapshotAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : null}
        </div>
        {/* Плитка «+ Рахунок»: картка доходу, розходу чи переміщення */}
        <button
          type="button"
          className={tileButtonClass}
          style={{ background: "#e3edf9" }}
          onClick={() => setDocumentType("expense")}
        >
          <span className="text-sm font-semibold text-gray-800">+ Рахунок</span>
        </button>
      </div>
      {/* Каса разом із ФОП — одна таблиця по днях з однією сумою дня; лише ФОП-и — кожен своєю таблицею */}
      {tiles.length > 0 && selectedCashTitles.length === 0 && selectedBankTiles.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-500">Усі рахунки вимкнено — натисніть плитку, щоб показати її рухи.</p>
      ) : null}
      {selectedCashTitles.length > 0 ? (
        <CashLedgerPanel
          reloadToken={ledgerReload}
          onCountsChanged={() => void load()}
          accountTitles={selectedCashTitles}
          bankAccounts={selectedBankTiles.map((tile) => ({ id: tile.id, title: tile.title }))}
        />
      ) : null}
      {selectedCashTitles.length === 0 && selectedBankTiles.map((tile) => (
        <BankAccountPanel
          key={tile.id}
          accountId={tile.id}
          accountTitle={tile.title}
          reloadToken={ledgerReload}
        />
      ))}
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
