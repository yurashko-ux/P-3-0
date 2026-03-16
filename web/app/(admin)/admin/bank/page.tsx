// web/app/(admin)/admin/bank/page.tsx
// Розділ Банк: підключення monobank, рахунки, виписки

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type BankAccount = {
  id: string;
  externalId: string;
  balance: string;
  currencyCode: number;
  type: string | null;
  iban: string | null;
  maskedPan: string | null;
};

type BankConnection = {
  id: string;
  provider: string;
  name: string;
  clientName: string | null;
  webhookUrl: string | null;
  createdAt: string;
  accounts: BankAccount[];
};

type StatementItem = {
  id: string;
  externalId: string;
  time: string;
  description: string;
  amount: string;
  balance: string | null;
  hold: boolean;
  mcc: number | null;
};

function formatMoney(kopiykas: string): string {
  const n = Number(kopiykas) / 100;
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BankPage() {
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectForm, setConnectForm] = useState({ name: "Monobank", token: "" });
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statement, setStatement] = useState<StatementItem[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadConnections = async () => {
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const res = await fetch("/api/bank/connections", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setConnectionsError("Увійдіть в адмін-панель, щоб бачити підключення.");
        setConnections([]);
      } else if (data.ok && Array.isArray(data.connections)) {
        setConnections(data.connections);
        if (!selectedAccountId && data.connections[0]?.accounts?.[0]?.id) {
          setSelectedAccountId(data.connections[0].accounts[0].id);
        }
      }
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const loadStatement = async () => {
    if (!selectedAccountId) return;
    setStatementLoading(true);
    try {
      const res = await fetch(
        `/api/bank/statement?accountId=${encodeURIComponent(selectedAccountId)}&from=${fromDate}&to=${toDate}`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (data.ok && Array.isArray(data.items)) {
        setStatement(data.items);
      } else {
        setStatement([]);
      }
    } finally {
      setStatementLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAccountId) loadStatement();
  }, [selectedAccountId, fromDate, toDate]);

  const handleConnect = async () => {
    const token = connectForm.token.trim();
    if (!token) {
      setConnectError("Введіть токен з api.monobank.ua");
      return;
    }
    setConnectError(null);
    setConnectSuccess(null);
    setConnectLoading(true);
    if (typeof console !== "undefined" && console.log) {
      console.log("[bank] handleConnect called, sending POST");
    }
    try {
      const res = await fetch("/api/bank/monobank/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: connectForm.name.trim() || "Monobank", token }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[bank] connect response", res.status, data?.error ?? null);
      }
      if (res.status === 401 || res.status === 403) {
        setConnectError("Увійдіть в адмін-панель.");
      } else if (data.ok) {
        setConnectForm((prev) => ({ ...prev, token: "" }));
        setConnectSuccess("Підключення додано");
        setTimeout(() => setConnectSuccess(null), 4000);
        await loadConnections();
      } else {
        setConnectError(data.error || "Помилка підключення");
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Помилка мережі");
    } finally {
      setConnectLoading(false);
    }
  };

  const handleSync = async () => {
    if (!selectedAccountId) return;
    setSyncMessage(null);
    setSyncLoading(true);
    try {
      const res = await fetch("/api/bank/statement/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accountId: selectedAccountId,
          from: fromDate,
          to: toDate,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSyncMessage(`Збережено транзакцій: ${data.saved}`);
        await loadStatement();
      } else {
        setSyncMessage(data.error || "Помилка синхронізації");
      }
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Помилка мережі");
    } finally {
      setSyncLoading(false);
    }
  };

  const allAccounts = connections.flatMap((c) =>
    c.accounts.map((a) => ({ ...a, connectionName: c.name }))
  );

  return (
    <main style={{ maxWidth: 1000, margin: "32px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 24 }}>
        <Link
          href="/admin"
          style={{ color: "rgba(0,0,0,0.55)", textDecoration: "none", fontSize: 14 }}
        >
          ← Адмін-панель
        </Link>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: "12px 0 0 0" }}>
          Банк
        </h1>
        <p style={{ margin: "8px 0 0 0", color: "rgba(0,0,0,0.55)" }}>
          Підключення рахунків monobank, виписки та вебхуки
        </p>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
          Додати підключення
        </h2>

        {connectError && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 10,
              color: "#b91c1c",
              fontSize: 14,
            }}
          >
            {connectError}
            {(connectError.includes("Увійдіть") || connectError.includes("авторизовано")) && (
              <div style={{ marginTop: 8 }}>
                <Link
                  href="/admin/login"
                  style={{ color: "#b91c1c", fontWeight: 600, textDecoration: "underline" }}
                >
                  Увійти в адмін-панель
                </Link>
              </div>
            )}
          </div>
        )}

        {connectSuccess && (
          <div
            role="status"
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 10,
              color: "#166534",
              fontSize: 14,
            }}
          >
            {connectSuccess}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleConnect();
          }}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>Назва</span>
            <input
              type="text"
              value={connectForm.name}
              onChange={(e) => setConnectForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Monobank"
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e8ebf0",
                minWidth: 160,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
              Токен (з api.monobank.ua)
            </span>
            <input
              type="password"
              value={connectForm.token}
              onChange={(e) => setConnectForm((p) => ({ ...p, token: e.target.value }))}
              placeholder="u_..."
              autoComplete="one-time-code"
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e8ebf0",
                minWidth: 240,
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connectLoading}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "#2a6df5",
              color: "#fff",
              fontWeight: 600,
              cursor: connectLoading ? "wait" : "pointer",
            }}
          >
            {connectLoading ? "Підключення…" : "Підключити"}
          </button>
        </form>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
          Підключення та рахунки
        </h2>
        {connectionsError && (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 10,
              color: "#b91c1c",
              fontSize: 14,
            }}
          >
            {connectionsError}
            <div style={{ marginTop: 8 }}>
              <Link
                href="/admin/login"
                style={{ color: "#b91c1c", fontWeight: 600, textDecoration: "underline" }}
              >
                Увійти в адмін-панель
              </Link>
            </div>
          </div>
        )}
        {connectionsLoading ? (
          <p style={{ color: "rgba(0,0,0,0.55)" }}>Завантаження…</p>
        ) : connections.length === 0 ? (
          <p style={{ color: "rgba(0,0,0,0.55)" }}>
            Немає підключень. Додайте токен вище.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {connections.map((c) => (
              <li
                key={c.id}
                style={{
                  border: "1px solid #e8ebf0",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                {c.clientName && (
                  <div style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
                    {c.clientName}
                  </div>
                )}
                <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: 8 }}>
                  {c.accounts.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "6px 0",
                        fontSize: 14,
                      }}
                    >
                      <span>{a.maskedPan || a.iban || a.externalId}</span>
                      <span>
                        {formatMoney(a.balance)} {a.currencyCode === 980 ? "грн" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
          Виписка
        </h2>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13 }}>Рахунок</span>
            <select
              value={selectedAccountId ?? ""}
              onChange={(e) => setSelectedAccountId(e.target.value || null)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #e8ebf0",
                minWidth: 200,
              }}
            >
              <option value="">— оберіть —</option>
              {allAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.connectionName}: {a.maskedPan || a.iban || a.externalId}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13 }}>З</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #e8ebf0",
              }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13 }}>По</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #e8ebf0",
              }}
            />
          </label>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncLoading || !selectedAccountId}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#f3f5f9",
              color: "#1c2534",
              fontWeight: 600,
              cursor: syncLoading ? "wait" : "pointer",
            }}
          >
            {syncLoading ? "Синхронізація…" : "Підтягнути з API"}
          </button>
        </div>
        {syncMessage && (
          <p style={{ marginBottom: 12, fontSize: 14, color: "rgba(0,0,0,0.7)" }}>
            {syncMessage}
          </p>
        )}

        {statementLoading ? (
          <p style={{ color: "rgba(0,0,0,0.55)" }}>Завантаження виписки…</p>
        ) : statement.length === 0 ? (
          <p style={{ color: "rgba(0,0,0,0.55)" }}>
            Немає транзакцій за обраний період або оберіть рахунок і натисніть «Підтягнути з API».
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "2px solid #e8ebf0", textAlign: "left" }}>
                  <th style={{ padding: "10px 8px" }}>Дата</th>
                  <th style={{ padding: "10px 8px" }}>Опис</th>
                  <th style={{ padding: "10px 8px", textAlign: "right" }}>Сума</th>
                  <th style={{ padding: "10px 8px", textAlign: "right" }}>Баланс</th>
                </tr>
              </thead>
              <tbody>
                {statement.map((it) => (
                  <tr
                    key={it.id}
                    style={{ borderBottom: "1px solid #f0f0f0" }}
                  >
                    <td style={{ padding: "8px" }}>{formatDate(it.time)}</td>
                    <td style={{ padding: "8px" }}>{it.description || "—"}</td>
                    <td
                      style={{
                        padding: "8px",
                        textAlign: "right",
                        color: Number(it.amount) < 0 ? "#c00" : "#0a0",
                      }}
                    >
                      {formatMoney(it.amount)}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {it.balance != null ? formatMoney(it.balance) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
