"use client";

// Постачальник і оплата прийомки: оплачено зараз (проведення створить розхід «Закупівля товарів»),
// передоплата (обрати вже зроблений розхід) або в борг.

import { useEffect, useState } from "react";
import type { IntakePaymentPlan, PaymentPlanMode, SupplierOpenPayment } from "@/lib/finance/supplier-debt";

type Account = { id: number; title: string };

export type IntakePaymentValue = {
  supplierName: string;
  plan: IntakePaymentPlan;
};

const MODES: Array<{ value: PaymentPlanMode; label: string }> = [
  { value: "now", label: "Оплачено зараз" },
  { value: "prepaid", label: "Передоплата" },
  { value: "credit", label: "У борг" },
];

export function accountCurrency(title: string): "UAH" | "USD" | "EUR" {
  if (/\$|долар|usd/i.test(title)) return "USD";
  if (/€|євро|eur/i.test(title)) return "EUR";
  return "UAH";
}

const SIGN: Record<string, string> = { UAH: "грн", USD: "$", EUR: "€" };

function dayText(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

export function IntakePaymentFields({
  value,
  onChange,
  total,
  totalCurrency,
  FieldRow,
  fieldClass,
}: {
  value: IntakePaymentValue;
  onChange: (next: IntakePaymentValue) => void;
  /** Накладна + доставка — підказка для суми оплати */
  total: number;
  totalCurrency: string;
  FieldRow: (props: { label: string; children: React.ReactNode }) => JSX.Element;
  fieldClass: string;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [openPayments, setOpenPayments] = useState<SupplierOpenPayment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { plan } = value;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/finance/documents?options=1&limit=1", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/admin/finance/cash/supplier-debt", { cache: "no-store" }).then((res) => res.json()),
    ])
      .then(([options, debt]) => {
        if (cancelled) return;
        if (!options?.ok || !debt?.ok) throw new Error(options?.error || debt?.error || "немає доступу до Каси");
        setAccounts((options.accounts || []).map((a: Account) => ({ id: a.id, title: a.title })));
        setOpenPayments(debt.openPayments || []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "не вдалося завантажити рахунки");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPlan = (patch: Partial<IntakePaymentPlan>) => onChange({ ...value, plan: { ...plan, ...patch } });
  const account = accounts.find((a) => a.id === plan.accountId);
  const payCurrency = account ? accountCurrency(account.title) : null;
  const selected = new Set(plan.financeDocumentIds || []);
  // Спершу оплати цього постачальника, далі без постачальника; чужі не показуємо
  const supplier = value.supplierName.trim().toLowerCase();
  const candidates = openPayments.filter(
    (p) => !p.supplierName || p.supplierName.toLowerCase() === supplier || selected.has(p.id),
  );

  return (
    <>
      <FieldRow label="Постачальник">
        <input
          className={`${fieldClass} max-w-[260px]`}
          placeholder="від кого товар"
          value={value.supplierName}
          onChange={(e) => onChange({ ...value, supplierName: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="Оплата">
        <div className="flex flex-wrap gap-1">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => setPlan({ mode: mode.value })}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                plan.mode === mode.value ? "border-slate-500 bg-slate-700 text-white" : "border-slate-200 bg-white text-gray-700 hover:bg-slate-50"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </FieldRow>
      {loadError && plan.mode !== "credit" ? (
        <p className="px-1 text-[11px] text-red-700">Рахунки й платежі не завантажились: {loadError}</p>
      ) : null}
      {plan.mode === "now" && (
        <>
          <FieldRow label="З рахунку">
            <select
              className={`${fieldClass} max-w-[260px]`}
              value={plan.accountId || ""}
              onChange={(e) => {
                const id = Number(e.target.value) || null;
                const next = accounts.find((a) => a.id === id);
                // Сума підставляється, коли валюта рахунку збігається з валютою прийомки
                const autoAmount = next && accountCurrency(next.title) === totalCurrency && total > 0 ? total : plan.amount;
                setPlan({ accountId: id, amount: autoAmount ?? null });
              }}
            >
              <option value="">— оберіть касу чи ФОП —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label={`Сума оплати${payCurrency ? `, ${SIGN[payCurrency]}` : ""}`}>
            <input
              className={`${fieldClass} max-w-[140px] tabular-nums`}
              inputMode="decimal"
              placeholder={total > 0 ? `${total} ${SIGN[totalCurrency] || totalCurrency}` : "сума"}
              value={plan.amount ?? ""}
              onChange={(e) => setPlan({ amount: Number(e.target.value.replace(",", ".")) || null })}
            />
            <span className="text-[11px] text-gray-500">розхід «Закупівля товарів» створиться під час проведення</span>
          </FieldRow>
        </>
      )}
      {plan.mode === "prepaid" && (
        <div className="space-y-1 px-1">
          {candidates.length === 0 ? (
            <p className="text-[11px] text-gray-500">
              Немає вільних оплат «Закупівля товарів». Внесіть передоплату в Касі (+ Рахунок → Розхід) і поверніться сюди.
            </p>
          ) : (
            candidates.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-xs text-gray-800">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setPlan({ financeDocumentIds: [...next] });
                  }}
                />
                <span className="tabular-nums text-gray-500">{dayText(p.kyivDay)}</span>
                <span className="font-medium tabular-nums">
                  {p.amount.toLocaleString("uk-UA")} {SIGN[p.currency] || p.currency}
                </span>
                <span className="truncate text-gray-500">
                  {p.accountTitle}
                  {p.supplierName ? ` · ${p.supplierName}` : ""}
                  {p.comment ? ` · ${p.comment}` : ""}
                </span>
              </label>
            ))
          )}
        </div>
      )}
      {plan.mode === "credit" && (
        <p className="px-1 text-[11px] text-gray-500">
          Після проведення сума накладної з доставкою стане боргом перед постачальником (плитка «Постачальники» в Касі).
        </p>
      )}
    </>
  );
}
