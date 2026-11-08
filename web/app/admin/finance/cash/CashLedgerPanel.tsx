"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
import { DOCUMENT_KIND_LABEL, kyivDayOf, transferTitle, type StatementRow, type UnlinkedDocument } from "./BankAccountPanel";

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
  /** Запис у журналі Креско (за номером запису Altegio) — для посилання з колонки «Запис» */
  appointmentId?: string | null;
  /** Переміщення: з якого рахунку на який */
  transferFrom?: string | null;
  transferTo?: string | null;
};

/** Безготівковий рахунок (ФОП), обраний разом із касою: його рухи в тій самій таблиці по днях */
type BankAccountRef = { id: number; title: string };

type BankStatement = { accountId: number; title: string; rows: StatementRow[]; unlinked: UnlinkedDocument[] };

/** Рядок дня: готівка, банківський платіж ФОП або документ ФОП без платежу */
type DayItem =
  | { kind: "cash"; key: string; at: string; row: LedgerRow }
  | { kind: "bank"; key: string; at: string; row: StatementRow; accountTitle: string }
  | { kind: "unlinked"; key: string; at: string; doc: UnlinkedDocument; accountTitle: string };

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

/** Сума дня: одна на валюту — готівка й ФОП разом; документи без платежу не гроші, не входять */
function dayNetLabel(items: DayItem[]): string {
  const byCurrency = new Map<string, number>();
  for (const item of items) {
    if (item.kind === "unlinked") continue;
    const currency = item.kind === "cash" ? item.row.currency : "UAH";
    const signed =
      item.kind === "cash" ? (item.row.direction === "out" ? -item.row.amount : item.row.amount) : item.row.amount;
    byCurrency.set(currency, (byCurrency.get(currency) || 0) + signed);
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
  bankAccounts = [],
}: {
  reloadToken?: number;
  /** Обрані разом із касою ФОП-и: їхні платежі в тій самій таблиці, одна сума дня */
  bankAccounts?: BankAccountRef[];
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
  const [bankStatements, setBankStatements] = useState<BankStatement[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  /** Банківські платежі з розгорнутими документами */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Обрані плитки кас; null — без фільтра (усі каси) */
  const tilesKey = accountTitles.join("|");
  const activeTitles = useMemo(() => (tilesKey ? new Set(tilesKey.split("|")) : null), [tilesKey]);

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

  const bankKey = bankAccounts.map((account) => `${account.id}:${account.title}`).join("|");
  useEffect(() => {
    let cancelled = false;
    const accounts: BankAccountRef[] = bankKey
      ? bankKey.split("|").map((part) => {
          const [id, ...title] = part.split(":");
          return { id: Number(id), title: title.join(":") };
        })
      : [];
    if (accounts.length === 0) {
      setBankStatements([]);
      return;
    }
    setBankLoading(true);
    void (async () => {
      try {
        const statements = await Promise.all(
          accounts.map(async (account) => {
            const res = await fetch(`/api/admin/finance/cash/account-statement?accountId=${account.id}`, {
              cache: "no-store",
              credentials: "include",
            });
            const json = await res.json();
            if (!res.ok || !json.ok) throw new Error(json.error || `Не вдалося завантажити рухи ${account.title}`);
            return {
              accountId: account.id,
              title: account.title,
              rows: (json.rows || []) as StatementRow[],
              unlinked: (json.unlinkedDocuments || []) as UnlinkedDocument[],
            };
          }),
        );
        if (!cancelled) setBankStatements(statements);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка рухів рахунку");
      } finally {
        if (!cancelled) setBankLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bankKey, reloadToken]);

  /** Залишок ФОП на кінець дня: останній відомий баланс банку на цей день або раніше (сума по всіх обраних ФОП) */
  const bankBalanceAt = useMemo(() => {
    const closings = bankStatements.map((statement) => {
      const byDay = new Map<string, number>();
      // Рядки новіші зверху: перший рядок дня з балансом — залишок на кінець дня
      for (const row of statement.rows) {
        const day = kyivDayOf(row.time);
        if (row.balance != null && !byDay.has(day)) byDay.set(day, row.balance);
      }
      return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    });
    return (kyivDay: string): number | null => {
      if (closings.length === 0) return null;
      let total = 0;
      for (const days of closings) {
        let last: number | null = null;
        for (const [day, balance] of days) {
          if (day > kyivDay) break;
          last = balance;
        }
        if (last == null) return null;
        total += last;
      }
      return total;
    };
  }, [bankStatements]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
    const bankItems: DayItem[] = bankStatements.flatMap((statement) => [
      ...statement.rows.map(
        (row): DayItem => ({ kind: "bank", key: `bank:${statement.accountId}:${row.id}`, at: row.time, row, accountTitle: statement.title }),
      ),
      ...statement.unlinked.map(
        (doc): DayItem => ({ kind: "unlinked", key: `unlinked:${statement.accountId}:${doc.id}`, at: doc.time, doc, accountTitle: statement.title }),
      ),
    ]);
    const itemDay = (item: DayItem) =>
      item.kind === "cash" ? item.row.kyivDay : item.kind === "bank" ? kyivDayOf(item.row.time) : item.doc.kyivDay;
    const allDays = new Set([...visibleRows.map((row) => row.kyivDay), ...bankItems.map(itemDay)]);
    return [...allDays]
      .sort((a, b) => b.localeCompare(a))
      .map((kyivDay) => {
        // Залишок на кінець дня = старт + рухи від дня старту, як на плитках; з ФОП — плюс залишок банку
        const bankBalance = bankStatements.length > 0 ? bankBalanceAt(kyivDay) : null;
        const balances: string[] = [];
        if (kyivDay >= CASH_RECONCILE_FROM_KYIV_DAY) {
          const shown = bankBalance != null && !currencies.includes("UAH") ? ["UAH" as const, ...currencies] : currencies;
          for (const currency of shown) {
            const net = visibleRows
              .filter(
                (row) =>
                  row.currency === currency &&
                  row.kyivDay >= CASH_RECONCILE_FROM_KYIV_DAY &&
                  row.kyivDay <= kyivDay,
              )
              .reduce((sum, row) => sum + (row.direction === "out" ? -row.amount : row.amount), 0);
            const cash = currencies.includes(currency) ? openingOf(currency) + net : 0;
            const total = currency === "UAH" && bankBalance != null ? cash + bankBalance : cash;
            balances.push(`${money(total)} ${unitOf(currency)}`);
          }
        }
        const items: DayItem[] = [
          ...aggregateCashLedgerDayRows(visibleRows.filter((row) => row.kyivDay === kyivDay)).map(
            // Кілька платежів клієнта з різним часом — без часу; для порядку беремо полудень дня
            (row): DayItem => ({ kind: "cash", key: `cash:${row.id}`, at: row.occurredAt || `${row.kyivDay}T10:00:00.000Z`, row }),
          ),
          ...bankItems.filter((item) => itemDay(item) === kyivDay),
        ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        const unlinked = items.filter((item) => item.kind === "unlinked");
        return {
          kyivDay,
          balances,
          items,
          unlinkedCount: unlinked.length,
          unlinkedSum: unlinked.reduce((sum, item) => sum + (item.kind === "unlinked" ? item.doc.amount : 0), 0),
        };
      });
  }, [rows, activeTitles, currencies, bankStatements, bankBalanceAt]);

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

  if ((loading && rows.length === 0) || (bankLoading && bankStatements.length === 0)) {
    return <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження готівки…</p>;
  }
  if (error) {
    return <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>;
  }
  return (
    <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        {days.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-500 shadow-sm">
            <p>{bankAccounts.length > 0 ? "Платежів немає." : "Готівкових платежів немає."}</p>
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
                <col style={{ width: "8%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "13%" }} />
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
                    {day.unlinkedCount > 0 ? (
                      <span className="ml-3 font-medium normal-case tracking-normal text-amber-800">
                        ⚠ {day.unlinkedCount} {day.unlinkedCount === 1 ? "документ" : "документи"} без платежу ·{" "}
                        {money(Math.abs(day.unlinkedSum))} грн
                      </span>
                    ) : null}
                  </th>
                  {/* Сума дня займає вільні колонки праворуч і не переноситься */}
                  <th
                    colSpan={3}
                    className="whitespace-nowrap px-2 py-1 text-right font-bold normal-case tracking-normal tabular-nums"
                  >
                    {dayNetLabel(day.items)}
                  </th>
                </tr>
                <tr className="bg-gray-50 text-[9px] uppercase text-gray-500">
                  <th className="px-2 py-1 font-medium">№</th>
                  <th className="px-2 py-1 font-medium">Час</th>
                  <th className="px-1 py-1 text-center font-medium" title="Чи була касовка після платежу">Зв.</th>
                  <th className="px-2 py-1 font-medium">Тип</th>
                  <th className="px-2 py-1 font-medium">Клієнт</th>
                  <th className="px-2 py-1 font-medium">Призначення</th>
                  <th className="px-2 py-1 font-medium">Запис</th>
                  <th className="px-2 py-1 font-medium">Рахунок</th>
                  <th className="px-2 py-1 text-right font-medium">Сума</th>
                </tr>
              </thead>
              <tbody>
                {day.items.map((item, index) => {
                  if (item.kind === "unlinked") {
                    // Документ ФОП без платежу: не гроші на рахунку — порожнє коло й сіра сума
                    const doc = item.doc;
                    return (
                      <tr key={item.key} className="border-t border-dashed border-gray-200 text-gray-500">
                        <td className="px-2 py-1 tabular-nums">{index + 1}</td>
                        <td className="whitespace-nowrap px-2 py-1 tabular-nums">{timeLabel(doc.time)}</td>
                        <td className="px-1 py-1 text-center">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full border border-gray-400"
                            title="Документ без банківського платежу"
                          />
                        </td>
                        <td />
                        <td className="truncate px-2 py-1 italic">Документ Креско</td>
                        <td className="truncate px-2 py-1" title={doc.comment ? `${doc.title}\n${doc.comment}` : doc.title}>
                          {doc.title} · <span className="italic">без платежу</span>
                        </td>
                        <td className="px-2 py-1">—</td>
                        <td className="truncate px-2 py-1" title={item.accountTitle}>{item.accountTitle}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right italic tabular-nums">{money(doc.amount)} грн</td>
                      </tr>
                    );
                  }
                  if (item.kind === "bank") {
                    const row = item.row;
                    const incoming = row.amount >= 0;
                    const open = expanded.has(item.key);
                    const canExpand = row.documents.length > 0 || Boolean(row.groupNote) || row.status !== "none";
                    return (
                      <Fragment key={item.key}>
                        <tr className="border-t border-gray-100">
                          <td className="px-2 py-1 tabular-nums text-gray-500">{index + 1}</td>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">{timeLabel(row.time)}</td>
                          <td className="px-1 py-1 text-center">
                            <ReconciledDot
                              status={row.status}
                              doneTitle="Зведено повністю"
                              partialTitle="Зведено частково"
                              openTitle="Не зведено"
                              expanded={open}
                              onClick={canExpand ? () => toggle(item.key) : undefined}
                            />
                          </td>
                          <td className={`px-2 py-1 font-semibold ${incoming ? "text-green-700" : "text-red-600"}`}>
                            {incoming ? "↓" : "↑"}
                          </td>
                          {/* Колонка «Клієнт»: контрагент вихідного платежу (власниця ФОП, постачальник) — не клієнт */}
                          <td className="truncate px-2 py-1 text-gray-800" title={incoming ? row.counterName || undefined : undefined}>
                            {(incoming && row.counterName) || "—"}
                          </td>
                          <td
                            className="truncate px-2 py-1 text-left text-gray-700"
                            title={row.bankTitle && row.bankTitle !== row.title ? `${row.title}\nБанк: ${row.bankTitle}` : row.title || undefined}
                          >
                            {transferTitle(row.title, row, incoming, item.accountTitle) ?? (row.title || "—")}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">—</td>
                          <td className="truncate px-2 py-1 text-gray-700" title={item.accountTitle}>{item.accountTitle}</td>
                          <td
                            className={`whitespace-nowrap px-2 py-1 text-right font-semibold tabular-nums ${
                              incoming ? "text-gray-900" : "text-red-600"
                            }`}
                          >
                            {money(row.amount)} грн
                          </td>
                        </tr>
                        {open ? (
                          <>
                            {row.documents.map((doc) => (
                              <tr key={doc.id} className="bg-slate-50/70 text-gray-600">
                                <td />
                                <td className="whitespace-nowrap px-2 py-0.5 tabular-nums">{dayLabel(doc.kyivDay).slice(0, 5)}</td>
                                <td className="px-1 py-0.5 text-center text-gray-400">↳</td>
                                <td />
                                <td className="truncate px-2 py-0.5 italic" title={DOCUMENT_KIND_LABEL[doc.kind]}>
                                  {DOCUMENT_KIND_LABEL[doc.kind]}
                                </td>
                                <td className="truncate px-2 py-0.5" title={doc.title}>
                                  {doc.title}
                                </td>
                                <td colSpan={2} />
                                <td className="whitespace-nowrap px-2 py-0.5 text-right tabular-nums">{money(doc.amount)} грн</td>
                              </tr>
                            ))}
                            {row.groupNote || row.documents.length === 0 ? (
                              <tr className="bg-slate-50/70 text-gray-500">
                                <td />
                                <td />
                                <td className="px-1 py-0.5 text-center text-gray-400">↳</td>
                                <td colSpan={6} className="px-2 py-0.5 italic">
                                  {row.groupNote || "Документів немає"}
                                </td>
                              </tr>
                            ) : null}
                            {row.status === "partial" ? (
                              <tr className="bg-amber-50 text-amber-900">
                                <td />
                                <td />
                                <td colSpan={6} className="px-2 py-0.5 font-medium">
                                  Не вистачає документів
                                </td>
                                <td className="whitespace-nowrap px-2 py-0.5 text-right font-semibold tabular-nums">
                                  {money(row.missing)} грн
                                </td>
                              </tr>
                            ) : null}
                          </>
                        ) : null}
                      </Fragment>
                    );
                  }
                  const row = item.row;
                  const unit = cashCountUnit(row.currency);
                  const incoming = row.direction === "in";
                  const signed = incoming ? row.amount : -row.amount;
                  return (
                    <tr key={item.key} className="border-t border-gray-100">
                      <td className="px-2 py-1 tabular-nums text-gray-500">{index + 1}</td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">
                        {rowTimeLabel(row) || "—"}
                      </td>
                      <td className="px-1 py-1 text-center">
                        <ReconciledDot
                          done={new Date(row.occurredAt).getTime() <= (lastCountAt.get(row.accountTitle) ?? 0)}
                          doneTitle="Після платежу була касовка"
                          openTitle="Після платежу касовки ще не було"
                        />
                      </td>
                      <td className={`px-2 py-1 font-semibold ${incoming ? "text-green-700" : "text-red-600"}`}>
                        {incoming ? "↓" : "↑"}
                      </td>
                      <td className="break-words px-2 py-1 text-gray-800">{row.clientName || "—"}</td>
                      {/* Довгий опис не роздуває рядок: один рядок, повний текст — при наведенні */}
                      <td className="truncate px-2 py-1 text-left text-gray-700" title={row.title || undefined}>
                        {transferTitle(row.title, row, incoming, row.accountTitle) ?? row.title}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">
                        {row.recordId && row.appointmentId ? (
                          <a
                            href={`/admin/journal?day=${row.kyivDay}&appointment=${row.appointmentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                            title="Відкрити запис у журналі"
                          >
                            {row.recordId}
                          </a>
                        ) : row.recordId ? (
                          row.recordId
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="truncate px-2 py-1 text-gray-700" title={row.accountTitle}>{row.accountTitle}</td>
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
