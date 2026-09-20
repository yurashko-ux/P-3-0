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
  paymentKind: string;
  checkoutStatus: string;
  altegioRecordId: number | null;
  altegioTransactionId: number | null;
  paidAmount: number;
};

function money(n: number) {
  return n.toLocaleString("uk-UA", { maximumFractionDigits: 0 });
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
              <th>Клієнт</th>
              <th>Майстер</th>
              <th>Рахунок</th>
              <th>Тип</th>
              <th className="text-right">Сума</th>
              <th>Статус</th>
              <th>Запис</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="tabular-nums whitespace-nowrap">{p.kyivDay}</td>
                <td>{p.client}</td>
                <td>{p.master}</td>
                <td>{p.accountTitle || `#${p.accountId}`}</td>
                <td>{p.paymentKind === "deposit" ? "Завдаток" : "Каса"}</td>
                <td className="text-right tabular-nums font-medium">{money(p.amount)} грн</td>
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
                <td className="tabular-nums">
                  {p.appointmentId ? (
                    <Link
                      href={`/admin/journal?highlight=${p.appointmentId}`}
                      className="link link-hover"
                    >
                      {p.altegioRecordId || "→"}
                    </Link>
                  ) : (
                    p.altegioRecordId || "—"
                  )}
                </td>
              </tr>
            ))}
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
