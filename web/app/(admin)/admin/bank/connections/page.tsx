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
  altegioOpeningBalanceManual?: string | null;
  altegioOpeningBalanceDate?: string | null;
  altegioMonthlyTurnoverManual?: string | null;
  ytdIncomingManualKop?: string | null;
  ytdIncomingManualThroughDate?: string | null;
  fopAnnualTurnoverLimitKop?: string | null;
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

type AcquiringStatementResponse = {
  ok: boolean;
  dateFrom: string;
  dateTo: string;
  from: number;
  to: number;
  connectionName: string;
  accountSuffix: string;
  accountHint: string;
  endpoint: string;
  summary: {
    totalItems: number;
    matchedByAccount: number;
    amountTotal: number;
    profitAmountTotal: number;
  };
  filteredItems: Array<{
    invoiceId?: string;
    status?: string;
    maskedPan?: string;
    date?: string;
    amount?: number;
    profitAmount?: number;
    destination?: string;
    rrn?: string;
    reference?: string;
  }>;
  raw: unknown;
  error?: unknown;
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

  const [reregisteringId, setReregisteringId] = useState<string | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<{
    connectionId: string;
    connectionName: string;
    ourUrl: string;
    monobankStoredUrl: string;
    match: boolean;
  } | null>(null);
  const [webhookStatusLoadingId, setWebhookStatusLoadingId] = useState<string | null>(null);

  const [syncAccountId, setSyncAccountId] = useState<string | null>(null);
  const [webhookLogForConnection, setWebhookLogForConnection] = useState<{
    connectionId: string;
    connectionName: string;
    events: Array<{ receivedAt?: string; type?: string; account?: string; statementId?: string }>;
  } | null>(null);
  const [webhookLogForConnectionLoading, setWebhookLogForConnectionLoading] = useState<string | null>(null);
  const [deletingWebhookId, setDeletingWebhookId] = useState<string | null>(null);
  const [acquiringLoading, setAcquiringLoading] = useState(false);
  const [acquiringError, setAcquiringError] = useState<string | null>(null);
  const [acquiringData, setAcquiringData] = useState<AcquiringStatementResponse | null>(null);

  const loadConnections = async (waitForReplicaSec?: number) => {
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const url =
        waitForReplicaSec != null && waitForReplicaSec > 0
          ? `/api/bank/connections?waitForReplica=${Math.min(10, Math.max(1, waitForReplicaSec))}`
          : "/api/bank/connections";
      const res = await fetch(url, { credentials: "include" });
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
      await loadConnections(3);
      if (selectedAccountId) await loadStatement();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Помилка мережі");
    } finally {
      setSyncLoading(false);
    }
  };

  const loadAcquiringStatement = async () => {
    setAcquiringError(null);
    setAcquiringLoading(true);
    try {
      const res = await fetch("/api/bank/acquiring/statement", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AcquiringStatementResponse> & { error?: unknown };
      if (!res.ok) {
        const errorText =
          typeof data.error === "string"
            ? data.error
            : typeof data.error === "object"
            ? JSON.stringify(data.error)
            : `Помилка запиту (${res.status})`;
        setAcquiringError(errorText);
        setAcquiringData(null);
        return;
      }
      setAcquiringData(data as AcquiringStatementResponse);
    } catch (err) {
      setAcquiringError(err instanceof Error ? err.message : "Помилка мережі");
      setAcquiringData(null);
    } finally {
      setAcquiringLoading(false);
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
        <p
          style={{
            margin: "14px 0 0 0",
            padding: "12px 14px",
            background: "#f5f3ff",
            border: "1px solid #ddd6fe",
            borderRadius: 10,
            fontSize: 13,
            color: "#4c1d95",
            lineHeight: 1.55,
          }}
        >
          <strong>Точка відліку Altegio</strong> (для колонки «Баланс Альтеджіо» у{" "}
          <Link href="/admin/bank" style={{ color: "#5b21b6", fontWeight: 600 }}>
            таблиці Банк
          </Link>
          ): для кожного гривневого ФОП вкажіть у{" "}
          <Link href="/admin/altegio#bank-altegio-anchor" style={{ color: "#5b21b6", fontWeight: 600 }}>
            Altegio → Банк ↔ Altegio
          </Link>{" "}
          залишок грошового рахунку з Altegio та дату.           Дата — початок дня відліку; далі оцінка балансу = ця сума + усі рухи Monobank після неї (поки немає знімка з вебхука).
          Також можна ввести <strong>надходження з 1-го числа місяця</strong> на кінець того ж дня та <strong>річний ліміт</strong> — у таблиці «Банк» будуть «Надх. міс.» і «Залишок рік».
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
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        setWebhookLogForConnectionLoading(c.id);
                        setWebhookLogForConnection(null);
                        try {
                          const res = await fetch("/api/bank/monobank/webhook/log", { credentials: "include" });
                          const data = await res.json().catch(() => ({}));
                          if (data.ok && Array.isArray(data.events)) {
                            const externalIds = new Set(c.accounts.map((a) => a.externalId));
                            const filtered = data.events.filter((e) => e.account != null && externalIds.has(String(e.account)));
                            setWebhookLogForConnection({
                              connectionId: c.id,
                              connectionName: c.name,
                              events: filtered,
                            });
                          }
                        } finally {
                          setWebhookLogForConnectionLoading(null);
                        }
                      }}
                      disabled={webhookLogForConnectionLoading === c.id}
                      style={{
                        padding: "6px 12px",
                        fontSize: 13,
                        borderRadius: 8,
                        border: "1px solid #d1d5db",
                        background: webhookLogForConnectionLoading === c.id ? "#e5e7eb" : "#f9fafb",
                        cursor: webhookLogForConnectionLoading === c.id ? "wait" : "pointer",
                      }}
                    >
                      {webhookLogForConnectionLoading === c.id ? "Завантаження…" : "Останні вебхуки"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setWebhookStatusLoadingId(c.id);
                        setWebhookStatus(null);
                        try {
                          const res = await fetch(`/api/bank/monobank/webhook/status?connectionId=${encodeURIComponent(c.id)}`, { credentials: "include" });
                          const data = await res.json().catch(() => ({}));
                          if (data.ok)
                            setWebhookStatus({
                              connectionId: c.id,
                              connectionName: c.name,
                              ourUrl: data.ourUrl ?? "",
                              monobankStoredUrl: data.monobankStoredUrl ?? "",
                              match: data.match === true,
                            });
                          else setWebhookStatus({ connectionId: c.id, connectionName: c.name, ourUrl: "", monobankStoredUrl: "", match: false });
                        } finally {
                          setWebhookStatusLoadingId(null);
                        }
                      }}
                      disabled={webhookStatusLoadingId === c.id}
                      style={{
                        padding: "6px 12px",
                        fontSize: 13,
                        borderRadius: 8,
                        border: "1px solid #d1d5db",
                        background: webhookStatusLoadingId === c.id ? "#e5e7eb" : "#fff",
                        cursor: webhookStatusLoadingId === c.id ? "wait" : "pointer",
                      }}
                    >
                      {webhookStatusLoadingId === c.id ? "Завантаження…" : "Що збережено"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setReregisteringId(c.id);
                        setWebhookStatus(null);
                        try {
                          const res = await fetch("/api/bank/monobank/reregister-webhook", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ connectionId: c.id }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (data.ok) {
                            setWebhookStatus({
                              connectionId: c.id,
                              connectionName: c.name,
                              ourUrl: data.webhookUrl ?? "",
                              monobankStoredUrl: data.monobankStoredUrl ?? "",
                              match: data.match === true,
                            });
                          } else alert(data.error || "Помилка");
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
                      {reregisteringId === c.id ? "Реєстрація…" : "Повторно зареєструвати"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm("Вимкнути вебхук в Monobank для цього підключення?")) return;
                        setDeletingWebhookId(c.id);
                        setWebhookStatus(null);
                        try {
                          const res = await fetch("/api/bank/monobank/delete-webhook", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ connectionId: c.id }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (data.ok) {
                            setWebhookStatus({
                              connectionId: c.id,
                              connectionName: c.name,
                              ourUrl: "",
                              monobankStoredUrl: "",
                              match: false,
                            });
                            loadConnections();
                          } else alert(data.error || "Помилка");
                        } finally {
                          setDeletingWebhookId(null);
                        }
                      }}
                      disabled={deletingWebhookId !== null}
                      style={{
                        padding: "6px 12px",
                        fontSize: 13,
                        borderRadius: 8,
                        border: "1px solid #d1d5db",
                        background: deletingWebhookId === c.id ? "#e5e7eb" : "#fff",
                        color: "#6b7280",
                        cursor: deletingWebhookId !== null ? "not-allowed" : "pointer",
                      }}
                    >
                      {deletingWebhookId === c.id ? "Вимкнення…" : "Вимкнути вебхук"}
                    </button>
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
                </div>
                <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {c.accounts.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        padding: "8px 0",
                        fontSize: 14,
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
                      <button
                        type="button"
                        onClick={async () => {
                          setSyncAccountId(a.id);
                          setSyncMessage(null);
                          try {
                            const res = await fetch("/api/bank/statement/sync", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({ accountId: a.id, from: fromDate, to: toDate }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (data.ok) {
                              const saved = data.saved ?? 0;
                              setSyncMessage(`Рахунок ${a.maskedPan || a.externalId}: збережено ${saved} транзакцій`);
                              await loadConnections(3);
                              if (Array.isArray(data.items)) {
                                setSelectedAccountId(a.id);
                                setStatement(data.items);
                              }
                              if (saved === 0) {
                                alert("Збережено 0 нових транзакцій. Баланс оновлено з Monobank. Якщо очікували операції — перевірте період (З/По) внизу або зачекайте 60 с і спробуйте знову (ліміт API).");
                              }
                            } else {
                              setSyncMessage(data.error || "Помилка синхронізації");
                              alert(data.error || "Помилка синхронізації");
                            }
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : "Помилка мережі";
                            setSyncMessage(msg);
                            alert(msg);
                          } finally {
                            setSyncAccountId(null);
                          }
                        }}
                        disabled={syncAccountId !== null}
                        style={{
                          padding: "4px 10px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          background: syncAccountId === a.id ? "#e5e7eb" : "#fff",
                          cursor: syncAccountId !== null ? "not-allowed" : "pointer",
                          marginLeft: "auto",
                        }}
                      >
                        {syncAccountId === a.id ? "Синхронізація…" : "Підтягнути з API"}
                      </button>
                      </div>
                      {a.currencyCode === 980 ? (
                        a.altegioOpeningBalanceManual != null && a.altegioOpeningBalanceDate ? (
                          <div style={{ fontSize: 12, color: "#5b21b6", paddingLeft: 4 }}>
                            Точка відліку Altegio:{" "}
                            <strong>{formatMoney(a.altegioOpeningBalanceManual)}</strong> від{" "}
                            {new Date(a.altegioOpeningBalanceDate).toLocaleDateString("uk-UA")}{" "}
                            ·{" "}
                            <Link href="/admin/altegio#bank-altegio-anchor" style={{ color: "#5b21b6", fontWeight: 600 }}>
                              змінити
                            </Link>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#9ca3af", paddingLeft: 4 }}>
                            Точку відліку Altegio не задано —{" "}
                            <Link href="/admin/altegio#bank-altegio-anchor" style={{ color: "#6d28d9" }}>
                              додати в Altegio → Банк ↔ Altegio
                            </Link>
                          </div>
                        )
                      ) : null}
                      {a.currencyCode === 980 &&
                      (a.altegioMonthlyTurnoverManual != null ||
                        a.ytdIncomingManualKop != null ||
                        a.fopAnnualTurnoverLimitKop != null) ? (
                        <div style={{ fontSize: 12, color: "#374151", paddingLeft: 4 }}>
                          {a.altegioMonthlyTurnoverManual != null ? (
                            <span>
                              Оборот міс. (на дату): <strong>{formatMoney(a.altegioMonthlyTurnoverManual)}</strong> грн ·{" "}
                            </span>
                          ) : null}
                          {a.ytdIncomingManualKop != null ? (
                            <span>
                              YTD ручне: <strong>{formatMoney(a.ytdIncomingManualKop)}</strong> грн
                              {a.ytdIncomingManualThroughDate
                                ? ` до ${a.ytdIncomingManualThroughDate.slice(0, 10)} · `
                                : " · "}
                            </span>
                          ) : null}
                          {a.fopAnnualTurnoverLimitKop != null ? (
                            <span>
                              Ліміт рік: <strong>{formatMoney(a.fopAnnualTurnoverLimitKop)}</strong> грн
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
              ))}
            </ul>
                {webhookStatus?.connectionId === c.id && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      fontSize: 13,
                      background: webhookStatus.match ? "#f0fdf4" : "#fef2f2",
                      border: `1px solid ${webhookStatus.match ? "#bbf7d0" : "#fecaca"}`,
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Що збережено в Monobank</div>
                    <div style={{ marginBottom: 4 }}>
                      <strong>Наш URL:</strong>
                      <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", marginTop: 2 }}>{webhookStatus.ourUrl || "—"}</div>
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <strong>В Monobank:</strong>
                      <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", marginTop: 2 }}>
                        {webhookStatus.monobankStoredUrl || "(порожньо)"}
                      </div>
                    </div>
                    {!webhookStatus.match && (
                      <p style={{ color: "#b91c1c", marginTop: 8 }}>
                        URL не збігаються. Натисніть «Повторно зареєструвати», потім зробіть реальну операцію по картці (оплата, переказ, поповнення) — Monobank надішле подію на наш сервер.
                      </p>
                    )}
                  </div>
                )}
                {webhookLogForConnection?.connectionId === c.id && (
                  <div style={{ marginTop: 12, padding: 12, background: "#f9fafb", border: "1px solid #e8ebf0", borderRadius: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Останні вебхуки</div>
                    {webhookLogForConnection.events.length === 0 ? (
                      <p style={{ color: "rgba(0,0,0,0.6)" }}>Подій по рахунках цього підключення немає.</p>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                            <th style={{ textAlign: "left", padding: "4px 8px" }}>Час</th>
                            <th style={{ textAlign: "left", padding: "4px 8px" }}>Тип</th>
                            <th style={{ textAlign: "left", padding: "4px 8px" }}>Рахунок</th>
                            <th style={{ textAlign: "left", padding: "4px 8px" }}>ID транзакції</th>
                          </tr>
                        </thead>
                        <tbody>
                          {webhookLogForConnection.events.slice(0, 30).map((e, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                              <td style={{ padding: "4px 8px" }}>{e.receivedAt ?? "—"}</td>
                              <td style={{ padding: "4px 8px" }}>{e.type ?? "—"}</td>
                              <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{e.account ?? "—"}</td>
                              <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 11 }}>{e.statementId ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
          </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
          Acquiring (01.03–17.03.2026, рахунок …9085)
        </h2>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <button
            type="button"
            onClick={loadAcquiringStatement}
            disabled={acquiringLoading}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#f3f5f9",
              color: "#1c2534",
              fontWeight: 600,
              cursor: acquiringLoading ? "wait" : "pointer",
            }}
          >
            {acquiringLoading ? "Отримання acquiring-виписки…" : "Отримати acquiring-виписку"}
          </button>
          <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
            Підключення: Жалівців Олександра, період: 01.03.26 – 17.03.26
          </span>
        </div>
        {acquiringError && (
          <p style={{ marginBottom: 12, fontSize: 14, color: "#b91c1c" }}>
            {acquiringError}
          </p>
        )}
        {acquiringData && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ marginBottom: 8, fontSize: 13, color: "rgba(0,0,0,0.75)" }}>
              Endpoint: <span style={{ fontFamily: "monospace" }}>{acquiringData.endpoint}</span>
            </p>
            <p style={{ marginBottom: 12, fontSize: 13, color: "rgba(0,0,0,0.75)" }}>
              Рахунок: <span style={{ fontFamily: "monospace" }}>{acquiringData.accountHint}</span>, всього транзакцій:{" "}
              <b>{acquiringData.summary.totalItems}</b>, збіг по …9085:{" "}
              <b>{acquiringData.summary.matchedByAccount}</b>, сума:{" "}
              <b>{(acquiringData.summary.amountTotal / 100).toFixed(2)} грн</b>, net:{" "}
              <b>{(acquiringData.summary.profitAmountTotal / 100).toFixed(2)} грн</b>
            </p>

            {acquiringData.filteredItems.length > 0 && (
              <div style={{ overflowX: "auto", width: "100%", marginBottom: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e8ebf0", textAlign: "left" }}>
                      <th style={{ padding: "8px" }}>Дата</th>
                      <th style={{ padding: "8px" }}>Статус</th>
                      <th style={{ padding: "8px" }}>Картка</th>
                      <th style={{ padding: "8px" }}>Invoice</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>Сума</th>
                      <th style={{ padding: "8px", textAlign: "right" }}>Net</th>
                      <th style={{ padding: "8px" }}>Призначення</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acquiringData.filteredItems.map((it, idx) => (
                      <tr key={`${it.invoiceId ?? "invoice"}-${idx}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "8px" }}>{it.date ? new Date(it.date).toLocaleString("uk-UA") : "—"}</td>
                        <td style={{ padding: "8px" }}>{it.status ?? "—"}</td>
                        <td style={{ padding: "8px", fontFamily: "monospace" }}>{it.maskedPan ?? "—"}</td>
                        <td style={{ padding: "8px", fontFamily: "monospace", fontSize: 12 }}>{it.invoiceId ?? "—"}</td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          {typeof it.amount === "number" ? `${(it.amount / 100).toFixed(2)} грн` : "—"}
                        </td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          {typeof it.profitAmount === "number" ? `${(it.profitAmount / 100).toFixed(2)} грн` : "—"}
                        </td>
                        <td style={{ padding: "8px" }}>{it.destination ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#111827" }}>
                Raw відповідь (санітизована)
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 8,
                  background: "#0b1020",
                  color: "#dbe7ff",
                  fontSize: 12,
                  overflowX: "auto",
                  lineHeight: 1.45,
                }}
              >
                {JSON.stringify(acquiringData.raw, null, 2)}
              </pre>
            </details>
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
          <div style={{ overflowX: "auto", width: "80%", margin: "0 auto" }}>
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
