"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ReconciledDot, type ReconcileStatus } from "./ReconciledDot";

type LinkedDocument = {
  id: string;
  kind: "kresco" | "altegio" | "fee" | "visit" | "payment" | "deposit";
  title: string;
  amount: number;
  kyivDay: string;
};

type StatementRow = {
  id: string;
  time: string;
  amount: number;
  balance: number | null;
  counterName: string;
  title: string;
  /** Опис із банку — у підказці, якщо призначення обрав адмін */
  bankTitle?: string;
  status: ReconcileStatus;
  /** Скільки не вистачає документів до суми платежу (часткове зведення) */
  missing: number;
  documents: LinkedDocument[];
  /** Вхідні одного дня зведені разом — пояснення під рядком */
  groupNote?: string;
};

/** Документ Креско на рахунку без банківського платежу */
type UnlinkedDocument = {
  id: string;
  time: string;
  kyivDay: string;
  amount: number;
  title: string;
  comment: string;
};

const DOCUMENT_KIND_LABEL: Record<LinkedDocument["kind"], string> = {
  kresco: "Документ Креско",
  altegio: "Операція Altegio",
  fee: "Документ комісії",
  visit: "Оплата візиту",
  payment: "Оплата (копія Altegio)",
  deposit: "Завдаток",
};

function money(n: number): string {
  return n.toLocaleString("uk-UA", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function kyivDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  return `${day}.${month}.${year}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Рухи безготівкового рахунку з банку: той самий вигляд, що й готівка в Касі. */
export function BankAccountPanel({
  accountId,
  accountTitle,
  reloadToken,
}: {
  accountId: number;
  accountTitle: string;
  reloadToken: number;
}) {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedDocument[]>([]);
  /** Платежі з розгорнутими документами */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/finance/cash/account-statement?accountId=${accountId}`, {
          cache: "no-store",
          credentials: "include",
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити рухи рахунку");
        if (!cancelled) {
          setRows(json.rows || []);
          setUnlinked(json.unlinkedDocuments || []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка завантаження рухів");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadToken]);

  const days = useMemo(() => {
    const byDay = new Map<string, { rows: StatementRow[]; unlinked: UnlinkedDocument[] }>();
    const slot = (kyivDay: string) => {
      if (!byDay.has(kyivDay)) byDay.set(kyivDay, { rows: [], unlinked: [] });
      return byDay.get(kyivDay)!;
    };
    for (const row of rows) slot(kyivDayOf(row.time)).rows.push(row);
    for (const doc of unlinked) slot(doc.kyivDay).unlinked.push(doc);
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([kyivDay, day]) => ({
        kyivDay,
        rows: day.rows,
        unlinked: day.unlinked,
        unlinkedSum: day.unlinked.reduce((sum, doc) => sum + doc.amount, 0),
        net: day.rows.reduce((sum, row) => sum + row.amount, 0),
        // Рядки новіші зверху: перший із балансом — залишок на кінець дня
        balance: day.rows.find((row) => row.balance != null)?.balance ?? null,
      }));
  }, [rows, unlinked]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    // Ширина як у таблиці готівки: ліва колонка 2/3 (сітка 2fr/1fr з проміжком 0.5rem)
    <div className="space-y-2 md:w-[calc((100%-0.5rem)*2/3)]" aria-label={`Рухи рахунку ${accountTitle}`}>
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
      ) : loading && rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження рухів…</p>
      ) : days.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-500">Рухів немає.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {days.map((day) => (
            <section key={day.kyivDay} className="border-t border-gray-200 first:border-t-0">
              <table className="w-full table-fixed text-left text-[10px]">
                <colgroup>
                  <col style={{ width: "4%" }} />
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "27%" }} />
                  <col style={{ width: "38%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "4%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-300 text-[10px] text-gray-900">
                    <th colSpan={5} className="px-2 py-1 text-left font-bold uppercase tracking-wide">
                      {dayLabel(day.kyivDay)}
                      {day.balance != null ? (
                        <span className="ml-3 font-medium normal-case tracking-normal tabular-nums">
                          залишок: {money(day.balance)} грн
                        </span>
                      ) : null}
                      {day.unlinked.length > 0 ? (
                        <span className="ml-3 font-medium normal-case tracking-normal text-amber-800">
                          ⚠ {day.unlinked.length} {day.unlinked.length === 1 ? "документ" : "документи"} без платежу ·{" "}
                          {money(Math.abs(day.unlinkedSum))} грн
                        </span>
                      ) : null}
                    </th>
                    <th
                      colSpan={2}
                      className="whitespace-nowrap px-2 py-1 text-right font-bold normal-case tracking-normal tabular-nums"
                    >
                      {money(day.net)} грн
                    </th>
                  </tr>
                  <tr className="bg-gray-50 text-[9px] uppercase text-gray-500">
                    <th className="px-2 py-1 font-medium">№</th>
                    <th className="px-1 py-1 text-center font-medium" title="Зведено з документами">Зв.</th>
                    <th className="px-2 py-1 font-medium">Контрагент</th>
                    <th className="px-2 py-1 font-medium">Призначення</th>
                    <th className="px-2 py-1 font-medium">Час</th>
                    <th className="px-2 py-1 font-medium">Тип</th>
                    <th className="px-2 py-1 text-right font-medium">Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {day.rows.map((row, index) => {
                    const incoming = row.amount >= 0;
                    const open = expanded.has(row.id);
                    const canExpand = row.documents.length > 0 || Boolean(row.groupNote) || row.status !== "none";
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-t border-gray-100">
                          <td className="px-2 py-1 tabular-nums text-gray-500">{index + 1}</td>
                          <td className="px-1 py-1 text-center">
                            <ReconciledDot
                              status={row.status}
                              doneTitle="Зведено повністю"
                              partialTitle="Зведено частково"
                              openTitle="Не зведено"
                              expanded={open}
                              onClick={canExpand ? () => toggle(row.id) : undefined}
                            />
                          </td>
                          <td className="truncate px-2 py-1 text-gray-800" title={row.counterName || undefined}>
                            {row.counterName || "—"}
                          </td>
                          <td
                            className="truncate px-2 py-1 text-gray-700"
                            title={
                              row.bankTitle && row.bankTitle !== row.title
                                ? `${row.title}\nБанк: ${row.bankTitle}`
                                : row.title || undefined
                            }
                          >
                            {row.title || "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">{timeLabel(row.time)}</td>
                          <td className={`px-2 py-1 font-semibold ${incoming ? "text-green-700" : "text-red-600"}`}>
                            {incoming ? "↓" : "↑"}
                          </td>
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
                                <td className="px-1 py-0.5 text-center text-gray-400">↳</td>
                                <td className="truncate px-2 py-0.5 italic" title={DOCUMENT_KIND_LABEL[doc.kind]}>
                                  {DOCUMENT_KIND_LABEL[doc.kind]}
                                </td>
                                <td className="truncate px-2 py-0.5" title={doc.title}>
                                  {doc.title}
                                </td>
                                <td className="whitespace-nowrap px-2 py-0.5 tabular-nums">{dayLabel(doc.kyivDay).slice(0, 5)}</td>
                                <td />
                                <td className="whitespace-nowrap px-2 py-0.5 text-right tabular-nums">{money(doc.amount)} грн</td>
                              </tr>
                            ))}
                            {row.groupNote || row.documents.length === 0 ? (
                              <tr className="bg-slate-50/70 text-gray-500">
                                <td />
                                <td className="px-1 py-0.5 text-center text-gray-400">↳</td>
                                <td colSpan={5} className="px-2 py-0.5 italic">
                                  {row.groupNote || "Документів немає"}
                                </td>
                              </tr>
                            ) : null}
                            {row.status === "partial" ? (
                              <tr className="bg-amber-50 text-amber-900">
                                <td />
                                <td />
                                <td colSpan={4} className="px-2 py-0.5 font-medium">
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
                  })}
                  {/* Документи без платежу: не гроші на рахунку, а лише документи — порожнє коло й сіра сума */}
                  {day.unlinked.map((doc) => (
                    <tr key={doc.id} className="border-t border-dashed border-gray-200 text-gray-500">
                      <td />
                      <td className="px-1 py-1 text-center">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full border border-gray-400"
                          title="Документ без банківського платежу"
                        />
                      </td>
                      <td className="truncate px-2 py-1 italic">Документ Креско</td>
                      <td className="truncate px-2 py-1" title={doc.comment ? `${doc.title}\n${doc.comment}` : doc.title}>
                        {doc.title} · <span className="italic">без платежу</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums">{timeLabel(doc.time)}</td>
                      <td />
                      <td className="whitespace-nowrap px-2 py-1 text-right italic tabular-nums">{money(doc.amount)} грн</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
