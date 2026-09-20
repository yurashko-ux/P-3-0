"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClientNameWithLoyalty } from "@/app/admin/_components/ClientNameWithLoyalty";

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

type ClientDeposit = {
  depositId: number;
  balance: number;
  title: string;
  blocked: boolean;
};

type GoodDraft = {
  key: string;
  productId: string;
  storageId: string;
  title: string;
  quantity: number;
  salePrice: number;
};

/** Ключ плитки: a:123 або d:456 */
type PayAlloc = Record<string, number>;

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function accountKey(id: number) {
  return `a:${id}`;
}

function depositKey(id: number) {
  return `d:${id}`;
}

function parseKey(key: string): { kind: "account" | "deposit"; id: number } | null {
  const m = /^(a|d):(\d+)$/.exec(key);
  if (!m) return null;
  return { kind: m[1] === "d" ? "deposit" : "account", id: Number(m[2]) };
}

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
  const [clientSpent, setClientSpent] = useState<number | null>(null);
  const [clientVisits, setClientVisits] = useState<number | null>(null);
  const [staffLabel, setStaffLabel] = useState("");
  const [lines, setLines] = useState<CheckoutLine[]>([]);
  const [goods, setGoods] = useState<GoodDraft[]>([]);
  const [accounts, setAccounts] = useState<CheckoutAccount[]>([]);
  const [clientDeposits, setClientDeposits] = useState<ClientDeposit[]>([]);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [altegioPaid, setAltegioPaid] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [alloc, setAlloc] = useState<PayAlloc>({});
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const amountInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!open || !appointmentId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setAlloc({});
    setFocusedKey(null);
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
        setClientSpent(c?.spent != null ? Number(c.spent) : null);
        setClientVisits(c?.visits != null ? Number(c.visits) : null);
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
        const fromAppt: GoodDraft[] = (appt?.goodLines || []).map((g: any, i: number) => ({
          key: g.id || `ag-${i}`,
          productId: g.productId,
          storageId: g.storageId,
          title: g.title,
          quantity: Number(g.quantity) > 0 ? Number(g.quantity) : 1,
          salePrice: Number(g.salePrice) || 0,
        }));
        const fromCheckout: GoodDraft[] = (json.checkout?.goodLines || []).map((g: any, i: number) => ({
          key: g.id || `cg-${i}`,
          productId: g.productId,
          storageId: g.storageId,
          title: g.title,
          quantity: Number(g.quantity) > 0 ? Number(g.quantity) : 1,
          salePrice: Number(g.salePrice) || 0,
        }));
        setGoods(fromAppt.length > 0 ? fromAppt : fromCheckout);
        setAccounts(json.accounts || []);
        const deps: ClientDeposit[] = (json.clientDeposits || []).map((d: any) => ({
          depositId: Number(d.depositId) || 0,
          balance: Number(d.balance) || 0,
          title: d.title || "Особистий рахунок",
          blocked: Boolean(d.blocked),
        }));
        setClientDeposits(deps.filter((d) => d.depositId > 0));
        setAlreadyPaid(Boolean(json.alreadyPaid));
        setAltegioPaid(Number(json.altegioPaid) || 0);
        setSyncError(json.checkout?.syncError || null);
        if (json.alreadyPaid) {
          setNotice(
            `Візит уже оплачено${json.altegioPaid ? ` (Altegio ${Number(json.altegioPaid).toLocaleString("uk-UA")} грн)` : ""}.`,
          );
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Помилка каси"))
      .finally(() => setLoading(false));
  }, [open, appointmentId]);

  const servicesTotal = useMemo(
    () => money(lines.reduce((s, l) => s + (Number(l.cost) || 0), 0)),
    [lines],
  );
  const goodsTotal = useMemo(
    () => money(goods.reduce((s, g) => s + (Number(g.salePrice) || 0) * (Number(g.quantity) || 0), 0)),
    [goods],
  );
  const total = money(servicesTotal + goodsTotal);

  const allocatedSum = useMemo(
    () => money(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0)),
    [alloc],
  );
  const remaining = money(Math.max(0, total - allocatedSum));
  const payBalanced = total > 0 && Math.abs(allocatedSum - total) < 0.015;

  const usableDeposits = useMemo(
    () => clientDeposits.filter((d) => !d.blocked && d.balance > 0),
    [clientDeposits],
  );

  if (!open || !appointmentId) return null;

  const focusAmount = (key: string) => {
    setFocusedKey(key);
    requestAnimationFrame(() => {
      const el = amountInputRefs.current[key];
      if (el) {
        el.focus();
        el.select();
      }
    });
  };

  const clickTile = (key: string, maxCap?: number) => {
    if (alreadyPaid || saving || loading) return;
    setError(null);
    const current = money(alloc[key] || 0);
    if (current > 0) {
      focusAmount(key);
      return;
    }
    const othersSum = money(
      Object.entries(alloc)
        .filter(([k]) => k !== key)
        .reduce((s, [, v]) => s + (Number(v) || 0), 0),
    );
    let fill = money(Math.max(0, total - othersSum));
    if (maxCap != null && maxCap >= 0) {
      fill = money(Math.min(fill, maxCap));
    }
    if (!(fill > 0)) {
      setError("Немає залишку для цього рахунку — зменшіть суму на іншому");
      focusAmount(key);
      return;
    }
    setAlloc((prev) => ({ ...prev, [key]: fill }));
    focusAmount(key);
  };

  const setTileAmount = (key: string, raw: number, maxCap?: number) => {
    let next = money(Math.max(0, raw));
    if (maxCap != null && next > maxCap) next = money(maxCap);
    setAlloc((prev) => {
      const copy = { ...prev };
      if (next <= 0) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!(total > 0)) throw new Error("Сума чека має бути більше 0");
      if (lines.length === 0) throw new Error("У записі немає послуг для оплати");
      if (!payBalanced) {
        throw new Error(
          `Розбийте всю суму: розподілено ${allocatedSum.toLocaleString("uk-UA")} з ${total.toLocaleString("uk-UA")} грн`,
        );
      }
      const payments = Object.entries(alloc)
        .filter(([, amount]) => money(amount) > 0)
        .map(([key, amount]) => {
          const parsed = parseKey(key);
          if (!parsed) throw new Error("Некоректний рахунок");
          if (parsed.kind === "deposit") {
            const dep = clientDeposits.find((d) => d.depositId === parsed.id);
            if (!dep) throw new Error("Завдаток не знайдено");
            if (dep.blocked) throw new Error("Рахунок заблоковано");
            if (dep.balance + 0.009 < money(amount)) {
              throw new Error(
                `Недостатньо на «${dep.title}»: ${dep.balance.toLocaleString("uk-UA")} грн`,
              );
            }
            return {
              accountId: parsed.id,
              amount: money(amount),
              paymentKind: "deposit" as const,
              depositId: parsed.id,
              accountTitle: `Завдаток: ${dep.title}`,
            };
          }
          const acc = accounts.find((a) => a.id === parsed.id);
          if (!acc) throw new Error("Рахунок не знайдено");
          return {
            accountId: parsed.id,
            amount: money(amount),
            paymentKind: "account" as const,
            accountTitle: acc.title,
          };
        });
      if (payments.length === 0) throw new Error("Оберіть хоча б один рахунок");

      const res = await fetch(`/api/admin/journal/appointments/${appointmentId}/checkout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payments,
          services: lines.map((l) => ({
            lineId: l.lineId,
            altegioServiceId: l.altegioServiceId,
            title: l.title,
            amount: l.amount,
            cost: l.cost,
          })),
          goods: goods.map((g) => ({
            productId: g.productId,
            storageId: g.storageId,
            quantity: g.quantity,
            salePrice: g.salePrice,
            title: g.title,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка закриття візиту");
      const stockWarn = json.checkout?.syncError;
      setNotice(
        stockWarn
          ? `Візит оплачено в Altegio. Увага: ${stockWarn}`
          : "Візит закрито — оплата записана в Altegio" +
              (goods.length > 0 ? ", товари списано зі складу." : "."),
      );
      setSyncError(json.checkout?.syncError || null);
      setAlreadyPaid(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  const renderTile = (opts: {
    keyId: string;
    label: string;
    subtitle?: string;
    maxCap?: number;
    hintAmount?: number;
  }) => {
    const amount = money(alloc[opts.keyId] || 0);
    const active = amount > 0 || focusedKey === opts.keyId;
    return (
      <button
        key={opts.keyId}
        type="button"
        disabled={alreadyPaid || saving || loading}
        onClick={() => clickTile(opts.keyId, opts.maxCap)}
        className={`relative flex flex-col items-center justify-center min-h-[5.5rem] rounded-lg border-2 px-2 py-2 text-center transition-colors ${
          active ? "border-neutral bg-neutral/5" : "border-gray-200 bg-white hover:border-gray-400"
        } disabled:opacity-60`}
      >
        <span className="text-[11px] font-medium text-gray-800 leading-tight line-clamp-2">{opts.label}</span>
        {opts.subtitle && <span className="text-[10px] text-gray-500 mt-0.5">{opts.subtitle}</span>}
        {opts.hintAmount != null && opts.hintAmount > 0 && amount <= 0 && (
          <span className="text-xs tabular-nums text-amber-700 mt-1 font-medium">
            {opts.hintAmount.toLocaleString("uk-UA")} грн
          </span>
        )}
        <input
          ref={(el) => {
            amountInputRefs.current[opts.keyId] = el;
          }}
          className={`mt-1 input input-bordered input-xs w-full max-w-[6.5rem] text-center tabular-nums ${
            amount > 0 || focusedKey === opts.keyId
              ? "opacity-100"
              : "opacity-0 pointer-events-none h-0 p-0 border-0"
          }`}
          type="number"
          min={0}
          step="1"
          value={amount > 0 || focusedKey === opts.keyId ? amount || "" : ""}
          disabled={alreadyPaid || saving}
          onClick={(e) => e.stopPropagation()}
          onFocus={() => setFocusedKey(opts.keyId)}
          onChange={(e) => setTileAmount(opts.keyId, Number(e.target.value) || 0, opts.maxCap)}
        />
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border w-full max-w-md p-3 space-y-3 my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">Оплата</p>
          <button type="button" className="btn btn-ghost btn-xs btn-circle" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </div>

        {loading && <p className="text-xs text-gray-500">Завантаження…</p>}
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}
        {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
        {syncError && !notice && <div className="alert alert-warning text-sm py-2">{syncError}</div>}

        <div className="text-xs space-y-0.5 border rounded-md px-2 py-1.5 bg-gray-50">
          <p className="flex items-center gap-1.5 flex-wrap">
            <span className="text-gray-500">Клієнт:</span>{" "}
            <ClientNameWithLoyalty
              name={clientLabel}
              spent={clientSpent}
              visits={clientVisits}
              nameClassName="text-xs text-gray-900 font-medium"
            />
          </p>
          <p>
            <span className="text-gray-500">Майстер:</span> {staffLabel}
          </p>
          {altegioPaid > 0 && (
            <p className="text-gray-500">Уже в Altegio: {altegioPaid.toLocaleString("uk-UA")} грн</p>
          )}
        </div>

        <p className="text-sm font-semibold tabular-nums">
          До сплати: {loading ? "…" : `${total.toLocaleString("uk-UA")} грн`}
          {!loading && !payBalanced && remaining > 0 && (
            <span className="ml-2 text-xs font-normal text-amber-700">
              залишок {remaining.toLocaleString("uk-UA")} грн
            </span>
          )}
          {!loading && payBalanced && (
            <span className="ml-2 text-xs font-normal text-success">розподілено</span>
          )}
        </p>

        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {usableDeposits.map((d) =>
              renderTile({
                keyId: depositKey(d.depositId),
                label: d.title || "Завдаток",
                subtitle: "завдаток",
                maxCap: d.balance,
                hintAmount: d.balance,
              }),
            )}
            {accounts.map((a) =>
              renderTile({
                keyId: accountKey(a.id),
                label: a.title,
              }),
            )}
          </div>
        )}

        {!loading && accounts.length === 0 && usableDeposits.length === 0 && (
          <p className="text-xs text-gray-500">Немає рахунків для оплати.</p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            className="btn btn-sm btn-primary"
            disabled={saving || loading || alreadyPaid || !payBalanced}
            onClick={() => void submit()}
          >
            {saving ? "Проведення…" : alreadyPaid ? "Уже оплачено" : "Оплатити"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}
