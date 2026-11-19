"use client";

// Вікно плитки «Постачальники»: розрахунки (борг / аванс) по кожному постачальнику з історією.
// Оплати — розходи «Закупівля товарів» у Касі та прийомці; тут вручну — лише інкасація власниці,
// поки вона в Altegio (запис зменшує борг, гроші з каси рухає сама інкасація).

import { useState } from "react";
import { kyivToday } from "@/lib/dashboard/period";
import type { SupplierDebtSummary, SupplierOpenPayment } from "@/lib/finance/supplier-debt";

function usd(n: number) {
  return `${n.toLocaleString("uk-UA", { maximumFractionDigits: 0 })} $`;
}

function amountText(amount: number, currency: string) {
  const sign = currency === "USD" ? "$" : currency === "EUR" ? "€" : "грн";
  return `${amount.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ${sign}`;
}

function dayText(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

const inputClass =
  "h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-gray-900 outline-none focus:border-slate-400";

export default function SupplierDebtModal({
  debt,
  onClose,
  onChanged,
}: {
  debt: SupplierDebtSummary;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [supplierName, setSupplierName] = useState(debt.suppliers[0]?.supplierName || "Власниця");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [kyivDay, setKyivDay] = useState(kyivToday());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePayment() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/cash/supplier-debt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierName, amount: Number(amount.replace(/\s/g, "").replace(",", ".")), currency, kyivDay, comment }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Помилка ${res.status}`);
      setAmount("");
      setComment("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося записати оплату");
    } finally {
      setBusy(false);
    }
  }

  async function assignSupplier(financeDocumentId: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/cash/supplier-debt", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financeDocumentId, supplierName: name }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Помилка ${res.status}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося вказати постачальника");
    } finally {
      setBusy(false);
    }
  }

  async function voidPayment(id: string) {
    if (!window.confirm("Скасувати цю оплату? Борг знову зросте на її суму.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/cash/supplier-debt?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Помилка ${res.status}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося скасувати оплату");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#f3f4f6] shadow-[0_12px_40px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Постачальники: борг {usd(debt.debtUsd)} · аванси {usd(debt.advanceUsd)}
            </div>
            <div className="text-xs text-gray-500">Прийомки мінус оплати «Закупівля товарів», від 19.11.2026</div>
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

        <div className="space-y-2 overflow-y-auto p-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5">
            <div className="mb-2 text-xs font-semibold text-gray-700">Оплата з інкасації (вручну)</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={`${inputClass} col-span-2`}
                placeholder="Постачальник"
                list="supplier-debt-names"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
              />
              <datalist id="supplier-debt-names">
                {debt.suppliers.map((row) => (
                  <option key={row.supplierName} value={row.supplierName} />
                ))}
              </datalist>
              <div className="flex gap-1">
                <input
                  className={`${inputClass} min-w-0 flex-1 tabular-nums`}
                  placeholder="Сума"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="USD">$</option>
                  <option value="UAH">грн</option>
                  <option value="EUR">€</option>
                </select>
              </div>
              <input className={inputClass} type="date" value={kyivDay} onChange={(e) => setKyivDay(e.target.value)} />
              <input
                className={`${inputClass} col-span-2`}
                placeholder="Коментар, напр. «з інкасації 18.11»"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
            {error ? <p className="mt-2 text-xs font-medium text-red-700">{error}</p> : null}
            <button
              type="button"
              className="mt-2 w-full rounded-xl bg-[#5c6a7c] py-2 text-sm font-semibold text-white transition hover:bg-[#526070] active:scale-[0.98] disabled:opacity-50"
              disabled={busy || !supplierName.trim() || !amount.trim()}
              onClick={() => void savePayment()}
            >
              Записати оплату
            </button>
            <p className="mt-1.5 text-[10px] leading-snug text-gray-500">
              Лише для інкасації власниці, поки вона в Altegio: запис зменшує борг, гроші списує сама інкасація. Інші оплати —
              розходом «Закупівля товарів» у Касі або в прийомці. Гривню й євро переводимо в $ за робочим курсом дня.
            </p>
          </div>

          {debt.unassignedPayments.length > 0 ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-2.5">
              <div className="text-xs font-semibold text-red-800">Оплати без постачальника — у розрахунки не потрапили</div>
              <ul className="mt-1.5 space-y-1.5">
                {debt.unassignedPayments.map((payment) => (
                  <UnassignedRow
                    key={payment.id}
                    payment={payment}
                    busy={busy}
                    onAssign={(name) => void assignSupplier(payment.id, name)}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {debt.suppliers.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-gray-500">
              Розрахунків ще немає. Вони з&apos;являться після проведення прийомки з постачальником або оплати «Закупівля товарів».
            </p>
          ) : (
            debt.suppliers.map((row) => (
              <div key={row.supplierName} className="rounded-2xl border border-slate-200/80 bg-white p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900">{row.supplierName}</span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      row.balanceUsd > 0 ? "text-red-700" : row.balanceUsd < 0 ? "text-emerald-700" : "text-gray-900"
                    }`}
                  >
                    {row.balanceUsd > 0 ? "борг " : row.balanceUsd < 0 ? "аванс " : ""}
                    {usd(Math.abs(row.balanceUsd))}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500">
                  прийнято {usd(row.purchasedUsd)} · оплачено {usd(row.paidUsd)}
                </div>
                <ul className="mt-2 divide-y divide-slate-100 text-xs">
                  {row.entries.map((entry) => (
                    <li key={`${entry.kind}-${entry.id}`} className="flex items-center justify-between gap-2 py-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="tabular-nums text-gray-500">{dayText(entry.kyivDay)}</span>
                        <span className="truncate text-gray-800">{entry.title}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        {entry.currency !== "USD" ? (
                          <span className="text-gray-400">{amountText(entry.amount, entry.currency)}</span>
                        ) : null}
                        <span className={entry.amountUsd > 0 ? "font-medium text-red-700" : "font-medium text-emerald-700"}>
                          {entry.amountUsd > 0 ? "+" : "−"}
                          {usd(Math.abs(entry.amountUsd))}
                        </span>
                        {entry.kind === "manual" ? (
                          <button
                            type="button"
                            className="text-gray-400 hover:text-red-600"
                            aria-label="Скасувати оплату"
                            title="Скасувати оплату"
                            disabled={busy}
                            onClick={() => void voidPayment(entry.id)}
                          >
                            ✕
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Оплата без постачальника: вписати, кому заплатили. */
function UnassignedRow({
  payment,
  busy,
  onAssign,
}: {
  payment: SupplierOpenPayment;
  busy: boolean;
  onAssign: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      <span className="tabular-nums text-gray-500">{dayText(payment.kyivDay)}</span>
      <span className="font-medium tabular-nums text-gray-900">{amountText(payment.amount, payment.currency)}</span>
      <span className="min-w-0 flex-1 truncate text-gray-600">
        {payment.accountTitle}
        {payment.comment ? ` · ${payment.comment}` : ""}
      </span>
      <input
        className={`${inputClass} h-7 w-36 text-xs`}
        placeholder="постачальник"
        list="supplier-debt-names"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="button"
        className="h-7 rounded-lg bg-[#5c6a7c] px-2 text-xs font-semibold text-white disabled:opacity-50"
        disabled={busy || !name.trim()}
        onClick={() => onAssign(name)}
      >
        Вказати
      </button>
    </li>
  );
}
