"use client";

import { useEffect, useMemo, useState } from "react";

export type CashDocumentType = "income" | "expense" | "transfer";

type AccountOpt = { id: number; title: string };
type PurposeOpt = { id: string; title: string; externalId: number | null };

const TYPE_LABEL: Record<CashDocumentType, string> = {
  income: "Прихід",
  expense: "Розхід",
  transfer: "Переміщення",
};

/** Валюта рахунку за назвою (так само, як у касі). */
function accountCurrency(title: string | undefined): "UAH" | "USD" | "EUR" {
  const text = (title || "").toLowerCase();
  if (/долар|usd|dollar/.test(text)) return "USD";
  if (/євро|евро|euro|eur|€/.test(text)) return "EUR";
  return "UAH";
}

function currencyUnit(currency: "UAH" | "USD" | "EUR"): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "грн";
}

function nowLocalInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Ручний прихід / розхід / переміщення. Документ живе лише в Креско, в Altegio не йде. */
export function CashDocumentModal({
  type,
  onClose,
  onSaved,
}: {
  type: CashDocumentType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [purposes, setPurposes] = useState<PurposeOpt[]>([]);
  const [amount, setAmount] = useState("");
  const [counterAmount, setCounterAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [purposeId, setPurposeId] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalInput);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/finance/documents?options=1&limit=1", { credentials: "include" });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити рахунки");
        if (cancelled) return;
        setAccounts((json.accounts || []) as AccountOpt[]);
        setPurposes(((json.purposes || []) as PurposeOpt[]).filter((purpose) => purpose.externalId != null));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка завантаження");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const purposeOptions = useMemo(() => [...purposes].sort((a, b) => a.title.localeCompare(b.title, "uk")), [purposes]);
  const currency = accountCurrency(accounts.find((account) => String(account.id) === accountId)?.title);
  const counterCurrency = accountCurrency(accounts.find((account) => String(account.id) === counterAccountId)?.title);
  const exchange = type === "transfer" && Boolean(counterAccountId) && currency !== counterCurrency;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type,
        amount: Number(amount.replace(",", ".")),
        accountId: Number(accountId),
        comment: comment || null,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
      };
      if (type === "transfer") {
        payload.counterAccountId = Number(counterAccountId);
        if (exchange) payload.counterAmount = Number(counterAmount.replace(",", "."));
      } else {
        payload.purposeId = purposeId || null;
      }
      const res = await fetch("/api/admin/finance/documents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не створено");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="w-full max-w-sm space-y-2 rounded-xl bg-white p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold text-gray-900">{TYPE_LABEL[type]}</div>
        {error && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">{error}</div>}
        <label className="form-control">
          <span className="label-text text-xs">Сума, {currencyUnit(currency)}</span>
          <input
            className="input input-bordered input-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">{type === "transfer" ? "З рахунку" : "Рахунок"}</span>
          <select
            className="select select-bordered select-sm"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">—</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.title}
              </option>
            ))}
          </select>
        </label>
        {type === "transfer" ? (
          <label className="form-control">
            <span className="label-text text-xs">На рахунок</span>
            <select
              className="select select-bordered select-sm"
              value={counterAccountId}
              onChange={(e) => setCounterAccountId(e.target.value)}
            >
              <option value="">—</option>
              {accounts
                .filter((account) => String(account.id) !== accountId)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.title}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label className="form-control">
            <span className="label-text text-xs">Стаття</span>
            <select
              className="select select-bordered select-sm"
              value={purposeId}
              onChange={(e) => setPurposeId(e.target.value)}
            >
              <option value="">—</option>
              {purposeOptions.map((purpose) => (
                <option key={purpose.id} value={purpose.id}>
                  {purpose.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {exchange ? (
          <label className="form-control">
            <span className="label-text text-xs">Зайшло на рахунок, {currencyUnit(counterCurrency)}</span>
            <input
              className="input input-bordered input-sm"
              value={counterAmount}
              onChange={(e) => setCounterAmount(e.target.value)}
              inputMode="decimal"
            />
          </label>
        ) : null}
        <label className="form-control">
          <span className="label-text text-xs">Дата / час</span>
          <input
            type="datetime-local"
            className="input input-bordered input-sm"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Коментар</span>
          <input
            className="input input-bordered input-sm"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <p className="text-[10px] text-gray-500">Документ запишеться лише в Креско. В Альтеджіо він не потрапить.</p>
        <div className="flex gap-2 pt-1">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy}>
            {busy ? "Запис…" : "Створити"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Скасувати
          </button>
        </div>
      </div>
    </div>
  );
}
