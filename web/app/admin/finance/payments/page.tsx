"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type AccountOpt = { id: number; title: string };

type PayRow = {
  id: string;
  checkoutId: string;
  appointmentId: string | null;
  kyivDay: string;
  occurredAt: string;
  client: string;
  master: string;
  accountId: number;
  accountTitle: string | null;
  amount: number;
  amountFx: number | null;
  currencyCode: string | null;
  fxRate: number | null;
  paymentKind: string;
  checkoutStatus: string;
  altegioRecordId: number | null;
  altegioTransactionId: number | null;
  paidAmount: number;
  reconciled: boolean;
  bank: { label: string; href: string } | null;
};

function money(n: number) {
  return n.toLocaleString("uk-UA", { maximumFractionDigits: 0 });
}

function fxReceivedLabel(row: PayRow): string | null {
  const code = (row.currencyCode || "").toUpperCase();
  if (!code || code === "UAH") return null;
  const received =
    row.amountFx != null && row.amountFx > 0
      ? row.amountFx
      : row.fxRate != null && row.fxRate > 0
        ? Math.round((row.amount / row.fxRate) * 100) / 100
        : null;
  if (received == null || !(received > 0)) return null;
  const symbol = code === "USD" ? "$" : code === "EUR" ? "€" : code;
  const formatted = received.toLocaleString("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `(${formatted} ${symbol})`;
}

function todayYmd() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function monthStartYmd() {
  const t = todayYmd();
  return `${t.slice(0, 7)}-01`;
}

export default function FinanceVisitPaymentsPage() {
  return (
    <Suspense fallback={<main className="px-3 pb-6 pt-2 text-sm text-gray-500">Завантаження…</main>}>
      <FinanceVisitPaymentsInner />
    </Suspense>
  );
}

function FinanceVisitPaymentsInner() {
  const searchParams = useSearchParams();
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(monthStartYmd);
  const [to, setTo] = useState(todayYmd);
  const [accountId, setAccountId] = useState(() => searchParams.get("accountId") || "");
  const [paymentKind, setPaymentKind] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editAmountFx, setEditAmountFx] = useState("");

  useEffect(() => {
    const fromUrl = searchParams.get("accountId");
    if (fromUrl != null) setAccountId(fromUrl);
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ options: "1", limit: "200", sort });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (accountId) params.set("accountId", accountId);
      if (paymentKind && paymentKind !== "all") params.set("paymentKind", paymentKind);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/finance/visit-payments?${params}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка завантаження");
      setPayments(json.payments || []);
      setAccounts(json.accounts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, [from, to, accountId, paymentKind, q, sort]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  function startEdit(row: PayRow) {
    setEditId(row.id);
    setEditAccountId(String(row.accountId));
    setEditAmount(String(row.amount));
    setEditAmountFx(row.amountFx != null ? String(row.amountFx) : "");
    setError(null);
  }

  async function saveEdit(row: PayRow) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/visit-payments/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: Number(editAccountId),
          amountUah: Number(String(editAmount).replace(",", ".")),
          amountFx: editAmountFx.trim() ? Number(String(editAmountFx).replace(",", ".")) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      setEditId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setBusyId(null);
    }
  }

  async function removePayment(row: PayRow) {
    if (!window.confirm("Видалити цей платіж?")) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/visit-payments/${row.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не видалено");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="px-3 pb-6 pt-2 space-y-3">
      <p className="text-xs text-gray-600">
        Платежі з каси журналу (закриття візитів). Зведення з monobank — у розділі Банк.
      </p>

      <div className="flex flex-wrap gap-2 items-end bg-white border rounded-xl p-2">
        <label className="text-xs space-y-0.5">
          <span className="text-gray-500">З</span>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs space-y-0.5">
          <span className="text-gray-500">По</span>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="text-xs space-y-0.5">
          <span className="text-gray-500">Рахунок</span>
          <select
            className="select select-bordered select-sm min-w-[9rem]"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Усі</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-0.5">
          <span className="text-gray-500">Тип</span>
          <select
            className="select select-bordered select-sm"
            value={paymentKind}
            onChange={(e) => setPaymentKind(e.target.value)}
          >
            <option value="all">Усі</option>
            <option value="account">Каса / ФОП</option>
            <option value="deposit">Завдаток</option>
          </select>
        </label>
        <label className="text-xs space-y-0.5">
          <span className="text-gray-500">Сортування</span>
          <select
            className="select select-bordered select-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="date_desc">Дата ↓</option>
            <option value="date_asc">Дата ↑</option>
            <option value="amount_desc">Сума ↓</option>
            <option value="amount_asc">Сума ↑</option>
          </select>
        </label>
        <label className="text-xs space-y-0.5 flex-1 min-w-[10rem]">
          <span className="text-gray-500">Пошук клієнта / майстра</span>
          <input
            className="input input-bordered input-sm w-full"
            placeholder="Прізвище…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "Оновити"}
        </button>
      </div>

      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <div className="bg-white border rounded-xl overflow-auto max-h-[calc(100vh-11rem)]">
        <table className="table table-xs w-full">
          <thead className="sticky top-0 z-10 bg-[#eef1f6] [&_th]:bg-[#eef1f6]">
            <tr>
              <th>Дата</th>
              <th>Запис</th>
              <th>Клієнт</th>
              <th>Майстер</th>
              <th>Рахунок</th>
              <th>Тип</th>
              <th>Вид</th>
              <th className="text-right">Сума</th>
              <th>Зведення</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const fxLabel = fxReceivedLabel(p);
              return (
              <tr key={p.id}>
                <td className="tabular-nums whitespace-nowrap">{p.kyivDay}</td>
                <td className="tabular-nums whitespace-nowrap">
                  {p.appointmentId ? (
                    <Link
                      href={`/admin/journal?day=${p.kyivDay}&appointment=${p.appointmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-hover"
                    >
                      {p.altegioRecordId || "запис"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{p.client}</td>
                <td>{p.master}</td>
                <td>
                  {editId === p.id ? (
                    <select
                      className="select select-bordered select-xs max-w-[10rem]"
                      value={editAccountId}
                      onChange={(e) => setEditAccountId(e.target.value)}
                    >
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      {p.accountTitle || `#${p.accountId}`}
                      {fxLabel ? <span className="text-gray-600"> {fxLabel}</span> : null}
                    </>
                  )}
                </td>
                <td>
                  <span className="font-bold text-green-600" title="Вхідний платіж">
                    ↓
                  </span>
                </td>
                <td>{p.paymentKind === "deposit" ? "Завдаток" : "Каса"}</td>
                <td className="text-right tabular-nums font-medium whitespace-nowrap">
                  {editId === p.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <input
                        className="input input-bordered input-xs w-24 text-right"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        inputMode="decimal"
                      />
                      <input
                        className="input input-bordered input-xs w-24 text-right"
                        value={editAmountFx}
                        onChange={(e) => setEditAmountFx(e.target.value)}
                        inputMode="decimal"
                        placeholder="валюта"
                      />
                    </div>
                  ) : (
                    `${money(p.amount)} грн`
                  )}
                </td>
                <td className="whitespace-nowrap text-xs">
                  {p.bank ? (
                    <a href={p.bank.href} target="_blank" rel="noopener noreferrer" className="link link-hover">
                      {p.bank.label}
                    </a>
                  ) : null}
                </td>
                <td>
                  <span
                    className={
                      p.checkoutStatus === "synced"
                        ? "text-success"
                        : p.checkoutStatus === "sync_error"
                          ? "text-error"
                          : "text-gray-500"
                    }
                  >
                    {p.checkoutStatus}
                  </span>
                </td>
                <td className="whitespace-nowrap">
                  {!p.reconciled && editId === p.id ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn btn-xs btn-primary"
                        disabled={busyId === p.id}
                        onClick={() => void saveEdit(p)}
                      >
                        Ок
                      </button>
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => setEditId(null)}>
                        Ні
                      </button>
                    </div>
                  ) : !p.reconciled ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={busyId === p.id}
                        onClick={() => startEdit(p)}
                        title="Редагувати"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        disabled={busyId === p.id}
                        onClick={() => void removePayment(p)}
                        title="Видалити"
                      >
                        🗑
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && payments.length === 0 && (
          <p className="p-4 text-sm text-gray-500">Немає оплат за цим фільтром.</p>
        )}
        {loading && <p className="p-4 text-sm text-gray-500">Завантаження…</p>}
      </div>
    </main>
  );
}
