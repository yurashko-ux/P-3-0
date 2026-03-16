// web/app/(admin)/admin/bank/page.tsx
// Розділ Банк: головна сторінка — таблиця банківських операцій

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type BankConnection = {
  id: string;
  provider: string;
  name: string;
  clientName: string | null;
  webhookUrl: string | null;
  createdAt: string;
  accounts: { id: string; externalId: string; balance: string; currencyCode: number; type: string | null; iban: string | null; maskedPan: string | null }[];
};

type OperationItem = {
  id: string;
  time: string;
  amount: string;
  balance: string | null;
  description: string;
  owner: string;
  connectionId: string;
  accountId: string;
  accountLast4?: string;
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

function getCurrentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function BankPage() {
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [connectionId, setConnectionId] = useState<string>("");
  const [fromDate, setFromDate] = useState(() => getCurrentMonthRange().from);
  const [toDate, setToDate] = useState(() => getCurrentMonthRange().to);

  const loadConnections = async () => {
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      const res = await fetch("/api/bank/connections", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setConnectionsError("Увійдіть в адмін-панель.");
        setConnections([]);
      } else if (data.ok && Array.isArray(data.connections)) {
        setConnections(data.connections);
      }
    } finally {
      setConnectionsLoading(false);
    }
  };

  const loadOperations = async () => {
    setOperationsLoading(true);
    try {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
        direction,
      });
      if (connectionId) params.set("connectionId", connectionId);
      const res = await fetch(`/api/bank/operations?${params}`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (data.ok && Array.isArray(data.items)) {
        setOperations(data.items);
      } else {
        setOperations([]);
      }
    } finally {
      setOperationsLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    loadOperations();
  }, [fromDate, toDate, direction, connectionId]);

  const setCurrentMonth = () => {
    const { from, to } = getCurrentMonthRange();
    setFromDate(from);
    setToDate(to);
  };

  return (
    <main style={{ maxWidth: 1100, margin: "32px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
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
            Банківські операції
          </p>
        </div>
        <Link
          href="/admin/bank/connections"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 12,
            border: "2px solid #2a6df5",
            background: "#fff",
            color: "#2a6df5",
            fontSize: 24,
            fontWeight: 700,
            textDecoration: "none",
            cursor: "pointer",
          }}
          title="Додати підключення"
        >
          +
        </Link>
      </header>

      {connectionsError && (
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
          {connectionsError}
          <div style={{ marginTop: 8 }}>
            <Link href="/admin/login" style={{ color: "#b91c1c", fontWeight: 600, textDecoration: "underline" }}>
              Увійти в адмін-панель
            </Link>
          </div>
        </div>
      )}

      {!connectionsLoading && connections.length === 0 && (
        <p style={{ marginBottom: 16, color: "rgba(0,0,0,0.6)" }}>
          Немає підключень.{" "}
          <Link href="/admin/bank/connections" style={{ color: "#2a6df5", fontWeight: 600 }}>
            Додати підключення
          </Link>
        </p>
      )}

      <section style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>Тип:</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "in", "out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: direction === d ? "2px solid #2a6df5" : "1px solid #e8ebf0",
                  background: direction === d ? "#eff6ff" : "#fff",
                  color: direction === d ? "#2a6df5" : "#1c2534",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {d === "all" ? "Всі" : d === "in" ? "Вхідні" : "Вихідні"}
              </button>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>Власник:</span>
            <select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #e8ebf0",
                minWidth: 180,
                fontSize: 14,
              }}
            >
              <option value="">Усі</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientName ?? c.name}
                </option>
              ))}
            </select>
          </label>

          <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)", marginLeft: 8 }}>Дата:</span>
          <button
            type="button"
            onClick={setCurrentMonth}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #e8ebf0",
              background: "#f3f5f9",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Поточний місяць
          </button>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e8ebf0" }}
          />
          <span style={{ fontSize: 13 }}>—</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e8ebf0" }}
          />
        </div>
      </section>

      {operationsLoading ? (
        <p style={{ color: "rgba(0,0,0,0.55)" }}>Завантаження операцій…</p>
      ) : operations.length === 0 ? (
        <p style={{ color: "rgba(0,0,0,0.55)" }}>
          Немає операцій за обраний період або додайте підключення та підтягніть виписку на сторінці підключень.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
              border: "1px solid #e8ebf0",
              borderRadius: 12,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #e8ebf0", textAlign: "left", background: "#f9fafb" }}>
                <th style={{ padding: "10px 12px" }}>Дата</th>
                <th style={{ padding: "10px 12px" }}>Тип платежу</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Сума грн.</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Баланс</th>
                <th style={{ padding: "10px 12px" }}>Номер рахунку</th>
                <th style={{ padding: "10px 12px" }}>Власник рахунку</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((it) => {
                const isIn = Number(it.amount) > 0;
                return (
                  <tr key={it.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px" }}>{formatDate(it.time)}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            color: isIn ? "#16a34a" : "#dc2626",
                            fontWeight: 700,
                            fontSize: 16,
                          }}
                        >
                          {isIn ? "↓" : "↑"}
                        </span>
                        <span style={{ color: isIn ? "#16a34a" : "#dc2626", fontSize: 13 }}>
                          {isIn ? "Вхідний платіж" : "Вихідний платіж"}
                        </span>
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        color: isIn ? "#16a34a" : "#dc2626",
                        fontWeight: 600,
                      }}
                    >
                      {formatMoney(it.amount)} грн
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {it.balance != null ? `${formatMoney(it.balance)} грн` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{it.accountLast4 ?? "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{it.owner}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
