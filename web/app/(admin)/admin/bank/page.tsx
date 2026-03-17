// web/app/(admin)/admin/bank/page.tsx
// Розділ Банк: головна сторінка — таблиця банківських операцій

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  comment: string | null;
  counterName: string | null;
  owner: string;
  connectionId: string;
  accountId: string;
  accountLast4?: string;
  currencyCode?: number;
};

function formatMoney(kopiykas: string): string {
  const n = Number(kopiykas) / 100;
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatMoneyRounded(kopiykas: string): string {
  const n = Math.round(Number(kopiykas) / 100);
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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

function getFopLabel(owner: string, accountLast4?: string): string {
  const surname = owner.trim().split(/\s+/)[0] || "—";
  const last4 = accountLast4 || "—";
  if (surname === "—" && last4 === "—") return "—";
  return `${surname} (${last4})`;
}

function accountKey(item: Pick<OperationItem, "connectionId" | "accountId">): string {
  return `${item.connectionId}:${item.accountId}`;
}

type SortBy = "time" | "type" | "fop" | "amount" | "balance";

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

  const [dateFrom, setDateFrom] = useState(() => getCurrentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => getCurrentMonthRange().to);
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all");
  const [selectedAccountKeys, setSelectedAccountKeys] = useState<string[]>([]);
  const [isFopFilterOpen, setIsFopFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("time");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

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
        from: dateFrom,
        to: dateTo,
        direction: "all",
      });
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
  }, [dateFrom, dateTo]);

  const setCurrentMonth = () => {
    const { from, to } = getCurrentMonthRange();
    setDateFrom(from);
    setDateTo(to);
  };

  const setToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    setDateFrom(today);
    setDateTo(today);
  };

  const fopOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; balance: string | null }>();
    for (const op of operations) {
      const key = accountKey(op);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: getFopLabel(op.owner, op.accountLast4),
          balance: op.balance,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "uk-UA"));
  }, [operations]);

  const filteredAndSortedOperations = useMemo(() => {
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    const filtered = operations.filter((op) => {
      const opTs = new Date(op.time).getTime();
      if (fromTs != null && opTs < fromTs) return false;
      if (toTs != null && opTs > toTs) return false;
      if (typeFilter === "in" && Number(op.amount) <= 0) return false;
      if (typeFilter === "out" && Number(op.amount) >= 0) return false;
      if (selectedAccountKeys.length > 0 && !selectedAccountKeys.includes(accountKey(op))) return false;
      return true;
    });

    const dir = sortOrder === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sortBy === "time") return (new Date(a.time).getTime() - new Date(b.time).getTime()) * dir;
      if (sortBy === "type") {
        const av = Number(a.amount) > 0 ? 1 : -1;
        const bv = Number(b.amount) > 0 ? 1 : -1;
        return (av - bv) * dir;
      }
      if (sortBy === "fop") return getFopLabel(a.owner, a.accountLast4).localeCompare(getFopLabel(b.owner, b.accountLast4), "uk-UA") * dir;
      if (sortBy === "amount") return (Number(a.amount) - Number(b.amount)) * dir;
      const ab = a.balance != null ? Number(a.balance) : Number.NEGATIVE_INFINITY;
      const bb = b.balance != null ? Number(b.balance) : Number.NEGATIVE_INFINITY;
      return (ab - bb) * dir;
    });
    return filtered;
  }, [operations, dateFrom, dateTo, typeFilter, selectedAccountKeys, sortBy, sortOrder]);

  const toggleSort = (key: SortBy) => {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(key);
    setSortOrder("desc");
  };

  const toggleAccountFilter = (key: string) => {
    setSelectedAccountKeys((prev) => (prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]));
  };

  const sortMark = (key: SortBy) => (sortBy === key ? (sortOrder === "asc" ? "↑" : "↓") : "");

  return (
    <main style={{ margin: "32px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: 24 }}>
        <nav
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 12,
            padding: "8px 10px",
            border: "1px solid #e8ebf0",
            borderRadius: 10,
            background: "#f9fafb",
            width: "fit-content",
          }}
        >
          <Link
            href="/admin"
            style={{ color: "rgba(0,0,0,0.65)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}
          >
            ← Адмін-панель
          </Link>
          <Link
            href="/admin/bank/connections"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid #2a6df5",
              background: "#fff",
              color: "#2a6df5",
              fontSize: 20,
              fontWeight: 700,
              textDecoration: "none",
              cursor: "pointer",
              lineHeight: 1,
            }}
            title="Додати підключення"
          >
            +
          </Link>
        </nav>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: "0" }}>
          Банк
        </h1>
        <p style={{ margin: "8px 0 0 0", color: "rgba(0,0,0,0.55)" }}>
          Банківські операції
        </p>
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

      {operationsLoading ? (
        <p style={{ color: "rgba(0,0,0,0.55)" }}>Завантаження операцій…</p>
      ) : filteredAndSortedOperations.length === 0 ? (
        <p style={{ color: "rgba(0,0,0,0.55)" }}>
          Немає операцій за обраними фільтрами.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              fontSize: 14,
              border: "1px solid #e8ebf0",
              borderRadius: 12,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #e8ebf0", textAlign: "left", background: "#f9fafb" }}>
                <th style={{ padding: "10px 12px", minWidth: 230 }}>
                  <button type="button" onClick={() => toggleSort("time")} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 700 }}>
                    Дата {sortMark("time")}
                  </button>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }} />
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }} />
                    <button type="button" onClick={setToday} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 12 }}>Сьогодні</button>
                    <button type="button" onClick={setCurrentMonth} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 12 }}>Поточний місяць</button>
                  </div>
                </th>
                <th style={{ padding: "10px 12px", width: 84 }}>
                  <button type="button" onClick={() => toggleSort("type")} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 700 }}>
                    Тип {sortMark("type")}
                  </button>
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    <button type="button" onClick={() => setTypeFilter("all")} style={{ padding: "4px 6px", borderRadius: 6, border: typeFilter === "all" ? "2px solid #2563eb" : "1px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer" }}>↑↓</button>
                    <button type="button" onClick={() => setTypeFilter("in")} style={{ padding: "4px 6px", borderRadius: 6, border: typeFilter === "in" ? "2px solid #2563eb" : "1px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer", color: "#16a34a", fontWeight: 700 }}>↓</button>
                    <button type="button" onClick={() => setTypeFilter("out")} style={{ padding: "4px 6px", borderRadius: 6, border: typeFilter === "out" ? "2px solid #2563eb" : "1px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer", color: "#dc2626", fontWeight: 700 }}>↑</button>
                  </div>
                </th>
                <th style={{ padding: "10px 12px", width: 210, position: "relative" }}>
                  <button type="button" onClick={() => toggleSort("fop")} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 700 }}>
                    ФОП {sortMark("fop")}
                  </button>
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => setIsFopFilterOpen((v) => !v)}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 12 }}
                    >
                      {selectedAccountKeys.length > 0 ? `Обрано: ${selectedAccountKeys.length}` : "Усі рахунки"}
                    </button>
                  </div>
                  {isFopFilterOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: 62,
                        left: 12,
                        zIndex: 20,
                        width: 300,
                        maxHeight: 260,
                        overflowY: "auto",
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        background: "#fff",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                        padding: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <button type="button" onClick={() => setSelectedAccountKeys([])} style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 12 }}>
                          Скинути
                        </button>
                        <button type="button" onClick={() => setIsFopFilterOpen(false)} style={{ border: "none", background: "transparent", color: "#6b7280", cursor: "pointer", fontSize: 12 }}>
                          Закрити
                        </button>
                      </div>
                      {fopOptions.map((opt) => (
                        <label key={opt.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 4px", cursor: "pointer" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <input type="checkbox" checked={selectedAccountKeys.includes(opt.key)} onChange={() => toggleAccountFilter(opt.key)} />
                            <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
                          </span>
                          <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700, whiteSpace: "nowrap" }}>
                            + {opt.balance != null ? `${formatMoneyRounded(opt.balance)}грн.` : "—"}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>
                  <button type="button" onClick={() => toggleSort("amount")} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 700 }}>
                    Сума {sortMark("amount")}
                  </button>
                </th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>
                  <button type="button" onClick={() => toggleSort("balance")} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 700 }}>
                    Баланс {sortMark("balance")}
                  </button>
                </th>
                <th style={{ padding: "10px 12px" }}>Опис</th>
                <th style={{ padding: "10px 12px" }}>Призначення</th>
                <th style={{ padding: "10px 12px" }}>Контрагент</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedOperations.map((it) => {
                const isIn = Number(it.amount) > 0;
                return (
                  <tr key={it.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px" }}>{formatDate(it.time)}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          color: isIn ? "#16a34a" : "#dc2626",
                          fontWeight: 700,
                          fontSize: 16,
                        }}
                        title={isIn ? "Вхідний платіж" : "Вихідний платіж"}
                      >
                        {isIn ? "↓" : "↑"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }} title={`${it.owner} (${it.accountLast4 ?? "—"})`}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {getFopLabel(it.owner, it.accountLast4)}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        textAlign: "right",
                        color: isIn ? "#16a34a" : "#dc2626",
                        fontWeight: 600,
                      }}
                      title={formatMoney(it.amount)}
                    >
                      {formatMoneyRounded(it.amount)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }} title={it.balance != null ? formatMoney(it.balance) : undefined}>
                      {it.balance != null ? formatMoneyRounded(it.balance) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }} title={it.description || undefined}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.description || "—"}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }} title={it.comment || undefined}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.comment || "—"}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }} title={it.counterName || undefined}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.counterName || "—"}
                      </div>
                    </td>
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
