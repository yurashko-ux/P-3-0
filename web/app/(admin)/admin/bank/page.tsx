// web/app/(admin)/admin/bank/page.tsx
// Розділ Банк: головна сторінка — таблиця банківських операцій

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type BankConnection = {
  id: string;
  provider: string;
  name: string;
  clientName: string | null;
  webhookUrl: string | null;
  createdAt: string;
  accounts: {
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
  }[];
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
  altegioBalance?: string | null;
  altegioAccountTitle?: string | null;
  altegioBalanceUpdatedAt?: string | null;
  altegioSyncError?: string | null;
  /** Оціночний баланс Altegio після операції: B₀ на дату відліку + рухи Monobank */
  altegioBalanceFromAnchor?: string | null;
  altegioOpeningBalanceDate?: string | null;
  fopMonthTurnoverKop?: string | null;
  fopYtdTurnoverKop?: string | null;
  fopAnnualLimitKop?: string | null;
  fopAnnualRemainingKop?: string | null;
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

function formatCompactDateTime(d: string): string {
  return new Date(d).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAnchorDateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getAltegioBalanceDisplay(item: OperationItem): {
  label: string;
  subLabel: string | null;
  title: string | null;
  color: string;
} {
  if ((item.currencyCode ?? 980) !== 980) {
    return {
      label: "—",
      subLabel: "Не UAH",
      title: "Валютні рахунки не синхронізуються з Altegio",
      color: "#6b7280",
    };
  }

  if (item.altegioBalance != null) {
    const subLabel = item.altegioSyncError
      ? item.altegioAccountTitle
        ? `${item.altegioAccountTitle} · є попередження`
        : "Є попередження синхронізації"
      : item.altegioAccountTitle && item.altegioBalanceUpdatedAt
        ? `${item.altegioAccountTitle} · ${formatCompactDateTime(item.altegioBalanceUpdatedAt)}`
        : item.altegioAccountTitle ?? null;

    return {
      label: formatMoneyRounded(item.altegioBalance),
      subLabel,
      title: item.altegioSyncError ?? item.altegioAccountTitle ?? null,
      color: item.altegioSyncError ? "#b45309" : "#111827",
    };
  }

  if (item.altegioBalanceFromAnchor != null) {
    const dlabel = formatAnchorDateLabel(item.altegioOpeningBalanceDate);
    return {
      label: formatMoneyRounded(item.altegioBalanceFromAnchor),
      subLabel: dlabel ? `оцінка від ${dlabel} · Monobank` : "оцінка від точки відліку · Monobank",
      title:
        "Оціночний баланс грошового рахунку в Altegio: сума, введена вами на дату відліку (адмінка Altegio → Банк ↔ Altegio), плюс усі суми операцій Monobank по цьому рахунку після початку цієї дати до цієї операції включно. Не враховує рухи лише в Altegio без відображення в monobank.",
      color: "#6d28d9",
    };
  }

  const error = item.altegioSyncError?.trim() ?? "";
  if (error) {
    const shortLabel = error.includes("Не знайдено")
      ? "Немає відповідності"
      : error.includes("Неоднозначне")
        ? "Кілька збігів"
        : error.includes("не повернув баланс")
          ? "Немає балансу"
          : "Помилка синку";

    return {
      label: shortLabel,
      subLabel: item.altegioAccountTitle ?? null,
      title: error,
      color: "#b45309",
    };
  }

  if (item.altegioAccountTitle) {
    return {
      label: "Очікує баланс",
      subLabel: item.altegioAccountTitle,
      title: item.altegioAccountTitle,
      color: "#6b7280",
    };
  }

  return {
    label: "—",
    subLabel: null,
    title: null,
    color: "#6b7280",
  };
}

function getFopMonthTurnoverDisplay(item: OperationItem): { label: string; title: string } {
  if ((item.currencyCode ?? 980) !== 980) {
    return { label: "—", title: "Лише для гривневих рахунків" };
  }
  if (item.fopMonthTurnoverKop == null) {
    return {
      label: "—",
      title:
        "Надходження з 1-го числа місяця: задайте точку відліку в Altegio → Банк ↔ Altegio та підтягніть виписку Monobank.",
    };
  }
  return {
    label: formatMoneyRounded(item.fopMonthTurnoverKop),
    title:
      "Сума надходжень (додатні суми в monobank) з 1-го числа календарного місяця (UTC) до цієї операції; якщо задано ручний оборот на дату відліку — він урахований.",
  };
}

function getFopAnnualRemainingDisplay(item: OperationItem): { label: string; title: string; color: string } {
  if ((item.currencyCode ?? 980) !== 980) {
    return { label: "—", title: "", color: "#6b7280" };
  }
  if (item.fopAnnualLimitKop == null || item.fopAnnualRemainingKop == null) {
    return {
      label: "—",
      title: "Вкажіть річний ліміт обороту (грн) у формі точки відліку Altegio → Банк ↔ Altegio.",
      color: "#6b7280",
    };
  }
  const rem = Number(item.fopAnnualRemainingKop);
  const lim = Number(item.fopAnnualLimitKop);
  const lowHeadroom = lim > 0 && rem < lim * 0.1;
  return {
    label: formatMoneyRounded(item.fopAnnualRemainingKop),
    title: `Залишок до річного ліміту ${formatMoneyRounded(item.fopAnnualLimitKop)} грн (YTD надходження з monobank з 1 січня поточного року, UTC).`,
    color: rem < 0 ? "#b91c1c" : lowHeadroom ? "#b45309" : "#166534",
  };
}

type BankFooterAccountRow = {
  accountId: string;
  connectionId: string;
  label: string;
  currencyCode: number;
  balanceKop: string;
  ytdIncomingKop: string | null;
  annualLimitKop: string | null;
  annualRemainingKop: string | null;
};

/** Колір залишку ліміту в футері (та сама логіка, що в рядку операції). */
function footerLimitRemainingColor(remainingKop: string | null, limitKop: string | null): string {
  if (remainingKop == null || limitKop == null) return "#6b7280";
  const rem = Number(remainingKop);
  const lim = Number(limitKop);
  const lowHeadroom = lim > 0 && rem < lim * 0.1;
  if (rem < 0) return "#b91c1c";
  if (lowHeadroom) return "#b45309";
  return "#166534";
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

/** Календарна дата в локальній таймзоні (не UTC через toISOString — інакше в UA зміщуються межі місяця). */
function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getCurrentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: formatLocalYmd(from),
    to: formatLocalYmd(to),
  };
}

const bankFetchInit: RequestInit = { credentials: "include", cache: "no-store" };

export default function BankPage() {
  const BANK_TABLE_WIDTH = "100%";
  const BANK_MAIN_TOP_PADDING = 96;
  const BANK_OPERATIONS_PAGE_SIZE = 50;
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [operations, setOperations] = useState<OperationItem[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreOperations, setHasMoreOperations] = useState(false);
  const [nextOperationsCursor, setNextOperationsCursor] = useState<string | null>(null);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [currentUser, setCurrentUser] = useState<{ login: string; name?: string } | null>(null);
  const [displaySearch, setDisplaySearch] = useState("");
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isLoginMenuOpen, setIsLoginMenuOpen] = useState(false);
  const [syncFromApiLoading, setSyncFromApiLoading] = useState(false);
  const [syncFromApiBanner, setSyncFromApiBanner] = useState<string | null>(null);
  const [footerRows, setFooterRows] = useState<BankFooterAccountRow[]>([]);
  const [footerLoading, setFooterLoading] = useState(true);
  const [footerError, setFooterError] = useState<string | null>(null);
  const [footerComputedAt, setFooterComputedAt] = useState<string | null>(null);

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
  const dateFilterPopupRef = useRef<HTMLDivElement | null>(null);
  const typeFilterPopupRef = useRef<HTMLDivElement | null>(null);
  const fopFilterPopupRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const loginMenuRef = useRef<HTMLDivElement | null>(null);
  const tableHeaderRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLTableRowElement | null>(null);
  const ignoreHeaderScroll = useRef(false);
  const ignoreBodyScroll = useRef(false);

  const showDebug = permissions == null || permissions.debugSection !== "none";
  const showAccess = permissions == null || permissions.accessSection !== "none";
  const showFinanceReport = permissions == null || permissions.financeReportSection !== "none";
  const showBank = permissions == null || permissions.bankSection !== "none";

  const loadConnections = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setConnectionsLoading(true);
    }
    setConnectionsError(null);
    try {
      const res = await fetch("/api/bank/connections", bankFetchInit);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setConnectionsError("Увійдіть в адмін-панель.");
        setConnections([]);
      } else if (data.ok && Array.isArray(data.connections)) {
        setConnections(data.connections);
      }
    } finally {
      if (!silent) {
        setConnectionsLoading(false);
      }
    }
  }, []);

  const loadFooterSummary = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setFooterLoading(true);
    setFooterError(null);
    try {
      const res = await fetch("/api/bank/accounts-footer-summary", bankFetchInit);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setFooterRows([]);
        setFooterComputedAt(null);
        return;
      }
      if (data.ok && Array.isArray(data.accounts)) {
        setFooterRows(data.accounts as BankFooterAccountRow[]);
        setFooterComputedAt(typeof data.computedAt === "string" ? data.computedAt : null);
      } else {
        setFooterRows([]);
        setFooterComputedAt(null);
        setFooterError(typeof data.error === "string" ? data.error : "Не вдалося завантажити зведення для футера.");
      }
    } catch (e) {
      console.error("[admin/bank] loadFooterSummary:", e);
      setFooterRows([]);
      setFooterComputedAt(null);
      setFooterError(e instanceof Error ? e.message : "Помилка мережі");
    } finally {
      if (!silent) setFooterLoading(false);
    }
  }, []);

  const loadOperations = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!silent) {
        setOperationsLoading(true);
      }
      setIsLoadingMore(false);
      setHasMoreOperations(false);
      setNextOperationsCursor(null);
      try {
        const params = new URLSearchParams({
          from: dateFrom,
          to: dateTo,
          direction: "all",
          limit: String(BANK_OPERATIONS_PAGE_SIZE),
        });
        const res = await fetch(`/api/bank/operations?${params}`, bankFetchInit);
        const data = await res.json().catch(() => ({}));
        if (data.ok && Array.isArray(data.items)) {
          setOperations(data.items);
          setHasMoreOperations(Boolean(data.hasMore));
          setNextOperationsCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
        } else {
          setOperations([]);
          setHasMoreOperations(false);
          setNextOperationsCursor(null);
        }
      } finally {
        if (!silent) {
          setOperationsLoading(false);
        }
      }
    },
    [dateFrom, dateTo]
  );

  const refreshBankDataFromServer = useCallback(
    (opts?: { silent?: boolean }) => {
      void loadConnections(opts);
      void loadOperations(opts);
      void loadFooterSummary(opts);
    },
    [loadConnections, loadOperations, loadFooterSummary]
  );

  /** Те саме, що «Підтягнути з API» на Банк 1: Monobank → БД за період dateFrom…dateTo, потім перезавантаження таблиці. */
  const pullAllFromMonobankApi = useCallback(async () => {
    setSyncFromApiBanner(null);
    setSyncFromApiLoading(true);
    console.log("[admin/bank] Підтягування виписки з Monobank для всіх рахунків таблиці, період:", dateFrom, "—", dateTo);
    try {
      const res = await fetch("/api/bank/connections", bankFetchInit);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !Array.isArray(data.connections)) {
        setSyncFromApiBanner("Не вдалося отримати список підключень.");
        return;
      }
      const accountIds: string[] = [];
      for (const c of data.connections as BankConnection[]) {
        for (const a of c.accounts ?? []) {
          if (a.includeInOperationsTable !== false && a.id) accountIds.push(a.id);
        }
      }
      if (accountIds.length === 0) {
        setSyncFromApiBanner(
          "Немає рахунків для синхронізації. Увімкніть «Показувати в таблиці Банк» для потрібних рахунків на сторінці Банк 1."
        );
        return;
      }
      let totalSaved = 0;
      const errors: string[] = [];
      for (let i = 0; i < accountIds.length; i++) {
        const accountId = accountIds[i];
        const syncRes = await fetch("/api/bank/statement/sync", {
          method: "POST",
          ...bankFetchInit,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, from: dateFrom, to: dateTo }),
        });
        const syncData = await syncRes.json().catch(() => ({}));
        if (syncData.ok) totalSaved += typeof syncData.saved === "number" ? syncData.saved : 0;
        else errors.push(typeof syncData.error === "string" ? syncData.error : `рахунок ${i + 1}`);
      }
      refreshBankDataFromServer({ silent: false });
      if (errors.length > 0) {
        setSyncFromApiBanner(
          `Частина запитів з помилкою (ліміт Monobank 60 с/рахунок): ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}`
        );
      } else {
        setSyncFromApiBanner(`Готово: з Monobank збережено ${totalSaved} рядків виписки за ${dateFrom}…${dateTo}.`);
      }
    } catch (e) {
      console.error("[admin/bank] pullAllFromMonobankApi:", e);
      setSyncFromApiBanner(e instanceof Error ? e.message : "Помилка мережі");
    } finally {
      setSyncFromApiLoading(false);
    }
  }, [dateFrom, dateTo, refreshBankDataFromServer]);

  /** Після повернення на вкладку: підтягнути з БД нові операції (вебхук/sync уже записали їх на бекенді). */
  const lastVisibilityRefreshAt = useRef(0);
  const VISIBILITY_REFRESH_MIN_MS = 45_000;
  useEffect(() => {
    let wasHidden = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (document.visibilityState !== "visible" || !wasHidden) return;
      wasHidden = false;
      const now = Date.now();
      if (now - lastVisibilityRefreshAt.current < VISIBILITY_REFRESH_MIN_MS) return;
      lastVisibilityRefreshAt.current = now;
      console.log("[admin/bank] Оновлення таблиці після повернення на вкладку (тихий режим)");
      refreshBankDataFromServer({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshBankDataFromServer]);

  const loadMoreOperations = async () => {
    if (operationsLoading || isLoadingMore || !hasMoreOperations || !nextOperationsCursor) return;
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({
        from: dateFrom,
        to: dateTo,
        direction: "all",
        limit: String(BANK_OPERATIONS_PAGE_SIZE),
        cursor: nextOperationsCursor,
      });
      const res = await fetch(`/api/bank/operations?${params}`, bankFetchInit);
      const data = await res.json().catch(() => ({}));
      if (data.ok && Array.isArray(data.items)) {
        setOperations((prev) => {
          const existing = new Set(prev.map((item) => item.id));
          const appended = data.items.filter((item: OperationItem) => !existing.has(item.id));
          return [...prev, ...appended];
        });
        setHasMoreOperations(Boolean(data.hasMore));
        setNextOperationsCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);
      } else {
        setHasMoreOperations(false);
        setNextOperationsCursor(null);
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadConnections();
    void loadFooterSummary();
  }, [loadConnections, loadFooterSummary]);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  useEffect(() => {
    if (operationsLoading || !hasMoreOperations) return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          void loadMoreOperations();
        }
      },
      { root: null, rootMargin: "0px 0px 220px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [operationsLoading, hasMoreOperations, nextOperationsCursor, isLoadingMore, dateFrom, dateTo]);

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
    const today = formatLocalYmd(new Date());
    setDateFrom(today);
    setDateTo(today);
  };

  const setPendingCurrentMonth = () => {
    const { from, to } = getCurrentMonthRange();
    setPendingDateFrom(from);
    setPendingDateTo(to);
  };

  const setPendingToday = () => {
    const today = formatLocalYmd(new Date());
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
        fopFilterRef.current?.contains(target) ||
        dateFilterPopupRef.current?.contains(target) ||
        typeFilterPopupRef.current?.contains(target) ||
        fopFilterPopupRef.current?.contains(target)
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

  const bankColgroup = (
    <colgroup>
      <col style={{ width: 56 }} />
      <col style={{ width: 170 }} />
      <col style={{ width: 72 }} />
      <col style={{ width: 210 }} />
      <col style={{ width: 90 }} />
      <col style={{ width: 110 }} />
      <col style={{ width: 170 }} />
      <col style={{ width: 100 }} />
      <col style={{ width: 100 }} />
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
              {renderFilterPopup(
                isDateFilterOpen,
                dateFilterRef,
                dateFilterPopupRef,
                260,
                <>
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
                </>
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
              {renderFilterPopup(
                isTypeFilterOpen,
                typeFilterRef,
                typeFilterPopupRef,
                200,
                <>
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
                </>
              )}
            </div>
          </div>
        </th>
        <th style={{ padding: "10px 12px", width: 210, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
            <span style={{ marginRight: 6, fontWeight: 600, color: "#4b5563" }}>ФОП</span>
            <div ref={fopFilterRef} style={{ position: "relative" }}>
              <FilterIconButton active={selectedAccountKeys.length > 0} onClick={openFopFilter} title="Фільтри для ФОП" />
              {renderFilterPopup(
                isFopFilterOpen,
                fopFilterRef,
                fopFilterPopupRef,
                310,
                <>
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
                </>
              )}
            </div>
          </div>
        </th>
        <th style={{ padding: "10px 12px", width: 90, textAlign: "right" }}>Сума</th>
        <th style={{ padding: "10px 12px", width: 110, textAlign: "right" }}>Баланс</th>
        <th
          style={{ padding: "10px 12px", width: 170, textAlign: "right" }}
          title="Знімок з вебхука або оцінка від точки відліку (Altegio + рухи Monobank). Налаштування точки відліку: Altegio → Банк ↔ Altegio."
        >
          Баланс Альтеджіо
        </th>
        <th
          style={{ padding: "10px 12px", width: 100, textAlign: "right", fontSize: 12 }}
          title="Надходження на рахунок (додатні суми monobank) з 1-го числа місяця (UTC) до цієї операції. Ручне значення на дату відліку + виписка."
        >
          Надх. міс.
        </th>
        <th
          style={{ padding: "10px 12px", width: 100, textAlign: "right", fontSize: 12 }}
          title="Залишок до річного ліміту обороту, якщо ліміт задано в Altegio → Банк ↔ Altegio."
        >
          Залишок рік
        </th>
        <th style={{ padding: "10px 12px" }}>Опис</th>
        <th style={{ padding: "10px 12px" }}>Призначення</th>
        <th style={{ padding: "10px 12px" }}>Контрагент</th>
      </tr>
    </thead>
  );

  function renderFilterPopup(
    isOpen: boolean,
    triggerRef: React.RefObject<HTMLDivElement | null>,
    popupRef: React.RefObject<HTMLDivElement | null>,
    minWidth: number,
    children: React.ReactNode
  ) {
    if (!isOpen || typeof document === "undefined") return null;
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    return createPortal(
      <div
        ref={popupRef}
        style={{
          position: "fixed",
          top: rect.bottom + 6,
          left: rect.left,
          zIndex: 10000,
          background: "#fff",
          border: "1px solid #d1d5db",
          borderRadius: 8,
          boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
          minWidth,
          padding: 8,
        }}
      >
        {children}
      </div>,
      document.body
    );
  }

  return (
    <div className="min-h-screen flex flex-col w-full pb-1.5">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shrink-0 leading-none">
        <div
          className="py-0 flex flex-col md:flex-row md:items-center md:justify-between gap-0.5"
          style={{ width: BANK_TABLE_WIDTH, margin: "0 auto" }}
        >
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
              <>
                <Link
                  href="/admin/bank/connections"
                  className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight"
                >
                  🏦 Банк 1
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight"
                  title="Перечитати таблицю з бази (без запиту до Monobank)"
                  disabled={operationsLoading || connectionsLoading || syncFromApiLoading}
                  onClick={() => {
                    console.log("[admin/bank] Ручне оновлення таблиці з БД");
                    setSyncFromApiBanner(null);
                    refreshBankDataFromServer({ silent: false });
                  }}
                >
                  ↻ З БД
                </button>
                <button
                  type="button"
                  className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight"
                  title="Підтягнути виписку з Monobank у БД за обраний у фільтрі період (усі рахунки з таблиці Банк). До 60 с очікування між рахунками."
                  disabled={operationsLoading || connectionsLoading || syncFromApiLoading}
                  onClick={() => void pullAllFromMonobankApi()}
                >
                  {syncFromApiLoading ? "… API" : "⟳ З API"}
                </button>
              </>
            )}
            {showFinanceReport && (
              <Link href="/admin/finance-report" className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight" target="_blank" rel="noopener noreferrer">
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
            width: BANK_TABLE_WIDTH,
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

      <main style={{ margin: "0 auto", padding: `${BANK_MAIN_TOP_PADDING}px 0 20px`, width: "100%" }}>

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

      {syncFromApiBanner && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 10,
            color: "#1e40af",
            fontSize: 13,
          }}
        >
          {syncFromApiBanner}
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
        <div style={{ width: BANK_TABLE_WIDTH, margin: "0 auto" }}>
            <div ref={tableScrollRef} onScroll={onBodyScroll} style={{ overflowX: "auto", width: "100%" }}>
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
                    <td colSpan={12} style={{ padding: "16px 12px", color: "rgba(0,0,0,0.55)" }}>
                      Немає операцій за обраними фільтрами.
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedOperations.map((it, index) => {
                    const isIn = Number(it.amount) > 0;
                    const altegioBalanceDisplay = getAltegioBalanceDisplay(it);
                    const fopMonth = getFopMonthTurnoverDisplay(it);
                    const fopYearRem = getFopAnnualRemainingDisplay(it);
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
                        <td style={{ padding: "10px 12px" }}>
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
                        >
                          {formatMoneyRounded(it.amount)}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {it.balance != null ? formatMoneyRounded(it.balance) : "—"}
                        </td>
                        <td
                          style={{ padding: "10px 12px", textAlign: "right" }}
                          title={altegioBalanceDisplay.title || undefined}
                        >
                          <div
                            style={{
                              display: "grid",
                              gap: 2,
                              justifyItems: "end",
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                color: altegioBalanceDisplay.color,
                                fontWeight: altegioBalanceDisplay.label === "—" ? 500 : 600,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {altegioBalanceDisplay.label}
                            </span>
                            {altegioBalanceDisplay.subLabel ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "#6b7280",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  maxWidth: "100%",
                                }}
                              >
                                {altegioBalanceDisplay.subLabel}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }} title={fopMonth.title}>
                          <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fopMonth.label}</span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }} title={fopYearRem.title}>
                          <span
                            style={{
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              color: fopYearRem.color,
                            }}
                          >
                            {fopYearRem.label}
                          </span>
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
                {(hasMoreOperations || isLoadingMore) && (
                  <tr ref={loadMoreSentinelRef}>
                    <td colSpan={12} style={{ padding: "12px", textAlign: "center", color: "rgba(0,0,0,0.55)" }}>
                      {isLoadingMore ? "Завантаження ще операцій…" : "Прокрутіть вниз для завантаження ще"}
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </div>
        </div>
      )}
    </main>

      <footer
        style={{
          width: "100%",
          marginTop: "auto",
          paddingTop: 20,
          paddingBottom: 28,
          borderTop: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <div style={{ width: BANK_TABLE_WIDTH, margin: "0 auto", padding: "0 12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: 0 }}>Зведення по рахунках</h2>
            {footerComputedAt ? (
              <span style={{ fontSize: 11, color: "#6b7280" }}>
                На момент: {formatDate(footerComputedAt)}
              </span>
            ) : null}
          </div>
          <p style={{ fontSize: 12, color: "#4b5563", margin: "0 0 12px", lineHeight: 1.45, maxWidth: 720 }}>
            Баланс — поточний з БД (Monobank). Для гривневих рахунків:{" "}
            <strong>залишок ліміту = річний ліміт − оборот з 1 січня</strong> (реальні надходження з виписки Monobank, UTC).
          </p>
          {footerError ? (
            <p style={{ fontSize: 13, color: "#b91c1c", margin: 0 }} role="alert">
              {footerError}
            </p>
          ) : footerLoading ? (
            <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: 0 }}>Завантаження зведення…</p>
          ) : footerRows.length === 0 ? (
            <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: 0 }}>
              Немає рахунків з увімкненим «Показувати в таблиці Банк». Налаштуйте на сторінці{" "}
              <Link href="/admin/bank/connections" style={{ color: "#2563eb", fontWeight: 600 }}>
                Банк 1
              </Link>
              .
            </p>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid #e8ebf0", borderRadius: 12, background: "#fff" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                    <th style={{ padding: "10px 12px", fontWeight: 600 }}>Рахунок</th>
                    <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>Баланс (банк)</th>
                    <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>Річний ліміт</th>
                    <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>Оборот з 1 січня</th>
                    <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>Залишок ліміту</th>
                  </tr>
                </thead>
                <tbody>
                  {footerRows.map((row) => {
                    const isUah = (row.currencyCode ?? 980) === 980;
                    const remTitle =
                      row.annualLimitKop != null && row.ytdIncomingKop != null
                        ? `Ліміт ${formatMoneyRounded(row.annualLimitKop)} грн − оборот ${formatMoneyRounded(row.ytdIncomingKop)} грн (UTC, Monobank).`
                        : undefined;
                    return (
                      <tr key={row.accountId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ fontWeight: 600 }}>{row.label}</span>
                          {!isUah ? (
                            <span style={{ marginLeft: 8, fontSize: 11, color: "#6b7280" }}>(код {row.currencyCode})</span>
                          ) : null}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>{formatMoneyRounded(row.balanceKop)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: isUah && row.annualLimitKop ? "#111827" : "#9ca3af" }}>
                          {isUah && row.annualLimitKop != null ? formatMoneyRounded(row.annualLimitKop) : "—"}
                        </td>
                        <td
                          style={{ padding: "10px 12px", textAlign: "right", color: isUah && row.ytdIncomingKop != null ? "#111827" : "#9ca3af" }}
                          title={isUah ? "Сума додатних операцій Monobank з 1 січня UTC поточного року" : undefined}
                        >
                          {isUah && row.ytdIncomingKop != null ? formatMoneyRounded(row.ytdIncomingKop) : "—"}
                        </td>
                        <td
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontWeight: 700,
                            color: footerLimitRemainingColor(row.annualRemainingKop, row.annualLimitKop),
                          }}
                          title={remTitle}
                        >
                          {isUah && row.annualRemainingKop != null && row.annualLimitKop != null
                            ? formatMoneyRounded(row.annualRemainingKop)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 10, marginBottom: 0 }}>
            Оновлюється разом із кнопкою «З БД» та після повернення на вкладку (тихе оновлення).
          </p>
        </div>
      </footer>
  </div>
  );
}
