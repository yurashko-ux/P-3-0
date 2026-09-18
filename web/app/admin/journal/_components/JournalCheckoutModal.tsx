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

function money(n: number) {
  return Math.round(n * 100) / 100;
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
  const [staffLabel, setStaffLabel] = useState("");
  const [lines, setLines] = useState<CheckoutLine[]>([]);
  const [goods, setGoods] = useState<GoodDraft[]>([]);
  const [accounts, setAccounts] = useState<CheckoutAccount[]>([]);
  const [storages, setStorages] = useState<StorageOpt[]>([]);
  const [storageId, setStorageId] = useState("");
  const [accountId, setAccountId] = useState(0);
  const [depositId, setDepositId] = useState(0);
  const [payMode, setPayMode] = useState<"account" | "deposit">("account");
  const [clientDeposits, setClientDeposits] = useState<ClientDeposit[]>([]);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [altegioPaid, setAltegioPaid] = useState(0);
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogHits, setCatalogHits] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!open || !appointmentId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
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
        const accs: CheckoutAccount[] = json.accounts || [];
        setAccounts(accs);
        const prefer =
          accs.find((a) => /каса|cash/i.test(a.title)) ||
          accs.find((a) => /еквайр|термінал|card/i.test(a.title)) ||
          accs[0];
        setAccountId(prefer?.id || 0);
        const deps: ClientDeposit[] = (json.clientDeposits || []).map((d: any) => ({
          depositId: Number(d.depositId) || 0,
          balance: Number(d.balance) || 0,
          title: d.title || "Особистий рахунок",
          blocked: Boolean(d.blocked),
        }));
        setClientDeposits(deps.filter((d) => d.depositId > 0));
        setDepositId(0);
        setPayMode("account");
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

  const submit = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!(total > 0)) throw new Error("Сума чека має бути більше 0");
      if (lines.length === 0) throw new Error("Додайте хоча б одну послугу");
      if (payMode === "deposit") {
        if (!(depositId > 0)) throw new Error("Оберіть завдаток клієнта");
        const dep = clientDeposits.find((d) => d.depositId === depositId);
        if (!dep) throw new Error("Завдаток не знайдено");
        if (dep.blocked) throw new Error("Рахунок заблоковано");
        if (dep.balance + 0.009 < total) {
          throw new Error(
            `Недостатньо на завдаткові: ${dep.balance.toLocaleString("uk-UA")} грн`,
          );
        }
      } else if (!(accountId > 0)) {
        throw new Error("Оберіть рахунок оплати");
      }
      const res = await fetch(`/api/admin/journal/appointments/${appointmentId}/checkout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: payMode === "deposit" ? 0 : accountId,
          accountTitle:
            payMode === "deposit"
              ? undefined
              : accounts.find((a) => a.id === accountId)?.title,
          depositId: payMode === "deposit" ? depositId : null,
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

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl border w-full max-w-lg p-3 space-y-2 my-6" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold">Закрити візит</p>
        <p className="text-[11px] text-gray-500">
          Послуги + товари зі складу + оплата (каса/ФОП або завдаток клієнта). Dual-write в Altegio.
        </p>
        {loading && <p className="text-xs text-gray-500">Завантаження…</p>}
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}
        {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
        {syncError && !notice && (
          <div className="alert alert-warning text-sm py-2">{syncError}</div>
        )}

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
          <p className="text-right tabular-nums text-gray-600">Послуги: {servicesTotal.toLocaleString("uk-UA")} грн</p>
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
          <p className="text-right tabular-nums text-gray-600">Товари: {goodsTotal.toLocaleString("uk-UA")} грн</p>
        </div>

        <p className="text-sm font-semibold tabular-nums text-right">
          До сплати: {total.toLocaleString("uk-UA")} грн
        </p>

        <label className="text-xs text-gray-600 block space-y-1">
          <span>Спосіб оплати</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn btn-xs ${payMode === "account" ? "btn-neutral" : "btn-ghost"}`}
              disabled={alreadyPaid || saving}
              onClick={() => setPayMode("account")}
            >
              Каса / ФОП
            </button>
            <button
              type="button"
              className={`btn btn-xs ${payMode === "deposit" ? "btn-neutral" : "btn-ghost"}`}
              disabled={alreadyPaid || saving || clientDeposits.length === 0}
              onClick={() => {
                setPayMode("deposit");
                const first = clientDeposits.find((d) => !d.blocked && d.balance > 0) || clientDeposits[0];
                if (first) setDepositId(first.depositId);
              }}
              title={clientDeposits.length === 0 ? "Немає завдатку в Altegio для цього клієнта" : undefined}
            >
              З завдатку
            </button>
          </div>
        </label>

        {payMode === "account" ? (
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
        ) : (
          <label className="text-xs text-gray-600 block space-y-1">
            <span>Особистий рахунок (завдаток)</span>
            <select
              className="select select-bordered select-sm w-full"
              value={depositId || ""}
              disabled={alreadyPaid || saving}
              onChange={(e) => setDepositId(Number(e.target.value) || 0)}
            >
              <option value="">Оберіть…</option>
              {clientDeposits.map((d) => (
                <option key={d.depositId} value={d.depositId} disabled={d.blocked}>
                  {d.title}: {d.balance.toLocaleString("uk-UA")} грн
                  {d.blocked ? " (блок)" : ""}
                </option>
              ))}
            </select>
            {depositId > 0 && (
              <p className="text-[11px] text-gray-500">
                Списуємо всю суму чека з завдатку (часткова оплата — пізніше).
              </p>
            )}
          </label>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            className="btn btn-sm btn-primary"
            disabled={saving || loading || alreadyPaid || !(total > 0)}
            onClick={() => void submit()}
          >
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
