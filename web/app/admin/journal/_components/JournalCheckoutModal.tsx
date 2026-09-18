"use client";

import { useEffect, useMemo, useState } from "react";

type CheckoutLine = {
  lineId: string;
  altegioServiceId: number;
  title: string;
  amount: number;
  cost: number;
};

type CheckoutAccount = {
  id: number;
  title: string;
  type: string | null;
};

export function JournalCheckoutModal({
  appointmentId,
  open,
  onClose,
  onDone,
}: {
  appointmentId: string | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clientLabel, setClientLabel] = useState("");
  const [staffLabel, setStaffLabel] = useState("");
  const [lines, setLines] = useState<CheckoutLine[]>([]);
  const [accounts, setAccounts] = useState<CheckoutAccount[]>([]);
  const [accountId, setAccountId] = useState(0);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [altegioPaid, setAltegioPaid] = useState(0);
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !appointmentId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    void fetch(`/api/admin/journal/appointments/${appointmentId}/checkout`, { credentials: "include" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося відкрити касу");
        const appt = json.appointment;
        const c = appt?.directClient;
        setClientLabel(
          appt?.clientName ||
            [c?.lastName, c?.firstName].filter(Boolean).join(" ") ||
            c?.instagramUsername ||
            "Клієнт",
        );
        setStaffLabel(appt?.staffName || appt?.master?.name || "—");
        setLines(
          (appt?.lines || []).map((l: any) => ({
            lineId: l.id,
            altegioServiceId: Number(l.altegioServiceId) || 0,
            title: l.title || "Послуга",
            amount: Number(l.amount) > 0 ? Number(l.amount) : 1,
            cost: Number(l.cost) || 0,
          })),
        );
        const accs: CheckoutAccount[] = json.accounts || [];
        setAccounts(accs);
        const prefer =
          accs.find((a) => /каса|cash/i.test(a.title)) ||
          accs.find((a) => /еквайр|термінал|card/i.test(a.title)) ||
          accs[0];
        setAccountId(prefer?.id || 0);
        setAlreadyPaid(Boolean(json.alreadyPaid));
        setAltegioPaid(Number(json.altegioPaid) || 0);
        setCheckoutStatus(json.checkout?.status || null);
        if (json.alreadyPaid) {
          setNotice(
            `Візит уже оплачено${json.altegioPaid ? ` (Altegio ${Number(json.altegioPaid).toLocaleString("uk-UA")} грн)` : ""}.`,
          );
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Помилка каси"))
      .finally(() => setLoading(false));
  }, [open, appointmentId]);

  const total = useMemo(
    () => Math.round(lines.reduce((s, l) => s + (Number(l.cost) || 0), 0) * 100) / 100,
    [lines],
  );

  if (!open || !appointmentId) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!(accountId > 0)) throw new Error("Оберіть рахунок оплати");
      if (!(total > 0)) throw new Error("Сума послуг має бути більше 0");
      const res = await fetch(`/api/admin/journal/appointments/${appointmentId}/checkout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          accountTitle: accounts.find((a) => a.id === accountId)?.title,
          services: lines.map((l) => ({
            lineId: l.lineId,
            altegioServiceId: l.altegioServiceId,
            title: l.title,
            amount: l.amount,
            cost: l.cost,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка закриття візиту");
      setNotice("Візит закрито — оплата записана в Altegio.");
      setCheckoutStatus(json.checkout?.status || "synced");
      setAlreadyPaid(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl border w-full max-w-lg p-3 space-y-2 my-6" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold">Закрити візит</p>
        <p className="text-[11px] text-gray-500">
          Послуги + оплата на один рахунок. Пишеться в Kresco і одразу в Altegio. Товари й завдаток — пізніше.
        </p>
        {loading && <p className="text-xs text-gray-500">Завантаження…</p>}
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}
        {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}

        <div className="text-xs space-y-0.5 border rounded-md px-2 py-1.5 bg-gray-50">
          <p>
            <span className="text-gray-500">Клієнт:</span> {clientLabel}
          </p>
          <p>
            <span className="text-gray-500">Майстер:</span> {staffLabel}
          </p>
          {checkoutStatus && (
            <p>
              <span className="text-gray-500">Чек:</span> {checkoutStatus}
              {altegioPaid > 0 ? ` · в Altegio ${altegioPaid.toLocaleString("uk-UA")} грн` : ""}
            </p>
          )}
        </div>

        <div className="text-xs space-y-1">
          <span className="text-gray-600">Послуги (сума грн)</span>
          <div className="border rounded-md divide-y">
            {lines.map((l, idx) => (
              <div key={l.lineId} className="flex items-center gap-2 px-2 py-1.5">
                <span className="flex-1 min-w-0 truncate">{l.title}</span>
                <input
                  className="input input-bordered input-xs w-24 text-right tabular-nums"
                  type="number"
                  min={0}
                  step="1"
                  value={l.cost}
                  disabled={alreadyPaid || saving}
                  onChange={(e) => {
                    const cost = Number(e.target.value) || 0;
                    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, cost } : row)));
                  }}
                />
              </div>
            ))}
            {lines.length === 0 && <p className="p-2 text-gray-500">Немає послуг у записі</p>}
          </div>
          <p className="text-sm font-semibold tabular-nums text-right">Разом: {total.toLocaleString("uk-UA")} грн</p>
        </div>

        <label className="text-xs text-gray-600 block space-y-1">
          <span>Рахунок оплати</span>
          <select
            className="select select-bordered select-sm w-full"
            value={accountId || ""}
            disabled={alreadyPaid || saving}
            onChange={(e) => setAccountId(Number(e.target.value) || 0)}
          >
            <option value="">Оберіть…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn btn-sm btn-primary" disabled={saving || loading || alreadyPaid || !(total > 0)} onClick={() => void submit()}>
            {saving ? "Проведення…" : alreadyPaid ? "Уже оплачено" : "Провести"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}
