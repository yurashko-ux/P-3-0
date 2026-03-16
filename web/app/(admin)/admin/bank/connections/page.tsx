// web/app/(admin)/admin/bank/connections/page.tsx
// Сторінка підключень: додати підключення, список підключень, виписка по рахунку

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
  includeInOperationsTable?: boolean;
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

function currencyLabel(currencyCode: number | undefined): string {
  if (currencyCode === 980) return "грн";
  if (currencyCode === 840) return "USD";
  if (currencyCode != null) return `код ${currencyCode}`;
  return "грн";
}

export default function BankConnectionsPage() {
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
  const [deleteConnectionId, setDeleteConnectionId] = useState<string | null>(null);

  const [webhookLog, setWebhookLog] = useState<{ count: number; events: Array<{ receivedAt?: string; type?: string; account?: string; statementId?: string }>; hint?: string } | null>(null);
  const [webhookLogLoading, setWebhookLogLoading] = useState(false);
  const [reregisteringId, setReregisteringId] = useState<string | null>(null);

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
        setConnections((prev) =>
          data.connections.length > 0 ? data.connections : prev.length > 0 ? prev : data.connections
        );
        const list = data.connections.length > 0 ? data.connections : [];
        if (list.length > 0 && !selectedAccountId && list[0]?.accounts?.[0]?.id) {
          setSelectedAccountId(list[0].accounts[0].id);
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
    try {
      const res = await fetch("/api/bank/monobank/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: connectForm.name.trim() || "Monobank", token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setConnectError("Увійдіть в адмін-панель.");
      } else if (data.ok) {
        setConnectForm((prev) => ({ ...prev, token: "" }));
        setConnectSuccess("Підключення додано");
        setTimeout(() => setConnectSuccess(null), 4000);
        const conn = data.connection;
        const accounts = Array.isArray(data.accounts) ? data.accounts : [];
        if (conn && conn.id) {
          const newConnection: BankConnection = {
            id: conn.id,
            provider: conn.provider ?? "monobank",
            name: conn.name ?? "Monobank",
            clientName: conn.clientName ?? null,
            webhookUrl: conn.webhookUrl ?? null,
            createdAt: new Date().toISOString(),
            accounts: accounts.map((a: { id: string; externalId: string; balance: string; currencyCode?: number; type?: string | null; iban?: string | null; maskedPan?: string | null }) => ({
              id: a.id,
              externalId: a.externalId,
              balance: a.balance,
              currencyCode: a.currencyCode ?? 980,
              type: a.type ?? null,
              iban: a.iban ?? null,
              maskedPan: a.maskedPan ?? null,
            })),
          };
          setConnections((prev) => [newConnection, ...prev]);
          if (!selectedAccountId && newConnection.accounts[0]?.id) {
            setSelectedAccountId(newConnection.accounts[0].id);
          }
        }
        loadConnections();
      } else {
        setConnectError(data.error || "Помилка підключення");
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Помилка мережі");
    } finally {
      setConnectLoading(false);
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    if (!confirm("Видалити це підключення та всі його рахунки й виписки?")) return;
    setDeleteConnectionId(connectionId);
    try {
      const res = await fetch("/api/bank/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: connectionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const deletedConnection = connections.find((c) => c.id === connectionId);
        const hadSelectedAccount =
          deletedConnection?.accounts.some((a) => a.id === selectedAccountId) ?? false;
        const remaining = connections.filter((c) => c.id !== connectionId);
        setConnections(remaining);
        if (hadSelectedAccount) {
          setStatement([]);
          setSelectedAccountId(remaining[0]?.accounts?.[0]?.id ?? null);
        }
      } else {
        alert(data.error || "Помилка видалення");
      }
    } finally {
      setDeleteConnectionId(null);
    }
  };

  // Рахунки з галочкою «Показувати в таблиці Банк» — їх синхронізуємо кнопкою «Підтягнути з API»
  const accountsToSync = connections.flatMap((c) =>
    c.accounts
      .filter((a) => a.includeInOperationsTable !== false)
      .map((a) => ({ id: a.id, label: a.maskedPan || a.iban || a.externalId || a.id }))
  );

  const handleSync = async () => {
    if (accountsToSync.length === 0) return;
    setSyncMessage(null);
    setSyncLoading(true);
    let totalSaved = 0;
    let done = 0;
    let errors: string[] = [];
    try {
      for (let i = 0; i < accountsToSync.length; i++) {
        const acc = accountsToSync[i];
        setSyncMessage(`Синхронізація рахунку ${i + 1}/${accountsToSync.length}…`);
        const res = await fetch("/api/bank/statement/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            accountId: acc.id,
            from: fromDate,
            to: toDate,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          totalSaved += data.saved ?? 0;
          if (selectedAccountId === acc.id && Array.isArray(data.items)) {
            setStatement(data.items);
          }
        } else {
          errors.push(`${acc.label}: ${data.error || "помилка"}`);
        }
        done++;
      }
      if (errors.length > 0) {
        setSyncMessage(`Синхронізовано ${done} рахунків, збережено ${totalSaved} транзакцій. Помилки: ${errors.join("; ")}`);
      } else {
        setSyncMessage(`Синхронізовано ${done} рахунків. Збережено транзакцій: ${totalSaved}`);
      }
      if (selectedAccountId) await loadStatement();
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
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <Link
            href="/admin/bank"
            style={{ color: "rgba(0,0,0,0.55)", textDecoration: "none", fontSize: 14 }}
          >
            ← Банк
          </Link>
          <Link
            href="/admin"
            style={{ color: "rgba(0,0,0,0.55)", textDecoration: "none", fontSize: 14 }}
          >
            ← Адмін-панель
          </Link>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: "0" }}>
          Підключення
        </h1>
        <p style={{ margin: "8px 0 0 0", color: "rgba(0,0,0,0.55)" }}>
          Додати підключення та рахунки monobank, виписка по рахунку
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
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {c.clientName && (
                      <div style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
                        {c.clientName}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteConnection(c.id)}
                    disabled={deleteConnectionId === c.id}
                    style={{
                      padding: "6px 12px",
                      fontSize: 13,
                      color: "#b91c1c",
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: 8,
                      cursor: deleteConnectionId === c.id ? "not-allowed" : "pointer",
                    }}
                  >
                    {deleteConnectionId === c.id ? "Видалення…" : "Видалити"}
                  </button>
                </div>
                <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {c.accounts.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 0",
                        fontSize: 14,
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={a.includeInOperationsTable !== false}
                          onChange={async (e) => {
                            const checked = e.target.checked;
                            try {
                              const res = await fetch(`/api/bank/accounts/${a.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                                body: JSON.stringify({ includeInOperationsTable: checked }),
                              });
                              const data = await res.json().catch(() => ({}));
                              if (res.ok && data.ok) {
                                setConnections((prev) =>
                                  prev.map((conn) =>
                                    conn.id === c.id
                                      ? {
                                          ...conn,
                                          accounts: conn.accounts.map((acc) =>
                                            acc.id === a.id
                                              ? { ...acc, includeInOperationsTable: checked }
                                              : acc
                                          ),
                                        }
                                      : conn
                                  )
                                );
                              }
                            } catch {
                              // ігноруємо помилку мережі
                            }
                          }}
                        />
                        <span style={{ color: "rgba(0,0,0,0.7)" }}>
                          Показувати в таблиці Банк
                        </span>
                      </label>
                      <span>{a.maskedPan || a.iban || a.externalId}</span>
                      <span>
                        {formatMoney(a.balance)} {a.currencyCode === 980 ? "грн" : a.currencyCode === 840 ? "USD" : `код ${a.currencyCode}`}
                      </span>
                    </li>
              ))}
            </ul>
          </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          Діагностика вебхука
        </h2>
        <p style={{ fontSize: 13, color: "rgba(0,0,0,0.65)", marginBottom: 12 }}>
          Якщо операції не зʼявляються в таблиці автоматично, перевірте, чи надходять події від Monobank. Відповідь сервера має бути протягом 5 с, інакше після 3 невдач вебхук вимикається — натисніть «Повторно зареєструвати».
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button
            type="button"
            onClick={async () => {
              setWebhookLogLoading(true);
              setWebhookLog(null);
              try {
                const res = await fetch("/api/bank/monobank/webhook/log", { credentials: "include" });
                const data = await res.json().catch(() => ({}));
                if (data.ok) setWebhookLog({ count: data.count, events: data.events || [], hint: data.hint });
              } finally {
                setWebhookLogLoading(false);
              }
            }}
            disabled={webhookLogLoading}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #e8ebf0",
              background: "#f9fafb",
              fontWeight: 600,
              cursor: webhookLogLoading ? "wait" : "pointer",
            }}
          >
            {webhookLogLoading ? "Завантаження…" : "Останні події вебхука"}
          </button>
          {connections.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={async () => {
                setReregisteringId(c.id);
                try {
                  const res = await fetch("/api/bank/monobank/reregister-webhook", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ connectionId: c.id }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (data.ok) alert("Вебхук повторно зареєстровано: " + (data.webhookUrl || ""));
                  else alert(data.error || "Помилка");
                } finally {
                  setReregisteringId(null);
                }
              }}
              disabled={reregisteringId !== null}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                borderRadius: 8,
                border: "1px solid #d1d5db",
                background: reregisteringId === c.id ? "#e5e7eb" : "#fff",
                cursor: reregisteringId !== null ? "not-allowed" : "pointer",
              }}
            >
              {reregisteringId === c.id ? "Реєстрація…" : `Повторно зареєструвати (${c.name})`}
            </button>
          ))}
        </div>
        {webhookLog && (
          <div style={{ fontSize: 13, background: "#f9fafb", border: "1px solid #e8ebf0", borderRadius: 8, padding: 12 }}>
            <div style={{ marginBottom: 8 }}>Подій: {webhookLog.count}. {webhookLog.hint}</div>
            {webhookLog.events.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Час</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Тип</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Рахунок (externalId)</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>ID транзакції</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookLog.events.slice(0, 20).map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "4px 8px" }}>{e.receivedAt ?? "—"}</td>
                      <td style={{ padding: "4px 8px" }}>{e.type ?? "—"}</td>
                      <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{e.account ?? "—"}</td>
                      <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 11 }}>{e.statementId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: "rgba(0,0,0,0.6)" }}>Подій немає. Зробіть операцію по картці та натисніть «Останні події» знову через хвилину.</p>
            )}
          </div>
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
            disabled={syncLoading || accountsToSync.length === 0}
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
            {syncLoading ? "Синхронізація…" : `Підтягнути з API (${accountsToSync.length} рахунків)`}
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
            Немає транзакцій за обраний період. Оберіть рахунок для перегляду або натисніть «Підтягнути з API» (синхронізує рахунки з галочкою «Показувати в таблиці Банк»).
          </p>
        ) : (
          (() => {
            const selectedAccount = connections
              .flatMap((c) => c.accounts)
              .find((a) => a.id === selectedAccountId);
            const stmtCurrency = selectedAccount?.currencyCode;
            return (
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
                      {formatMoney(it.amount)} {currencyLabel(stmtCurrency)}
                    </td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {it.balance != null ? `${formatMoney(it.balance)} ${currencyLabel(stmtCurrency)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            );
          })()
        )}
      </section>
    </main>
  );
}
