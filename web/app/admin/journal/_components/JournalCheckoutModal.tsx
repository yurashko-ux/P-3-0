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

type StorageOpt = {
  id: string;
  title: string;
  altegioStorageId: number | null;
  includeInFinanceReport: boolean;
};

type CatalogProduct = {
  id: string;
  title: string;
  salePrice: number;
  isHair: boolean;
  sku: number | null;
  altegioGoodId: number | null;
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
  const [step, setStep] = useState<"check" | "pay">("check");
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
  const [storages, setStorages] = useState<StorageOpt[]>([]);
  const [storageId, setStorageId] = useState("");
  const [clientDeposits, setClientDeposits] = useState<ClientDeposit[]>([]);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [altegioPaid, setAltegioPaid] = useState(0);
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogHits, setCatalogHits] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [alloc, setAlloc] = useState<PayAlloc>({});
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const amountInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!open || !appointmentId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setStep("check");
    setAlloc({});
    setFocusedKey(null);
    setCatalogQ("");
    setCatalogHits([]);
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
        const existingGoods: GoodDraft[] = (json.checkout?.goodLines || []).map((g: any, i: number) => ({
          key: g.id || `g-${i}`,
          productId: g.productId,
          storageId: g.storageId,
          title: g.title,
          quantity: Number(g.quantity) > 0 ? Number(g.quantity) : 1,
          salePrice: Number(g.salePrice) || 0,
        }));
        setGoods(existingGoods);
        setAccounts(json.accounts || []);
        const deps: ClientDeposit[] = (json.clientDeposits || []).map((d: any) => ({
          depositId: Number(d.depositId) || 0,
          balance: Number(d.balance) || 0,
          title: d.title || "Особистий рахунок",
          blocked: Boolean(d.blocked),
        }));
        setClientDeposits(deps.filter((d) => d.depositId > 0));
        const st: StorageOpt[] = json.storages || [];
        setStorages(st);
        const defaultStorage =
          st.find((s) => s.includeInFinanceReport && s.altegioStorageId) ||
          st.find((s) => s.altegioStorageId) ||
          st[0];
        setStorageId(defaultStorage?.id || "");
        setAlreadyPaid(Boolean(json.alreadyPaid));
        setAltegioPaid(Number(json.altegioPaid) || 0);
        setCheckoutStatus(json.checkout?.status || null);
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

  useEffect(() => {
    if (!open || !appointmentId) return;
    const q = catalogQ.trim();
    if (q.length < 1) {
      setCatalogHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setCatalogLoading(true);
      void fetch(
        `/api/admin/journal/appointments/${appointmentId}/checkout?catalogSearch=${encodeURIComponent(q)}`,
        { credentials: "include" },
      )
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || "Пошук");
          if (cancelled) return;
          setCatalogHits(
            (json.catalogProducts || []).map((p: any) => ({
              id: p.id,
              title: p.title,
              salePrice: Number(p.salePrice) || 0,
              isHair: Boolean(p.isHair),
              sku: p.sku,
              altegioGoodId: p.altegioGoodId,
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setCatalogHits([]);
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [catalogQ, open, appointmentId]);

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

  const addProduct = (p: CatalogProduct) => {
    if (!storageId) {
      setError("Оберіть склад для товарів");
      return;
    }
    if (!(p.altegioGoodId && p.altegioGoodId > 0)) {
      setError(`«${p.title}» без id Altegio`);
      return;
    }
    setGoods((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        storageId,
        title: p.title,
        quantity: 1,
        salePrice: money(p.salePrice),
      },
    ]);
    setCatalogQ("");
    setCatalogHits([]);
    setError(null);
  };

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
    if (alreadyPaid || saving) return;
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

  const goToPay = () => {
    setError(null);
    if (!(total > 0)) {
      setError("Сума чека має бути більше 0");
      return;
    }
    if (lines.length === 0) {
      setError("Додайте хоча б одну послугу");
      return;
    }
    setAlloc({});
    setFocusedKey(null);
    setStep("pay");
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!(total > 0)) throw new Error("Сума чека має бути більше 0");
      if (lines.length === 0) throw new Error("Додайте хоча б одну послугу");
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
      setCheckoutStatus(json.checkout?.status || "synced");
      setSyncError(json.checkout?.syncError || null);
      setAlreadyPaid(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  const clientMasterBlock = (
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
      {checkoutStatus && step === "check" && (
        <p>
          <span className="text-gray-500">Чек:</span> {checkoutStatus}
          {altegioPaid > 0 ? ` · в Altegio ${altegioPaid.toLocaleString("uk-UA")} грн` : ""}
        </p>
      )}
    </div>
  );

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
        disabled={alreadyPaid || saving}
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
            amount > 0 || focusedKey === opts.keyId ? "opacity-100" : "opacity-0 pointer-events-none h-0 p-0 border-0"
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
        {amount > 0 && focusedKey !== opts.keyId && (
          <span className="sr-only">{amount} грн</span>
        )}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border w-full max-w-lg p-3 space-y-2 my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-semibold">{step === "pay" ? "Оплата" : "Закрити візит"}</p>
        {step === "check" && (
          <p className="text-[11px] text-gray-500">Послуги та товари. Далі — розбиття по рахунках.</p>
        )}
        {loading && <p className="text-xs text-gray-500">Завантаження…</p>}
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}
        {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
        {syncError && !notice && <div className="alert alert-warning text-sm py-2">{syncError}</div>}

        {clientMasterBlock}

        {step === "check" && (
          <>
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
              <p className="text-right tabular-nums text-gray-600">
                Послуги: {servicesTotal.toLocaleString("uk-UA")} грн
              </p>
            </div>

            <div className="text-xs space-y-1">
              <span className="text-gray-600">Товари / волосся</span>
              <label className="block space-y-1">
                <span className="text-gray-500">Склад</span>
                <select
                  className="select select-bordered select-xs w-full"
                  value={storageId}
                  disabled={alreadyPaid || saving}
                  onChange={(e) => setStorageId(e.target.value)}
                >
                  <option value="">Оберіть склад…</option>
                  {storages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              {!alreadyPaid && (
                <div className="relative">
                  <input
                    className="input input-bordered input-xs w-full"
                    placeholder="Пошук товару (назва або код)…"
                    value={catalogQ}
                    disabled={saving}
                    onChange={(e) => setCatalogQ(e.target.value)}
                  />
                  {(catalogHits.length > 0 || catalogLoading) && (
                    <div className="absolute z-10 left-0 right-0 mt-0.5 bg-white border rounded-md shadow max-h-40 overflow-y-auto">
                      {catalogLoading && <p className="px-2 py-1 text-gray-500">Пошук…</p>}
                      {catalogHits.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-2 py-1.5 hover:bg-gray-50 border-b last:border-0"
                          onClick={() => addProduct(p)}
                        >
                          <span className="block truncate">{p.title}</span>
                          <span className="text-gray-500">
                            {p.isHair ? "волосся · " : ""}
                            {money(p.salePrice).toLocaleString("uk-UA")} грн
                            {p.sku ? ` · #${p.sku}` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="border rounded-md divide-y">
                {goods.map((g, idx) => (
                  <div key={g.key} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                    <span className="flex-1 min-w-[8rem] truncate">{g.title}</span>
                    <input
                      className="input input-bordered input-xs w-14 text-right tabular-nums"
                      type="number"
                      min={0.01}
                      step="1"
                      title="Кількість"
                      value={g.quantity}
                      disabled={alreadyPaid || saving}
                      onChange={(e) => {
                        const quantity = Number(e.target.value) || 0;
                        setGoods((prev) => prev.map((row, i) => (i === idx ? { ...row, quantity } : row)));
                      }}
                    />
                    <input
                      className="input input-bordered input-xs w-20 text-right tabular-nums"
                      type="number"
                      min={0}
                      step="1"
                      title="Ціна грн"
                      value={g.salePrice}
                      disabled={alreadyPaid || saving}
                      onChange={(e) => {
                        const salePrice = Number(e.target.value) || 0;
                        setGoods((prev) => prev.map((row, i) => (i === idx ? { ...row, salePrice } : row)));
                      }}
                    />
                    {!alreadyPaid && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        disabled={saving}
                        onClick={() => setGoods((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {goods.length === 0 && <p className="p-2 text-gray-500">Товарів немає — лише послуги</p>}
              </div>
              <p className="text-right tabular-nums text-gray-600">
                Товари: {goodsTotal.toLocaleString("uk-UA")} грн
              </p>
            </div>

            <p className="text-sm font-semibold tabular-nums text-right">
              До сплати: {total.toLocaleString("uk-UA")} грн
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                className="btn btn-sm btn-primary"
                disabled={saving || loading || alreadyPaid || !(total > 0)}
                onClick={goToPay}
              >
                {alreadyPaid ? "Уже оплачено" : "Оплатити"}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={onClose}>
                Закрити
              </button>
            </div>
          </>
        )}

        {step === "pay" && (
          <>
            <p className="text-sm font-semibold tabular-nums">
              До сплати: {total.toLocaleString("uk-UA")} грн
              {!payBalanced && remaining > 0 && (
                <span className="ml-2 text-xs font-normal text-amber-700">
                  залишок {remaining.toLocaleString("uk-UA")} грн
                </span>
              )}
              {payBalanced && (
                <span className="ml-2 text-xs font-normal text-success">розподілено</span>
              )}
            </p>

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

            {accounts.length === 0 && usableDeposits.length === 0 && (
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
              <button
                className="btn btn-sm btn-ghost"
                disabled={saving}
                onClick={() => {
                  setStep("check");
                  setError(null);
                }}
              >
                ← До чека
              </button>
              <button className="btn btn-sm btn-ghost" onClick={onClose}>
                Закрити
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
