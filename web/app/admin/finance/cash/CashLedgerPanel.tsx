"use client";

import { useEffect, useMemo, useState } from "react";
import { cashCountUnit, type CashCountCurrency } from "@/lib/finance/cash-denominations";
import {
  CASH_OPENING_EUR,
  CASH_OPENING_KYIV_DAY,
  CASH_OPENING_UAH,
  CASH_OPENING_USD,
  CASH_RECONCILE_FROM_KYIV_DAY,
} from "@/lib/finance/cash-openings";
import { aggregateCashLedgerDayRows } from "@/lib/finance/cash-ledger-aggregate";
import { ReconciledDot } from "./ReconciledDot";

type SavedCount = {
  id: string;
  kyivDay: string;
  savedAt: string;
  authorName: string;
  accountTitle: string;
  currency: string;
  counted: number;
  expected: number | null;
  variance: number | null;
};

type LedgerRow = {
  id: string;
  accountTitle: string;
  currency: CashCountCurrency;
  direction: "in" | "out";
  amount: number;
  kyivDay: string;
  occurredAt: string;
  title: string;
  clientName: string;
  recordId: number | null;
  posted: boolean;
  /** Сума валюти за курсом дня (у коментарі Altegio її не було) */
  fxRate?: number | null;
};

const CASH_CURRENCIES: CashCountCurrency[] = ["UAH", "USD", "EUR"];

function openingOf(currency: CashCountCurrency): number {
  if (currency === "USD") return CASH_OPENING_USD ?? 0;
  if (currency === "EUR") return CASH_OPENING_EUR ?? 0;
  return CASH_OPENING_UAH ?? 0;
}

function unitOf(currency: string): string {
  return cashCountUnit(currency === "USD" || currency === "EUR" ? currency : "UAH");
}

function money(n: number): string {
  return n.toLocaleString("uk-UA", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function dayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  if (!day || !month || !year) return kyivDay;
  return `${day}.${month}.${year}`;
}

function dayNetLabel(rows: LedgerRow[]): string {
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    const signed = row.direction === "out" ? -row.amount : row.amount;
    byCurrency.set(row.currency, (byCurrency.get(row.currency) || 0) + signed);
  }
  return [...byCurrency.entries()].map(([currency, sum]) => `${money(sum)} ${unitOf(currency)}`).join(" · ");
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
}

/** У переміщень час Altegio менший за банківський, тому показуємо час банку з опису. */
function rowTimeLabel(row: LedgerRow): string {
  const bankTime = row.title.match(/Дата банківського платежу:[^\n]*?(\d{2}:\d{2})/)?.[1];
  return bankTime || timeLabel(row.occurredAt);
}

export function CashLedgerPanel({
  reloadToken = 0,
  onCountsChanged,
  accountTitles = [],
}: {
  reloadToken?: number;
  /** Обрані плитки кас: показуємо лише їхні рухи; порожньо — фільтр зі списку або всі */
  accountTitles?: string[];
  /** Касовку видалено — плитки треба перечитати */
  onCountsChanged?: () => void;
}) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [counts, setCounts] = useState<SavedCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Фільтр по рахунку (назва каси Altegio); "" — усі рахунки */
  const [accountFilter, setAccountFilter] = useState("");
  /** Плитки мають перевагу над списком «Усі рахунки»; null — без фільтра */
  const tilesKey = accountTitles.join("|");
  const activeTitles = useMemo(() => {
    if (tilesKey) return new Set(tilesKey.split("|"));
    return accountFilter ? new Set([accountFilter]) : null;
  }, [tilesKey, accountFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [ledgerRes, countsRes] = await Promise.all([
          fetch("/api/admin/finance/cash/ledger", { cache: "no-store", credentials: "include" }),
          fetch("/api/admin/finance/kasa?limit=300", { cache: "no-store", credentials: "include" }),
        ]);
        const [ledgerJson, countsJson] = await Promise.all([ledgerRes.json(), countsRes.json()]);
        if (!ledgerRes.ok || !ledgerJson.ok) throw new Error(ledgerJson.error || "Не вдалося завантажити готівку");
        if (!countsRes.ok || !countsJson.ok) throw new Error(countsJson.error || "Не вдалося завантажити касовки");
        if (cancelled) return;
        setRows(ledgerJson.rows || []);
        setCounts(countsJson.counts || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка готівки");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const accountOptions = useMemo(
    () =>
      [...new Set([...rows.map((row) => row.accountTitle), ...counts.map((count) => count.accountTitle)].filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "uk"),
      ),
    [rows, counts],
  );

  /** Валюти, для яких показуємо залишок: усі або валюта вибраного рахунку */
  const currencies = useMemo(() => {
    if (!activeTitles) return CASH_CURRENCIES;
    const own = new Set<string>();
    for (const row of rows) if (activeTitles.has(row.accountTitle)) own.add(row.currency);
    for (const count of counts) if (activeTitles.has(count.accountTitle)) own.add(count.currency);
    return CASH_CURRENCIES.filter((currency) => own.has(currency));
  }, [rows, counts, activeTitles]);

  const days = useMemo(() => {
    const visibleRows = rows.filter((row) => !activeTitles || activeTitles.has(row.accountTitle));
    return [...new Set(visibleRows.map((row) => row.kyivDay))]
      .sort((a, b) => b.localeCompare(a))
      .map((kyivDay) => {
        // Залишок на кінець дня = старт + рухи від дня старту, як на плитках
        const balances =
          kyivDay >= CASH_RECONCILE_FROM_KYIV_DAY
            ? currencies.map((currency) => {
                const net = visibleRows
                  .filter(
                    (row) =>
                      row.currency === currency &&
                      row.kyivDay >= CASH_RECONCILE_FROM_KYIV_DAY &&
                      row.kyivDay <= kyivDay,
                  )
                  .reduce((sum, row) => sum + (row.direction === "out" ? -row.amount : row.amount), 0);
                return `${money(openingOf(currency) + net)} ${unitOf(currency)}`;
              })
            : [];
        return {
          kyivDay,
          balances,
          rows: aggregateCashLedgerDayRows(visibleRows.filter((row) => row.kyivDay === kyivDay)),
        };
      });
  }, [rows, activeTitles, currencies]);

  /** Час останньої касовки по кожній касі: платіж до неї — «зведений» */
  const lastCountAt = useMemo(() => {
    const map = new Map<string, number>();
    for (const count of counts) {
      const at = new Date(count.savedAt).getTime();
      if (at > (map.get(count.accountTitle) ?? 0)) map.set(count.accountTitle, at);
    }
    return map;
  }, [counts]);

  const visibleCounts = useMemo(
    () => counts.filter((count) => !activeTitles || activeTitles.has(count.accountTitle)),
    [counts, activeTitles],
  );

  async function removeCount(count: SavedCount) {
    const label = `${count.accountTitle} на ${money(count.counted)} ${unitOf(count.currency)} від ${dayLabel(count.kyivDay)} ${timeLabel(count.savedAt)}`;
    if (!window.confirm(`Видалити касовку ${label}?`)) return;
    setDeletingId(count.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/kasa?id=${encodeURIComponent(count.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(typeof json?.error === "string" ? json.error : "Не вдалося видалити касовку");
      }
      setCounts((prev) => prev.filter((item) => item.id !== count.id));
      onCountsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading && rows.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження готівки…</p>;
  }
  if (error) {
    return <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>;
  }
  const accountSelect = (
    <select
      value={accountFilter}
      onChange={(e) => setAccountFilter(e.target.value)}
      className="max-w-full rounded border border-gray-400 bg-white px-1 py-0 text-[10px] font-medium normal-case text-gray-900"
      title="Фільтр по рахунку"
    >
      <option value="">Усі рахунки</option>
      {accountOptions.map((title) => (
        <option key={title} value={title}>
          {title}
        </option>
      ))}
    </select>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        {days.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-500 shadow-sm">
            <p>Готівкових платежів немає.</p>
            {accountFilter ? <div className="mt-2 inline-block">{accountSelect}</div> : null}
          </div>
        ) : (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {days.map((day, dayIndex) => (
        <section key={day.kyivDay} className="border-t border-gray-200 first:border-t-0">
          {/* Старт каси: рухи нижче цієї смуги вже всередині початкового залишку */}
          {day.kyivDay < CASH_RECONCILE_FROM_KYIV_DAY &&
          (dayIndex === 0 || days[dayIndex - 1].kyivDay >= CASH_RECONCILE_FROM_KYIV_DAY) ? (
            <div className="flex flex-wrap items-center gap-x-2 border-b border-amber-200 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-950">
              <span>Старт каси: кінець дня {dayLabel(CASH_OPENING_KYIV_DAY)}</span>
              <span className="tabular-nums">
                {currencies.map((currency) => `${money(openingOf(currency))} ${unitOf(currency)}`).join(" · ")}
              </span>
              <span className="font-normal">Рухи нижче в баланс не входять</span>
            </div>
          ) : null}
            {/* table-fixed + однакові ширини: колонки всіх днів стоять одна під одною */}
            <table className="w-full table-fixed text-left text-[10px]">
              <colgroup>
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "17%" }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-300 text-[10px] text-gray-900">
                  <th colSpan={6} className="px-2 py-1 text-left font-bold uppercase tracking-wide">
                    {dayLabel(day.kyivDay)}
                    {day.balances.length > 0 ? (
                      <span className="ml-3 font-medium normal-case tracking-normal tabular-nums">
                        залишок: {day.balances.join(" · ")}
                      </span>
                    ) : null}
                  </th>
                  {/* Фільтр по рахунку — над колонкою «Рахунок», лише в першому дні */}
                  {dayIndex === 0 ? (
                    <th className="px-1 py-0.5 text-left font-normal">{accountSelect}</th>
                  ) : null}
                  {/* Сума дня займає вільні колонки праворуч і не переноситься */}
                  <th
                    colSpan={dayIndex === 0 ? 2 : 3}
                    className="whitespace-nowrap px-2 py-1 text-right font-bold normal-case tracking-normal tabular-nums"
                  >
                    {dayNetLabel(day.rows)}
                  </th>
                </tr>
                <tr className="bg-gray-50 text-[9px] uppercase text-gray-500">
                  <th className="px-2 py-1 font-medium">№</th>
                  <th className="px-1 py-1 text-center font-medium" title="Чи була касовка після платежу">Зв.</th>
                  <th className="px-2 py-1 font-medium">Клієнт</th>
                  <th className="px-2 py-1 font-medium">Призначення</th>
                  <th className="px-2 py-1 font-medium">Час</th>
                  <th className="px-2 py-1 font-medium">Запис</th>
                  <th className="px-2 py-1 font-medium">Рахунок</th>
                  <th className="px-2 py-1 font-medium">Тип</th>
                  <th className="px-2 py-1 text-right font-medium">Сума</th>
                </tr>
              </thead>
              <tbody>
                {day.rows.map((row, index) => {
                  const unit = cashCountUnit(row.currency);
                  const incoming = row.direction === "in";
                  const signed = incoming ? row.amount : -row.amount;
                  return (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="px-2 py-1 tabular-nums text-gray-500">{index + 1}</td>
                      <td className="px-1 py-1 text-center">
                        <ReconciledDot
                          done={new Date(row.occurredAt).getTime() <= (lastCountAt.get(row.accountTitle) ?? 0)}
                          doneTitle="Після платежу була касовка"
                          openTitle="Після платежу касовки ще не було"
                        />
                      </td>
                      <td className="break-words px-2 py-1 text-gray-800">{row.clientName || "—"}</td>
                      {/* Довгий опис не роздуває рядок: один рядок, повний текст — при наведенні */}
                      <td className="truncate px-2 py-1 text-left text-gray-700" title={row.title || undefined}>{row.title}</td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">
                        {rowTimeLabel(row) || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">
                        {row.recordId ? row.recordId : "—"}
                      </td>
                      <td className="truncate px-2 py-1 text-gray-700" title={row.accountTitle}>{row.accountTitle}</td>
                      <td className={`px-2 py-1 font-semibold ${incoming ? "text-green-700" : "text-red-600"}`}>
                        {incoming ? "↓" : "↑"}
                      </td>
                      <td
                        className={`whitespace-nowrap px-2 py-1 text-right font-semibold tabular-nums ${
                          incoming ? "text-gray-900" : "text-red-600"
                        }`}
                      >
                        {row.fxRate ? "≈ " : ""}
                        {money(signed)} {unit}
                        {row.fxRate ? (
                          <div
                            className="text-[9px] font-normal text-amber-700"
                            title="У коментарі Altegio немає суми у валюті — перераховано з гривні за робочим курсом дня платежу"
                          >
                            за курсом {money(row.fxRate)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </section>
      ))}
    </div>
        )}
      </div>
      {/* Касовки окремою колонкою: їхня висота не розтягує дні в таблиці */}
      <aside className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:sticky md:top-[calc(var(--admin-nav-h,0px)+var(--cash-sticky-top,0px)+0.5rem)]">
        <div className="bg-slate-300 px-2 py-1 text-[10px] font-semibold text-emerald-900">Касовки</div>
        <div className="max-h-[calc(100vh-var(--admin-nav-h,0px)-var(--cash-sticky-top,0px)-3rem)] overflow-y-auto">
          {visibleCounts.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-gray-400">Касовок немає</p>
          ) : (
            // Одна касовка — один рядок; «мало бути» — у підказці до різниці
            <table className="w-full table-fixed text-left text-[10px]">
              <colgroup>
                <col style={{ width: "24%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "21%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "6%" }} />
              </colgroup>
              <thead className="sticky top-0 bg-gray-50 text-[9px] uppercase text-gray-500">
                <tr>
                  <th className="px-2 py-1 font-medium">Дата</th>
                  <th className="px-1 py-1 font-medium">Каса</th>
                  <th className="px-1 py-1 text-right font-medium" title="Пораховано в касі">Факт</th>
                  <th className="px-1 py-1 text-right font-medium" title="Факт мінус «мало бути»">Різн.</th>
                  <th className="px-1 py-1 font-medium">Хто</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleCounts.map((count) => {
                  const unit = unitOf(count.currency);
                  // До старту каси «мало бути» рахувала стара схема — ці числа не порівнюємо
                  const current = count.kyivDay >= CASH_RECONCILE_FROM_KYIV_DAY;
                  const diff =
                    current && count.variance != null && Math.abs(count.variance) >= 0.01 ? count.variance : null;
                  const diffTitle =
                    current && count.expected != null
                      ? `Мало бути ${money(count.expected)} ${unit}${diff != null ? ` · ${diff < 0 ? "недостача" : "надлишок"}` : ""}`
                      : "Касовка до старту каси — не порівнюємо";
                  return (
                    <tr key={count.id} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-700">
                        {dayLabel(count.kyivDay).slice(0, 5)} {timeLabel(count.savedAt)}
                      </td>
                      <td className="truncate px-1 py-1 text-gray-700" title={count.accountTitle}>
                        {count.accountTitle}
                      </td>
                      <td className="whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums text-emerald-900">
                        {money(count.counted)} {unit}
                      </td>
                      <td
                        className={`whitespace-nowrap px-1 py-1 text-right font-semibold tabular-nums ${
                          diff == null ? "text-gray-400" : diff < 0 ? "text-red-600" : "text-amber-700"
                        }`}
                        title={diffTitle}
                      >
                        {diff == null ? "—" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`}
                      </td>
                      <td className="truncate px-1 py-1 text-gray-600" title={count.authorName || undefined}>
                        {count.authorName || "—"}
                      </td>
                      <td className="px-1 py-1 text-right">
                        <button
                          type="button"
                          className="text-[10px] text-gray-400 hover:text-red-600 disabled:opacity-50"
                          disabled={deletingId === count.id}
                          title="Видалити касовку"
                          onClick={() => void removeCount(count)}
                        >
                          {deletingId === count.id ? "…" : "🗑"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  );
}
