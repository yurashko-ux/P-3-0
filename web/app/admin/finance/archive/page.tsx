"use client";

import { useCallback, useEffect, useState } from "react";

type Overview = {
  clients: number;
  appointments: number;
  payments: number;
  finance: number;
  cursors: Array<{ syncKey: string; cursor: string; status: string; detail: string | null }>;
  checks: Array<{
    kyivMonth: string;
    kind: string;
    apiCount: number;
    dbCount: number;
    dbAmount: number;
    note: string | null;
  }>;
};

type ClientHit = {
  altegioClientId: number;
  name: string | null;
  phone: string | null;
  visits: number | null;
  spent: number | null;
  directClientId: string | null;
};

type AppointmentRow = {
  id: string;
  kyivDay: string;
  staffName: string | null;
  attendance: number | null;
  comment: string | null;
  lines: Array<{ title: string; cost: number }>;
};

type PaymentRow = {
  id: string;
  kyivDay: string | null;
  amount: number;
  method: string | null;
  staffName: string | null;
  serviceTitle: string | null;
};

type FinanceRow = {
  id: string;
  kyivDay: string;
  documentId: number | null;
  counterpartyName: string | null;
  paymentPurpose: string | null;
  accountTitle: string | null;
  comment: string | null;
  amount: number;
  balance: number | null;
  direction: string;
};

function money(n: number): string {
  return new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
}

function clientHref(id: string, label: string): string {
  const params = new URLSearchParams({ clientIds: id, source: "journalClient" });
  if (label.trim()) params.set("label", label.trim());
  return `/admin/direct?${params.toString()}`;
}

export default function AltegioArchivePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [picked, setPicked] = useState<ClientHit | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [finance, setFinance] = useState<FinanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/archive", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка архіву");
      setOverview(json.overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const handle = setTimeout(() => {
      const q = query.trim();
      if (q.length < 2) {
        setHits([]);
        return;
      }
      void fetch(`/api/admin/finance/archive?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((res) => res.json())
        .then((json) => {
          if (json?.ok) setHits(json.clients || []);
        })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  async function openClient(hit: ClientHit) {
    setPicked(hit);
    setError(null);
    const res = await fetch(`/api/admin/finance/archive?clientId=${hit.altegioClientId}`, { credentials: "include" });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json.error || "Не вдалося відкрити клієнта");
      return;
    }
    setAppointments(json.detail?.appointments || []);
    setPayments(json.detail?.payments || []);
  }

  async function loadFinance() {
    if (!from || !to) return;
    setError(null);
    const res = await fetch(`/api/admin/finance/archive?from=${from}&to=${to}`, { credentials: "include" });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json.error || "Не вдалося прочитати касу");
      return;
    }
    setFinance(json.finance || []);
  }

  return (
    <main className="px-3 pb-8 pt-2 space-y-4">
      <p className="text-xs text-gray-600 max-w-3xl">
        Архів Altegio лише для читання. Картки Direct і нові фінансові операції звідси не змінюються.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      {loading && <p className="text-sm text-gray-500">Завантаження…</p>}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Клієнти архіву" value={overview.clients} />
          <Stat label="Записи" value={overview.appointments} />
          <Stat label="Оплати візитів" value={overview.payments} />
          <Stat label="Касові операції" value={overview.finance} />
        </div>
      )}
      {overview && overview.cursors.length > 0 && (
        <div className="text-xs text-gray-500">
          {overview.cursors.map((row) => (
            <div key={row.syncKey}>
              {row.syncKey}: {row.status} {row.cursor} {row.detail || ""}
            </div>
          ))}
        </div>
      )}

      <section className="bg-white border rounded-xl p-3 space-y-2">
        <div className="font-semibold text-sm">Клієнт</div>
        <input
          className="input input-bordered input-sm w-full max-w-md"
          placeholder="Імʼя, телефон або id Altegio"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hits.length > 0 && (
          <ul className="border rounded-lg divide-y max-h-56 overflow-y-auto">
            {hits.map((hit) => (
              <li key={hit.altegioClientId}>
                <button type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50" onClick={() => void openClient(hit)}>
                  {hit.name || "Без імені"}
                  {hit.phone ? ` · ${hit.phone}` : ""} · #{hit.altegioClientId}
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {picked.directClientId ? (
                <a className="link link-hover" href={clientHref(picked.directClientId, picked.name || "")} target="_blank" rel="noopener noreferrer">
                  {picked.name || "Без імені"}
                </a>
              ) : (
                picked.name || "Без імені"
              )}
              <span className="text-gray-500 font-normal"> · #{picked.altegioClientId}</span>
            </div>
            <h3 className="text-xs font-semibold text-gray-500">Візити</h3>
            <div className="overflow-x-auto">
              <table className="table table-xs w-full">
                <thead>
                  <tr>
                    <th>День</th>
                    <th>Майстер</th>
                    <th>Послуги</th>
                    <th>Явка</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((row) => (
                    <tr key={row.id}>
                      <td className="tabular-nums whitespace-nowrap">{row.kyivDay}</td>
                      <td>{row.staffName || "—"}</td>
                      <td className="text-xs">
                        {row.lines.length === 0
                          ? "—"
                          : row.lines.map((line) => `${line.title} ${money(line.cost)} ₴`).join("; ")}
                      </td>
                      <td>{row.attendance ?? "—"}</td>
                    </tr>
                  ))}
                  {appointments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-gray-400">
                        Записів немає
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <h3 className="text-xs font-semibold text-gray-500">Оплати візитів</h3>
            <div className="overflow-x-auto">
              <table className="table table-xs w-full">
                <thead>
                  <tr>
                    <th>День</th>
                    <th>Сума</th>
                    <th>Спосіб</th>
                    <th>Майстер</th>
                    <th>Послуги</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((row) => (
                    <tr key={row.id}>
                      <td className="tabular-nums">{row.kyivDay || "—"}</td>
                      <td className="tabular-nums">{money(row.amount)} ₴</td>
                      <td>{row.method || "—"}</td>
                      <td>{row.staffName || "—"}</td>
                      <td className="text-xs">{row.serviceTitle || "—"}</td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-gray-400">
                        Оплат немає
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white border rounded-xl p-3 space-y-2">
        <div className="font-semibold text-sm">Каса за період</div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs space-y-0.5">
            <span className="text-gray-500">З</span>
            <input type="date" className="input input-bordered input-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs space-y-0.5">
            <span className="text-gray-500">До</span>
            <input type="date" className="input input-bordered input-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn btn-sm btn-primary" type="button" onClick={() => void loadFinance()}>
            Показати
          </button>
        </div>
        {finance.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table table-xs w-full">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>№ док.</th>
                  <th>Платник</th>
                  <th>Призначення</th>
                  <th>Каса</th>
                  <th>Сума</th>
                  <th>Залишок</th>
                </tr>
              </thead>
              <tbody>
                {finance.map((row) => (
                  <tr key={row.id}>
                    <td className="tabular-nums whitespace-nowrap">{row.kyivDay}</td>
                    <td>{row.documentId || "—"}</td>
                    <td>{row.counterpartyName || "—"}</td>
                    <td>{row.paymentPurpose || "—"}</td>
                    <td>{row.accountTitle || "—"}</td>
                    <td className="tabular-nums whitespace-nowrap">
                      {money(row.amount)} ₴
                    </td>
                    <td className="tabular-nums">{row.balance == null ? "—" : `${money(row.balance)} ₴`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {overview && overview.checks.length > 0 && (
        <section className="bg-white border rounded-xl p-3 space-y-2">
          <div className="font-semibold text-sm">Звірка по місяцях</div>
          <div className="overflow-x-auto">
            <table className="table table-xs w-full">
              <thead>
                <tr>
                  <th>Місяць</th>
                  <th>Що</th>
                  <th>Altegio</th>
                  <th>Архів</th>
                  <th>Сума архіву</th>
                </tr>
              </thead>
              <tbody>
                {overview.checks.map((row) => (
                  <tr key={`${row.kind}-${row.kyivMonth}`}>
                    <td className="tabular-nums">{row.kyivMonth}</td>
                    <td>{row.kind === "records" ? "Записи" : "Каса"}</td>
                    <td className="tabular-nums">{row.apiCount}</td>
                    <td className="tabular-nums">{row.dbCount}</td>
                    <td className="tabular-nums">{row.kind === "finance" ? `${money(row.dbAmount)} ₴` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border rounded-xl px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString("uk-UA")}</div>
    </div>
  );
}
