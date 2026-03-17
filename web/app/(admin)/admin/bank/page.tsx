// web/app/(admin)/admin/bank/page.tsx
// Розділ Банк: головна сторінка — таблиця банківських операцій

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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
type Permissions = Record<string, string>;

function FilterIconButton({
  active,
  onClick,
  title,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 6,
        border: `2px solid ${active ? "#3b82f6" : "#6b7280"}`,
        color: active ? "#2563eb" : "#6b7280",
        background: active ? "#dbeafe" : "transparent",
        cursor: "pointer",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 3h8M3 6h6M4.5 9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
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
  const BANK_TABLE_WIDTH = "80%";
  const BANK_MAIN_TOP_PADDING = 96;
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [currentUser, setCurrentUser] = useState<{ login: string; name?: string } | null>(null);
  const [displaySearch, setDisplaySearch] = useState("");
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isLoginMenuOpen, setIsLoginMenuOpen] = useState(false);

  const [dateFrom, setDateFrom] = useState(() => getCurrentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => getCurrentMonthRange().to);
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all");
  const [selectedAccountKeys, setSelectedAccountKeys] = useState<string[]>([]);
  const [pendingDateFrom, setPendingDateFrom] = useState(() => getCurrentMonthRange().from);
  const [pendingDateTo, setPendingDateTo] = useState(() => getCurrentMonthRange().to);
  const [pendingTypeFilter, setPendingTypeFilter] = useState<"all" | "in" | "out">("all");
  const [pendingSelectedAccountKeys, setPendingSelectedAccountKeys] = useState<string[]>([]);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const [isTypeFilterOpen, setIsTypeFilterOpen] = useState(false);
  const [isFopFilterOpen, setIsFopFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("time");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const dateFilterRef = useRef<HTMLDivElement | null>(null);
  const typeFilterRef = useRef<HTMLDivElement | null>(null);
  const fopFilterRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const loginMenuRef = useRef<HTMLDivElement | null>(null);
  const tableHeaderRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollContentWidth, setScrollContentWidth] = useState<number | null>(null);
  const ignoreHeaderScroll = useRef(false);
  const ignoreBodyScroll = useRef(false);

  const showDebug = permissions == null || permissions.debugSection !== "none";
  const showAccess = permissions == null || permissions.accessSection !== "none";
  const showFinanceReport = permissions == null || permissions.financeReportSection !== "none";
  const showBank = permissions == null || permissions.bankSection !== "none";

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          setCurrentUser(data.user ?? null);
          setPermissions(data.permissions ?? {});
        } else {
          setCurrentUser(null);
          setPermissions({});
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCurrentUser(null);
        setPermissions({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const setPendingCurrentMonth = () => {
    const { from, to } = getCurrentMonthRange();
    setPendingDateFrom(from);
    setPendingDateTo(to);
  };

  const setPendingToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    setPendingDateFrom(today);
    setPendingDateTo(today);
  };

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (addMenuRef.current?.contains(target) || loginMenuRef.current?.contains(target)) {
        return;
      }
      if (
        dateFilterRef.current?.contains(target) ||
        typeFilterRef.current?.contains(target) ||
        fopFilterRef.current?.contains(target)
      ) {
        return;
      }
      setIsDateFilterOpen(false);
      setIsTypeFilterOpen(false);
      setIsFopFilterOpen(false);
      setPendingDateFrom(dateFrom);
      setPendingDateTo(dateTo);
      setPendingTypeFilter(typeFilter);
      setPendingSelectedAccountKeys(selectedAccountKeys);
      setIsAddMenuOpen(false);
      setIsLoginMenuOpen(false);
    };

    if (isDateFilterOpen || isTypeFilterOpen || isFopFilterOpen || isAddMenuOpen || isLoginMenuOpen) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [
    isDateFilterOpen,
    isTypeFilterOpen,
    isFopFilterOpen,
    isAddMenuOpen,
    isLoginMenuOpen,
    dateFrom,
    dateTo,
    typeFilter,
    selectedAccountKeys,
  ]);

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

  const fopTotalBalance = useMemo(() => {
    return fopOptions.reduce((acc, opt) => {
      if (opt.balance == null) return acc;
      return acc + Number(opt.balance);
    }, 0);
  }, [fopOptions]);

  const filteredAndSortedOperations = useMemo(() => {
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    const search = displaySearch.trim().toLowerCase();

    const filtered = operations.filter((op) => {
      const opTs = new Date(op.time).getTime();
      if (fromTs != null && opTs < fromTs) return false;
      if (toTs != null && opTs > toTs) return false;
      if (typeFilter === "in" && Number(op.amount) <= 0) return false;
      if (typeFilter === "out" && Number(op.amount) >= 0) return false;
      if (selectedAccountKeys.length > 0 && !selectedAccountKeys.includes(accountKey(op))) return false;
      if (search) {
        const haystack = [
          getFopLabel(op.owner, op.accountLast4),
          op.description,
          op.comment ?? "",
          op.counterName ?? "",
          formatDate(op.time),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
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
  }, [operations, dateFrom, dateTo, typeFilter, selectedAccountKeys, sortBy, sortOrder, displaySearch]);

  const toggleSort = (key: SortBy) => {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(key);
    setSortOrder("desc");
  };

  const toggleAccountFilter = (key: string) => {
    setPendingSelectedAccountKeys((prev) => (prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]));
  };

  const sortMark = (key: SortBy) => (sortBy === key ? (sortOrder === "asc" ? "↑" : "↓") : "");

  const openDateFilter = () => {
    setPendingDateFrom(dateFrom);
    setPendingDateTo(dateTo);
    setIsDateFilterOpen((v) => !v);
    setIsTypeFilterOpen(false);
    setIsFopFilterOpen(false);
  };

  const openTypeFilter = () => {
    setPendingTypeFilter(typeFilter);
    setIsTypeFilterOpen((v) => !v);
    setIsDateFilterOpen(false);
    setIsFopFilterOpen(false);
  };

  const openFopFilter = () => {
    setPendingSelectedAccountKeys(selectedAccountKeys);
    setIsFopFilterOpen((v) => !v);
    setIsDateFilterOpen(false);
    setIsTypeFilterOpen(false);
  };

  const applyDateFilter = () => {
    setDateFrom(pendingDateFrom);
    setDateTo(pendingDateTo);
    setIsDateFilterOpen(false);
  };

  const clearDateFilter = () => {
    const { from, to } = getCurrentMonthRange();
    setPendingDateFrom(from);
    setPendingDateTo(to);
    setDateFrom(from);
    setDateTo(to);
    setIsDateFilterOpen(false);
  };

  const applyTypeFilter = () => {
    setTypeFilter(pendingTypeFilter);
    setIsTypeFilterOpen(false);
  };

  const clearTypeFilter = () => {
    setPendingTypeFilter("all");
    setTypeFilter("all");
    setIsTypeFilterOpen(false);
  };

  const applyFopFilter = () => {
    setSelectedAccountKeys(pendingSelectedAccountKeys);
    setIsFopFilterOpen(false);
  };

  const clearFopFilter = () => {
    setPendingSelectedAccountKeys([]);
    setSelectedAccountKeys([]);
    setIsFopFilterOpen(false);
  };

  const onBodyScroll = (e: any) => {
    const el = e.currentTarget;
    if (ignoreBodyScroll.current) {
      ignoreBodyScroll.current = false;
      return;
    }
    const sl = el.scrollLeft;
    const header = tableHeaderRef.current;
    if (header && header.scrollLeft !== sl) {
      ignoreHeaderScroll.current = true;
      header.scrollLeft = sl;
    }
  };

  const onHeaderScroll = (e: any) => {
    const el = e.currentTarget;
    if (ignoreHeaderScroll.current) {
      ignoreHeaderScroll.current = false;
      return;
    }
    const sl = el.scrollLeft;
    const body = tableScrollRef.current;
    if (body && body.scrollLeft !== sl) {
      ignoreBodyScroll.current = true;
      body.scrollLeft = sl;
    }
  };

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const update = () => setScrollContentWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [operationsLoading]);

  const bankColgroup = (
    <colgroup>
      <col style={{ width: 56 }} />
      <col style={{ width: 170 }} />
      <col style={{ width: 72 }} />
      <col style={{ width: 210 }} />
      <col style={{ width: 90 }} />
      <col style={{ width: 110 }} />
      <col />
      <col />
      <col />
    </colgroup>
  );

  const bankHeader = (
    <thead>
      <tr style={{ borderBottom: "2px solid #e8ebf0", textAlign: "left", background: "#f9fafb" }}>
        <th style={{ padding: "10px 12px", width: 56 }}>№</th>
        <th style={{ padding: "10px 12px", minWidth: 170, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => toggleSort("time")}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                fontWeight: sortBy === "time" ? 700 : 600,
                color: sortBy === "time" ? "#2563eb" : "#4b5563",
                textDecoration: "underline",
                textDecorationColor: "transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.textDecorationColor = "currentColor";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecorationColor = "transparent";
              }}
            >
              Дата {sortMark("time")}
            </button>
            <div ref={dateFilterRef} style={{ position: "relative" }}>
              <FilterIconButton active={dateFrom !== getCurrentMonthRange().from || dateTo !== getCurrentMonthRange().to} onClick={openDateFilter} title="Фільтри для Дата" />
              {isDateFilterOpen && (
                <div style={{ position: "absolute", top: 28, left: 0, zIndex: 5000, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, boxShadow: "0 10px 25px rgba(0,0,0,0.15)", minWidth: 260, padding: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 4px", fontSize: 12, color: "#374151", fontWeight: 600 }}>
                    <span>Фільтри: Дата</span>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <input type="date" value={pendingDateFrom} onChange={(e) => setPendingDateFrom(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} />
                    <input type="date" value={pendingDateTo} onChange={(e) => setPendingDateTo(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 12 }} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={setPendingToday} style={{ flex: 1, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", fontSize: 12, cursor: "pointer" }}>Сьогодні</button>
                      <button type="button" onClick={setPendingCurrentMonth} style={{ flex: 1, padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", fontSize: 12, cursor: "pointer" }}>Поточний місяць</button>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                      <button type="button" onClick={applyDateFilter} style={{ flex: 1, padding: "6px 8px", border: "none", borderRadius: 6, background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Застосувати</button>
                      <button type="button" onClick={clearDateFilter} style={{ flex: 1, padding: "6px 8px", border: "none", borderRadius: 6, background: "#ec4899", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Очистити</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </th>
        <th style={{ padding: "10px 12px", width: 72, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => toggleSort("type")}
              style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: sortBy === "type" ? 700 : 600, color: sortBy === "type" ? "#2563eb" : "#4b5563" }}
            >
              Тип {sortMark("type")}
            </button>
            <div ref={typeFilterRef} style={{ position: "relative" }}>
              <FilterIconButton active={typeFilter !== "all"} onClick={openTypeFilter} title="Фільтри для Тип" />
              {isTypeFilterOpen && (
                <div style={{ position: "absolute", top: 28, left: 0, zIndex: 5000, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, boxShadow: "0 10px 25px rgba(0,0,0,0.15)", minWidth: 200, padding: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 4px", fontSize: 12, color: "#374151", fontWeight: 600 }}>
                    <span>Фільтри: Тип</span>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {([
                      { id: "all", label: "↑↓" },
                      { id: "in", label: "↓" },
                      { id: "out", label: "↑" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPendingTypeFilter(opt.id)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          background: pendingTypeFilter === opt.id ? "#eff6ff" : "#fff",
                          color: opt.id === "in" ? "#16a34a" : opt.id === "out" ? "#dc2626" : "#374151",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                      <button type="button" onClick={applyTypeFilter} style={{ flex: 1, padding: "6px 8px", border: "none", borderRadius: 6, background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Застосувати</button>
                      <button type="button" onClick={clearTypeFilter} style={{ flex: 1, padding: "6px 8px", border: "none", borderRadius: 6, background: "#ec4899", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Очистити</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </th>
        <th style={{ padding: "10px 12px", width: 210, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
            <div ref={fopFilterRef} style={{ position: "relative" }}>
              <FilterIconButton active={selectedAccountKeys.length > 0} onClick={openFopFilter} title="Фільтри для ФОП" />
              {isFopFilterOpen && (
                <div style={{ position: "absolute", top: 28, left: 0, zIndex: 5000, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, boxShadow: "0 10px 25px rgba(0,0,0,0.15)", minWidth: 310, padding: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, padding: "0 4px", fontSize: 12, color: "#374151", fontWeight: 600, gap: 8 }}>
                    <span>Фльтри ФОП, Сума:</span>
                    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
                      <span style={{ color: "#16a34a", fontSize: 14, fontWeight: 700 }}>
                        + {formatMoneyRounded(String(fopTotalBalance))}грн.
                      </span>
                    </div>
                  </div>
                  <div style={{ maxHeight: 240, overflowY: "auto" }}>
                    {fopOptions.map((opt) => (
                      <label
                        key={opt.key}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 4px", cursor: "pointer", borderRadius: 6, transition: "background-color 120ms ease" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#f3f4f6";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <input type="checkbox" checked={pendingSelectedAccountKeys.includes(opt.key)} onChange={() => toggleAccountFilter(opt.key)} />
                          <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
                        </span>
                        <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700, whiteSpace: "nowrap" }}>
                          + {opt.balance != null ? `${formatMoneyRounded(opt.balance)}грн.` : "—"}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button type="button" onClick={applyFopFilter} style={{ flex: 1, padding: "6px 8px", border: "none", borderRadius: 6, background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Застосувати</button>
                    <button type="button" onClick={clearFopFilter} style={{ flex: 1, padding: "6px 8px", border: "none", borderRadius: 6, background: "#ec4899", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Очистити</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </th>
        <th style={{ padding: "10px 12px", width: 90, textAlign: "right" }} />
        <th style={{ padding: "10px 12px", width: 110, textAlign: "right" }} />
        <th style={{ padding: "10px 12px" }}>Опис</th>
        <th style={{ padding: "10px 12px" }}>Призначення</th>
        <th style={{ padding: "10px 12px" }}>Контрагент</th>
      </tr>
    </thead>
  );

  return (
    <div className="min-h-screen flex flex-col w-full pb-1.5">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shrink-0 leading-none">
        <div className="w-full px-2 py-0 flex flex-col md:flex-row md:items-center md:justify-between gap-0.5">
          <div className="flex items-center gap-0.5 min-h-[20px] w-full md:max-w-[260px]">
            <Link
              href="/admin/direct"
              className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight"
              title="Дірект"
              aria-label="Дірект"
            >
              🏠
            </Link>
            <input
              type="search"
              value={displaySearch}
              onChange={(e) => setDisplaySearch(e.target.value)}
              placeholder="Пошук: ФОП, опис, призначення, контрагент"
              className="input input-sm input-bordered w-full min-h-8 text-xs"
              aria-label="Пошук операцій"
            />
          </div>
          <div className="flex gap-0.5 items-center min-h-[20px] flex-1 justify-end">
            {showBank && (
              <Link
                href="/admin/bank/connections"
                className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight"
                target="_blank"
                rel="noopener noreferrer"
              >
                🏦 Банк 1
              </Link>
            )}
            {showFinanceReport && (
              <Link href="/admin/finance-report" className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight">
                💰 Фінансовий звіт
              </Link>
            )}
            <Link href="/admin/direct/stats" className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight" target="_blank" rel="noopener noreferrer">
              📈 Статистика
            </Link>
            {showDebug && (
              <Link href="/admin/debug" className="btn btn-ghost min-h-0 py-0.5 px-1 text-[10px] leading-tight" title="Відкрити тести">
                тести
              </Link>
            )}
            <div className="relative add-menu-container" ref={addMenuRef}>
              <button
                className="btn btn-primary w-[18px] h-[18px] min-w-[18px] min-h-[18px] rounded p-0 flex items-center justify-center text-[10px] leading-none"
                onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                title="Додати"
                type="button"
              >
                +
              </button>
              {isAddMenuOpen && (
                <div className="absolute right-0 top-full mt-0.5 bg-white border border-gray-300 rounded shadow-lg z-50 min-w-[180px]">
                  <div className="p-0.5">
                    <Link
                      href="/admin/bank/connections"
                      className="block w-full text-left px-2 py-1 rounded text-xs hover:bg-base-200 transition-colors"
                      onClick={() => setIsAddMenuOpen(false)}
                    >
                      + Додати підключення
                    </Link>
                    {showAccess && (
                      <Link
                        href="/admin/access"
                        className="block w-full text-left px-2 py-1 rounded text-xs hover:bg-base-200 transition-colors"
                        onClick={() => setIsAddMenuOpen(false)}
                      >
                        🔐 Доступи
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center min-h-[20px] ml-auto shrink-0" ref={loginMenuRef}>
            {currentUser?.login != null && currentUser.login !== "" && (
              <div className="relative">
                <button
                  type="button"
                  className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1.5 leading-tight text-right"
                  onClick={() => setIsLoginMenuOpen(!isLoginMenuOpen)}
                  title="Меню користувача"
                >
                  {currentUser.name && currentUser.name.trim() !== ""
                    ? currentUser.name.trim()
                    : currentUser.login}
                </button>
                {isLoginMenuOpen && (
                  <div className="absolute right-0 top-full mt-0.5 bg-white border border-gray-300 rounded shadow-lg z-50 min-w-[160px]">
                    <div className="p-0.5">
                      <Link
                        href="/admin/logout"
                        className="block w-full text-left px-2 py-1 rounded text-xs hover:bg-base-200 transition-colors"
                        onClick={() => setIsLoginMenuOpen(false)}
                      >
                        Вийти з системи
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            overflow: "visible",
            borderTop: "1px solid #e5e7eb",
            background: "#f9fafb",
            width: scrollContentWidth != null ? scrollContentWidth : BANK_TABLE_WIDTH,
            margin: "0 auto",
            position: "relative",
            zIndex: 40,
          }}
        >
          <div ref={tableHeaderRef} style={{ overflowX: "auto", overflowY: "visible", width: "100%" }} onScroll={onHeaderScroll}>
            <table
              style={{
                width: "100%",
                tableLayout: "fixed",
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: 14,
                border: "1px solid #e8ebf0",
                borderBottom: "none",
                borderRadius: "12px 12px 0 0",
              }}
            >
              {bankColgroup}
              {bankHeader}
            </table>
          </div>
        </div>
      </header>

      <main style={{ margin: "0 auto", padding: `${BANK_MAIN_TOP_PADDING}px 20px 20px`, width: "100%" }}>

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
      ) : (
        <div ref={tableScrollRef} onScroll={onBodyScroll} style={{ overflowX: "auto", width: BANK_TABLE_WIDTH, margin: "0 auto" }}>
          <table
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 14,
              border: "1px solid #e8ebf0",
              borderTop: "none",
              borderRadius: "0 0 12px 12px",
            }}
          >
            {bankColgroup}
            <tbody>
              {filteredAndSortedOperations.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: "16px 12px", color: "rgba(0,0,0,0.55)" }}>
                    Немає операцій за обраними фільтрами.
                  </td>
                </tr>
              ) : (
                filteredAndSortedOperations.map((it, index) => {
                  const isIn = Number(it.amount) > 0;
                  return (
                    <tr
                      key={it.id}
                      style={{ borderBottom: "1px solid #f0f0f0", transition: "background-color 120ms ease" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#f3f4f6";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <td style={{ padding: "10px 12px", color: "#6b7280" }}>{index + 1}</td>
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
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  </div>
  );
}
