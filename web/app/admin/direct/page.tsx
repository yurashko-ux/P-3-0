// web/app/admin/direct/page.tsx
// Сторінка для роботи дірект-менеджера з клієнтами Instagram Direct

"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DirectClientTable, type DirectFilters } from "./_components/DirectClientTable";
import { StatusManager } from "./_components/StatusManager";
import { MasterManager } from "./_components/MasterManager";
import { WebhooksTableModal } from "./_components/WebhooksTableModal";
import { ManyChatWebhooksTableModal } from "./_components/ManyChatWebhooksTableModal";
import { TelegramMessagesModal } from "./_components/TelegramMessagesModal";
import { AdminToolsModal } from "./_components/AdminToolsModal";
import type { DirectClient, DirectStatus, DirectChatStatus, DirectCallStatus } from "@/lib/direct-types";

// Компонент для діагностичного модального вікна з кнопкою копіювання
function DiagnosticModal({ message, onClose }: { message: string; onClose: () => void }) {
  const handleCopy = async () => {
    try {
      // Використовуємо сучасний Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message);
        showSuccessMessage('✅ Скопійовано!');
      } else {
        // Fallback для старих браузерів
        const textarea = document.createElement('textarea');
        textarea.value = message;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (copied) {
          showSuccessMessage('✅ Скопійовано!');
        } else {
          showSuccessMessage('❌ Не вдалося скопіювати');
        }
      }
    } catch (err) {
      showSuccessMessage('❌ Помилка копіювання');
    }
  };

  const showSuccessMessage = (text: string) => {
    const successMsg = document.createElement('div');
    successMsg.textContent = text;
    successMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; z-index: 10000; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
    document.body.appendChild(successMsg);
    setTimeout(() => {
      if (document.body.contains(successMsg)) {
        document.body.removeChild(successMsg);
      }
    }, 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg">Діагностика</h3>
            <button
              className="btn btn-sm btn-circle btn-ghost"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
          <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto whitespace-pre-wrap font-mono">
            {message}
          </pre>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <button
            className="btn btn-sm btn-primary"
            onClick={handleCopy}
          >
            📋 Копіювати
          </button>
          <button
            className="btn btn-sm"
            onClick={onClose}
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}

// Функція для показу alert з можливістю копіювання
function showCopyableAlert(message: string) {
  // Створюємо модальне вікно
  const modalContainer = document.createElement('div');
  modalContainer.id = 'diagnostic-modal-container';
  document.body.appendChild(modalContainer);
  
  // Рендеримо React компонент
  const root = document.createElement('div');
  modalContainer.appendChild(root);
  
  const reactRoot = createRoot(root);
  reactRoot.render(
    React.createElement(DiagnosticModal, {
      message,
      onClose: () => {
        reactRoot.unmount();
        if (document.body.contains(modalContainer)) {
          document.body.removeChild(modalContainer);
        }
      },
    })
  );
}

type DirectMaster = {
  id: string;
  name: string;
  telegramUsername?: string;
  role: 'master' | 'direct-manager' | 'admin';
  altegioStaffId?: number;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY_DIRECT_ADMIN_TOKEN = 'direct_admin_token';

function DirectPageContent() {
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams?.get('token') ?? '';
  const [tokenFromStorage, setTokenFromStorage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem(STORAGE_KEY_DIRECT_ADMIN_TOKEN);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (tokenFromUrl && typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(STORAGE_KEY_DIRECT_ADMIN_TOKEN, tokenFromUrl);
        setTokenFromStorage(tokenFromUrl);
      } catch (_) {}
    }
  }, [tokenFromUrl]);

  const adminTokenForModal = tokenFromUrl || tokenFromStorage || undefined;

  // Логуємо кожен ре-рендер компонента
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  console.log(`[DirectPage] 🎨 Component render #${renderCountRef.current}`, {
    timestamp: new Date().toISOString()
  });
  
  const [clients, setClients] = useState<DirectClient[]>([]);
  const [totalClientsCount, setTotalClientsCount] = useState<number>(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [daysCounts, setDaysCounts] = useState<{ none: number; growing: number; grown: number; overgrown: number }>({ none: 0, growing: 0, grown: 0, overgrown: 0 });
  const [stateCounts, setStateCounts] = useState<Record<string, number>>({});
  const [instCounts, setInstCounts] = useState<Record<string, number>>({});
  const [clientTypeCounts, setClientTypeCounts] = useState<{ leads: number; clients: number; consulted: number; good: number; stars: number }>({ leads: 0, clients: 0, consulted: 0, good: 0, stars: 0 });
  const [consultationCounts, setConsultationCounts] = useState<Record<string, number>>({});
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});
  const [binotelCallsFilterCounts, setBinotelCallsFilterCounts] = useState<{
    incoming: number;
    outgoing: number;
    success: number;
    fail: number;
    onlyNew?: number;
  }>({ incoming: 0, outgoing: 0, success: 0, fail: 0, onlyNew: 0 });
  const [statuses, setStatuses] = useState<DirectStatus[]>([]);
  const [masters, setMasters] = useState<DirectMaster[]>([]);
  const [chatStatuses, setChatStatuses] = useState<DirectChatStatus[]>([]);
  const [callStatuses, setCallStatuses] = useState<DirectCallStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isInitialPrefetchCompleted, setIsInitialPrefetchCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWebhooksModalOpen, setIsWebhooksModalOpen] = useState(false);
  const [isManyChatWebhooksModalOpen, setIsManyChatWebhooksModalOpen] = useState(false);
  const [isTelegramMessagesModalOpen, setIsTelegramMessagesModalOpen] = useState(false);
  const [isAdminToolsModalOpen, setIsAdminToolsModalOpen] = useState(false);
  const [isEditingColumnWidths, setIsEditingColumnWidths] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [shouldOpenAddClient, setShouldOpenAddClient] = useState(false);
  const [shouldOpenAddMaster, setShouldOpenAddMaster] = useState(false);
  const [shouldOpenAddStatus, setShouldOpenAddStatus] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string> | null>(null);
  const [currentUser, setCurrentUser] = useState<{ login: string; name?: string } | null>(null);
  const [isLoginMenuOpen, setIsLoginMenuOpen] = useState(false);
  const loginMenuRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<DirectFilters>({
    statusId: "",
    statusIds: [],
    masterId: "",
    source: "",
    search: "",
    hasAppointment: "",
    clientType: [],
    act: { mode: null },
    days: null,
    inst: [],
    state: [],
    consultation: {
      hasConsultation: null,
      created: { mode: null },
      createdPreset: null,
      appointed: { mode: null },
      appointedPreset: null,
      attendance: null,
      type: null,
      masterIds: [],
    },
    record: {
      hasRecord: null,
      newClient: null,
      created: { mode: null },
      createdPreset: null,
      appointed: { mode: null },
      appointedPreset: null,
      client: null,
      sum: null,
    },
    master: { hands: null, primaryMasterIds: [], secondaryMasterIds: [] },
    binotelCalls: { direction: [], outcome: [], onlyNew: false },
    columnFilterMode: 'and',
  });
  // Значення поля пошуку в хедері (з debounce перед застосуванням до filters)
  const [displaySearch, setDisplaySearch] = useState('');
  useEffect(() => {
    setDisplaySearch((prev) => (filters.search ?? '') !== prev ? (filters.search ?? '') : prev);
  }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === displaySearch ? f : { ...f, search: displaySearch }));
    }, 400);
    return () => clearTimeout(t);
  }, [displaySearch]);
  const hasAutoMergedDuplicates = useRef(false); // Флаг для відстеження, чи вже виконано автоматичне об'єднання
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Закриваємо випадаюче меню кнопки "+" при кліку поза ним
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };

    if (isAddMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isAddMenuOpen]);

  // Закриваємо випадаюче меню логіну при кліку поза ним
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (loginMenuRef.current && !loginMenuRef.current.contains(event.target as Node)) {
        setIsLoginMenuOpen(false);
      }
    };
    if (isLoginMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isLoginMenuOpen]);
  
  const ALLOWED_SORT_BY = new Set([
    'updatedAt', 'createdAt', 'firstContactDate', 'spent', 'instagramUsername',
    'daysSinceLastVisit', 'messagesTotal', 'consultationBookingDate', 'paidServiceDate',
    'state', 'masterId', 'statusId',
  ]);

  // Ініціалізуємо сортування з localStorage (якщо є збережене значення)
  const sortByInitializer = useRef<(() => string) | null>(null);
  if (!sortByInitializer.current) {
    sortByInitializer.current = () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('direct-sort-by');
        if (saved && ALLOWED_SORT_BY.has(saved)) return saved;
      }
      return 'updatedAt';
    };
  }
  
  const [sortBy, setSortBy] = useState<string>(sortByInitializer.current);
  
  // Логуємо sortBy при кожному ре-рендері
  useEffect(() => {
    console.log('[DirectPage] 🔍 sortBy value in render:', { sortBy, viewMode, timestamp: new Date().toISOString() });
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('direct-sort-order');
      console.log('[DirectPage] 🔍 Initializing sortOrder from localStorage:', { saved });
      if (saved === 'asc' || saved === 'desc') {
        console.log('[DirectPage] ✅ Using saved sortOrder:', saved);
        return saved;
      } else {
        console.log('[DirectPage] ⚠️ Invalid or missing sortOrder in localStorage, using default: desc');
      }
    }
    return 'desc';
  });

  // Визначаємо режим на основі сортування
  const viewMode: 'passive' | 'active' = sortBy === 'updatedAt' && sortOrder === 'desc' ? 'active' : 'passive';

  const filtersRef = useRef(filters);
  const sortByRef = useRef(sortBy);
  const sortOrderRef = useRef(sortOrder);
  // Клієнти, для яких щойно очистили візити — щоб наступний loadClients не перезаписав старий кеш
  const recentlyClearedVisitsRef = useRef<Map<string, { consultationClearedAt?: number; paidClearedAt?: number }>>(new Map());
  const loadMoreOffsetRef = useRef(0);
  const loadedClientsCountRef = useRef(0);
  const initialPrefetchInFlightRef = useRef(false);
  const CLEARED_VISITS_GRACE_MS = 60 * 60 * 1000; // 1 год — захист від повернення консультації після refetch (якщо API/БД повертає старі дані)
  // Після очищення візитів тимчасово не робимо авто-refetch, щоб таблиця не перезаписалась застарілими даними
  const pauseAutoRefreshUntilRef = useRef<number>(0);
  filtersRef.current = filters;
  sortByRef.current = sortBy;
  sortOrderRef.current = sortOrder;

  // Query-рядок фільтрів для посилання на Статистику (ті самі фільтри, що й таблиця).
  const statsFiltersQuery = useMemo(() => {
    const f = filters;
    const params = new URLSearchParams();
    if (f.statusIds?.length) params.set("statusIds", f.statusIds.join(","));
    else if (f.statusId) params.set("statusId", f.statusId);
    if (f.masterId) params.set("masterId", f.masterId);
    if (f.source) params.set("source", f.source);
    if (f.search) params.set("search", f.search);
    if (f.hasAppointment === "true") params.set("hasAppointment", "true");
    if (f.clientType?.length) params.set("clientType", f.clientType.join(","));
    if (f.act.mode === "current_month") params.set("actMode", "current_month");
    else if (f.act.mode === "year_month" && f.act.year && f.act.month) {
      params.set("actMode", "year_month");
      params.set("actYear", f.act.year);
      params.set("actMonth", f.act.month);
    }
    if (f.days) params.set("days", f.days);
    if (f.inst?.length) params.set("inst", f.inst.join(","));
    if (f.state?.length) params.set("state", f.state.join(","));
    const c = f.consultation;
    if (c.hasConsultation === true) params.set("consultHasConsultation", "true");
    if (c.created.mode === "current_month") params.set("consultCreatedMode", "current_month");
    else if (c.created.mode === "year_month" && c.created.year && c.created.month) {
      params.set("consultCreatedMode", "year_month");
      params.set("consultCreatedYear", c.created.year);
      params.set("consultCreatedMonth", c.created.month);
    }
    if (c.createdPreset) params.set("consultCreatedPreset", c.createdPreset);
    if (c.appointed.mode === "current_month") params.set("consultAppointedMode", "current_month");
    else if (c.appointed.mode === "year_month" && c.appointed.year && c.appointed.month) {
      params.set("consultAppointedMode", "year_month");
      params.set("consultAppointedYear", c.appointed.year);
      params.set("consultAppointedMonth", c.appointed.month);
    }
    if (c.appointedPreset) params.set("consultAppointedPreset", c.appointedPreset);
    if (c.attendance) params.set("consultAttendance", c.attendance);
    if (c.type) params.set("consultType", c.type);
    if (c.masterIds?.length) params.set("consultMasters", c.masterIds.join("|"));
    const r = f.record;
    if (r.hasRecord === true) params.set("recordHasRecord", "true");
    if (r.newClient === true) params.set("recordNewClient", "true");
    if (r.created.mode === "current_month") params.set("recordCreatedMode", "current_month");
    else if (r.created.mode === "year_month" && r.created.year && r.created.month) {
      params.set("recordCreatedMode", "year_month");
      params.set("recordCreatedYear", r.created.year);
      params.set("recordCreatedMonth", r.created.month);
    }
    if (r.createdPreset) params.set("recordCreatedPreset", r.createdPreset);
    if (r.appointed.mode === "current_month") params.set("recordAppointedMode", "current_month");
    else if (r.appointed.mode === "year_month" && r.appointed.year && r.appointed.month) {
      params.set("recordAppointedMode", "year_month");
      params.set("recordAppointedYear", r.appointed.year);
      params.set("recordAppointedMonth", r.appointed.month);
    }
    if (r.appointedPreset) params.set("recordAppointedPreset", r.appointedPreset);
    if (r.client) params.set("recordClient", r.client);
    if (r.sum) params.set("recordSum", r.sum);
    if (f.master?.hands) params.set("masterHands", String(f.master.hands));
    if (f.master?.primaryMasterIds?.length) params.set("masterPrimary", f.master.primaryMasterIds.join("|"));
    if (f.master?.secondaryMasterIds?.length) params.set("masterSecondary", f.master.secondaryMasterIds.join("|"));
    params.set("columnFilterMode", (f.columnFilterMode ?? "and") === "and" ? "and" : "or");
    return params.toString();
  }, [filters]);
  
  // Функція для встановлення режиму через сортування
  const setViewMode = (mode: 'passive' | 'active') => {
    const stack = new Error().stack;
    console.log('[DirectPage] 🎚️ setViewMode called:', { 
      mode, 
      currentViewMode: viewMode,
      currentSortBy: sortBy,
      currentSortOrder: sortOrder,
      timestamp: new Date().toISOString(),
      stack: stack?.split('\n').slice(1, 6).join('\n') // Більше рядків для кращого трейсу
    });
    
    // Перевіряємо, чи режим вже встановлений - якщо так, не робимо нічого
    const expectedSortBy = mode === 'active' ? 'updatedAt' : 'firstContactDate';
    const expectedSortOrder = 'desc';
    
    if (sortBy === expectedSortBy && sortOrder === expectedSortOrder) {
      console.log('[DirectPage] ⏭️ setViewMode: mode already set, skipping');
      return;
    }
    
    if (mode === 'active') {
      console.log('[DirectPage] ✅ Setting active mode: updatedAt desc');
      setSortBy('updatedAt');
      setSortOrder('desc');
      if (typeof window !== 'undefined') {
        localStorage.setItem('direct-sort-by', 'updatedAt');
        localStorage.setItem('direct-sort-order', 'desc');
      }
    } else {
      console.log('[DirectPage] ✅ Setting passive mode: firstContactDate desc');
      setSortBy('firstContactDate');
      setSortOrder('desc');
      if (typeof window !== 'undefined') {
        localStorage.setItem('direct-sort-by', 'firstContactDate');
        localStorage.setItem('direct-sort-order', 'desc');
      }
    }
  };
  
  // Зберігаємо sortBy і sortOrder в localStorage при зміні
  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('[DirectPage] 🔄 sortBy/sortOrder changed:', { 
        sortBy, 
        sortOrder, 
        viewMode,
        timestamp: new Date().toISOString(),
      });
      localStorage.setItem('direct-sort-by', sortBy);
      localStorage.setItem('direct-sort-order', sortOrder);
    }
  }, [sortBy, sortOrder, viewMode]);
  
  // Захист активного режиму: відновлюємо updatedAt desc лише якщо в localStorage збережено active.
  // Якщо користувач обрав сортування по колонці (не active) — не перезаписуємо.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window === 'undefined') return;
      const isPassiveByChoice = sortBy !== 'updatedAt' || sortOrder !== 'desc';
      if (isPassiveByChoice) return;

      const savedSortBy = localStorage.getItem('direct-sort-by');
      const savedSortOrder = localStorage.getItem('direct-sort-order');
      if (savedSortBy === 'updatedAt' && savedSortOrder === 'desc') {
        if (sortBy !== 'updatedAt' || sortOrder !== 'desc') {
          setSortBy('updatedAt');
          setSortOrder('desc');
        }
        return;
      }
      if (savedSortBy === 'updatedAt' && savedSortOrder !== 'desc') {
        setSortOrder('desc');
      }
    }, 500);

    return () => clearInterval(interval);
  }, [sortBy, sortOrder]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.ok) {
          if (data.permissions) setPermissions(data.permissions);
          if (data.user?.login != null) setCurrentUser({ login: data.user.login, name: data.user.name });
        } else if (!cancelled) {
          setPermissions({});
        }
      })
      .catch(() => {
        if (!cancelled) setPermissions({});
      });
    return () => { cancelled = true; };
  }, []);

  const showFinanceReport = permissions == null || permissions.financeReportSection !== "none";
  const showBank = permissions == null || permissions.bankSection !== "none";
  const showDebug = permissions == null || permissions.debugSection !== "none";
  const showAccess = permissions == null || permissions.accessSection !== "none";
  const showStatusesCreate = permissions == null || permissions.statusesCreateSubsection !== "none";
  const hideSalesColumn = permissions?.salesColumn === "none";
  const hideActionsColumn = permissions?.actionsColumn === "none";
  const hideFinances = permissions?.finances === "none";
  const canListenCalls = permissions == null || permissions.callsListen !== "none";

  // Функція для завантаження статусів та майстрів
  const loadStatusesAndMasters = async () => {
    const [statusesResult, mastersResult, chatResult, callResult] = await Promise.allSettled([
      fetch("/api/admin/direct/statuses"),
      fetch("/api/admin/direct/masters"),
      fetch("/api/admin/direct/chat-statuses"),
      fetch("/api/admin/direct/call-statuses"),
    ]);

    if (statusesResult.status === "fulfilled") {
      if (statusesResult.value.ok) {
        const statusesData = await statusesResult.value.json();
        if (statusesData.ok && statusesData.statuses) {
          setStatuses(statusesData.statuses);
          console.log(`[DirectPage] Loaded ${statusesData.statuses.length} statuses`);
        }
      } else {
        console.warn(`[DirectPage] Failed to load statuses: ${statusesResult.value.status} ${statusesResult.value.statusText}`);
      }
    } else {
      console.warn("[DirectPage] Failed to load statuses:", statusesResult.reason);
    }

    if (mastersResult.status === "fulfilled") {
      if (mastersResult.value.ok) {
        const mastersData = await mastersResult.value.json();
        if (mastersData.ok && mastersData.masters) {
          setMasters(mastersData.masters);
          console.log(`[DirectPage] Loaded ${mastersData.masters.length} masters (all roles)`);
        }
      } else {
        console.warn(`[DirectPage] Failed to load masters: ${mastersResult.value.status} ${mastersResult.value.statusText}`);
      }
    } else {
      console.warn("[DirectPage] Failed to load masters:", mastersResult.reason);
    }

    if (chatResult.status === "fulfilled") {
      if (chatResult.value.ok) {
        const chatData = await chatResult.value.json();
        if (chatData.ok && Array.isArray(chatData.statuses)) {
          setChatStatuses(chatData.statuses);
          console.log(`[DirectPage] Loaded ${chatData.statuses.length} chat statuses`);
        }
      }
    } else {
      console.warn("[DirectPage] Failed to load chat statuses:", chatResult.reason);
    }

    if (callResult.status === "fulfilled") {
      if (callResult.value.ok) {
        const callData = await callResult.value.json();
        if (callData.ok && Array.isArray(callData.statuses)) {
          setCallStatuses(callData.statuses);
          console.log(`[DirectPage] Loaded ${callData.statuses.length} call statuses`);
        }
      }
    } else {
      console.warn("[DirectPage] Failed to load call statuses:", callResult.reason);
    }
  };

  /** Мʼяке оновлення тільки статусів (Direct) — без перезавантаження сторінки */
  const loadStatusesOnly = async () => {
    try {
      const statusesRes = await fetch("/api/admin/direct/statuses");
      if (statusesRes.ok) {
        const data = await statusesRes.json();
        if (data.ok && data.statuses) {
          setStatuses(data.statuses);
        }
      }
    } catch (err) {
      console.warn("[DirectPage] Failed to refresh statuses:", err);
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    setIsInitialPrefetchCompleted(false);
    try {
      // Двоетапний старт: спочатку 15 (швидкий first render), потім авто-догруз +35
      const initialLimit = INITIAL_BATCH_LIMIT;
      await Promise.all([
        loadStatusesAndMasters(),
        loadClients(true, {
          limit: initialLimit,
          offset: 0,
          append: false,
          lightweight: true,
          prefetchAfterLoadCount: INITIAL_PREFETCH_COUNT,
        }),
      ]);

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const ACTIVE_BASE_LIMIT = 50;
  const INITIAL_BATCH_LIMIT = 15;
  const INITIAL_PREFETCH_COUNT = 35;
  const enableAutoMergeOnInitialLoad = false;

  const loadClients = async (
    skipMergeDuplicates = false,
    options?: {
      limit?: number;
      offset?: number;
      append?: boolean;
      lightweight?: boolean;
      prefetchAfterLoadCount?: number;
    }
  ) => {
    const f = filtersRef.current;
    const sBy = sortByRef.current;
    const sOrder = sortOrderRef.current;
    // Завжди читаємо актуальне значення sortBy з localStorage, щоб уникнути stale closure
    let currentSortBy = sBy;
    let currentSortOrder = sOrder;
    
    if (typeof window !== 'undefined') {
      const savedSortBy = localStorage.getItem('direct-sort-by');
      const savedSortOrder = localStorage.getItem('direct-sort-order');
      
      if (savedSortBy && ALLOWED_SORT_BY.has(savedSortBy) && savedSortBy !== currentSortBy) {
        currentSortBy = savedSortBy;
      }
      if (savedSortOrder === 'asc' || savedSortOrder === 'desc') {
        if (savedSortOrder !== currentSortOrder) {
          console.warn('[DirectPage] ⚠️ loadClients: sortOrder mismatch! State:', currentSortOrder, 'localStorage:', savedSortOrder, '- using localStorage');
          currentSortOrder = savedSortOrder;
        }
      }
    }
    
    // Автоматично об'єднуємо дублікати перед завантаженням клієнтів (тільки один раз при першому завантаженні)
    if (enableAutoMergeOnInitialLoad && !skipMergeDuplicates && !hasAutoMergedDuplicates.current) {
      try {
        console.log('[DirectPage] Автоматичне об\'єднання дублікатів...');
        const mergeRes = await fetch('/api/admin/direct/merge-duplicates-by-name', {
          method: 'POST',
        });
        const mergeData = await mergeRes.json();
        if (mergeData.ok) {
          hasAutoMergedDuplicates.current = true; // Позначаємо, що об'єднання вже виконано
          if (mergeData.totalMerged > 0) {
            console.log(`[DirectPage] ✅ Автоматично об'єднано ${mergeData.totalMerged} дублікатів`);
          } else {
            console.log('[DirectPage] ✅ Дублікатів для об\'єднання не знайдено');
          }
        }
      } catch (mergeErr) {
        console.warn('[DirectPage] Помилка автоматичного об\'єднання дублікатів (некритично):', mergeErr);
        // Не блокуємо завантаження клієнтів, якщо об'єднання не вдалося
        // Але не позначаємо, що об'єднання виконано, щоб спробувати наступного разу
      }
    }
    
    try {
      const params = new URLSearchParams();
      if (f.search && f.search.trim()) params.set("search", f.search.trim());
      if (f.statusIds?.length) params.set("statusIds", f.statusIds.join(","));
      else if (f.statusId) params.set("statusId", f.statusId);
      if (f.masterId) params.set("masterId", f.masterId);
      if (f.source) params.set("source", f.source);
      if (f.hasAppointment === "true") params.set("hasAppointment", "true");
      if (f.clientType && f.clientType.length > 0) {
        params.set("clientType", f.clientType.join(","));
      }
      if (f.act.mode === "current_month") params.set("actMode", "current_month");
      else if (f.act.mode === "year_month" && f.act.year && f.act.month) {
        params.set("actMode", "year_month");
        params.set("actYear", f.act.year);
        params.set("actMonth", f.act.month);
      }
      if (f.days) params.set("days", f.days);
      if (f.inst.length > 0) params.set("inst", f.inst.join(","));
      if (f.state.length > 0) params.set("state", f.state.join(","));
      const c = f.consultation;
      if (c.hasConsultation === true) params.set("consultHasConsultation", "true");
      if (c.created.mode === "current_month") params.set("consultCreatedMode", "current_month");
      else if (c.created.mode === "year_month" && c.created.year && c.created.month) {
        params.set("consultCreatedMode", "year_month");
        params.set("consultCreatedYear", c.created.year);
        params.set("consultCreatedMonth", c.created.month);
      }
      if (c.createdPreset) params.set("consultCreatedPreset", c.createdPreset);
      if (c.appointed.mode === "current_month") params.set("consultAppointedMode", "current_month");
      else if (c.appointed.mode === "year_month" && c.appointed.year && c.appointed.month) {
        params.set("consultAppointedMode", "year_month");
        params.set("consultAppointedYear", c.appointed.year);
        params.set("consultAppointedMonth", c.appointed.month);
      }
      if (c.appointedPreset) params.set("consultAppointedPreset", c.appointedPreset);
      if (c.attendance) params.set("consultAttendance", c.attendance);
      if (c.type) params.set("consultType", c.type);
      if (c.masterIds.length > 0) params.set("consultMasters", c.masterIds.join("|"));
      const r = f.record;
      if (r.hasRecord === true) params.set("recordHasRecord", "true");
      if (r.newClient === true) params.set("recordNewClient", "true");
      if (r.created.mode === "current_month") params.set("recordCreatedMode", "current_month");
      else if (r.created.mode === "year_month" && r.created.year && r.created.month) {
        params.set("recordCreatedMode", "year_month");
        params.set("recordCreatedYear", r.created.year);
        params.set("recordCreatedMonth", r.created.month);
      }
      if (r.createdPreset) params.set("recordCreatedPreset", r.createdPreset);
      if (r.appointed.mode === "current_month") params.set("recordAppointedMode", "current_month");
      else if (r.appointed.mode === "year_month" && r.appointed.year && r.appointed.month) {
        params.set("recordAppointedMode", "year_month");
        params.set("recordAppointedYear", r.appointed.year);
        params.set("recordAppointedMonth", r.appointed.month);
      }
      if (r.appointedPreset) params.set("recordAppointedPreset", r.appointedPreset);
      if (r.client) params.set("recordClient", r.client);
      if (r.sum) params.set("recordSum", r.sum);
      if (f.master.hands) params.set("masterHands", String(f.master.hands));
      if (f.master.primaryMasterIds.length > 0) params.set("masterPrimary", f.master.primaryMasterIds.join("|"));
      if (f.master.secondaryMasterIds.length > 0) params.set("masterSecondary", f.master.secondaryMasterIds.join("|"));
      const bc = f.binotelCalls ?? { direction: [] as string[], outcome: [] as string[], onlyNew: false };
      if (bc.direction?.length > 0) params.set("binotelCallsDirection", bc.direction.join(","));
      if (bc.outcome?.length > 0) params.set("binotelCallsOutcome", bc.outcome.join(","));
      if (bc.onlyNew) params.set("binotelCallsOnlyNew", "true");
      params.set("columnFilterMode", (f.columnFilterMode ?? "and") === "and" ? "and" : "or");
      params.set("sortBy", currentSortBy);
      params.set("sortOrder", currentSortOrder);

      // Активна база: limit/offset для infinite scroll
      // Коли активний фільтр «Днів» або «Дзвінки» — завантажуємо всіх відфільтрованих, без обмеження 50
      const hasBinotelFilter =
        (bc.direction?.length ?? 0) > 0 || (bc.outcome?.length ?? 0) > 0 || (bc.onlyNew ?? false);
      const useLimit = (f.days && !options?.append) || (hasBinotelFilter && !options?.append)
        ? 0  // 0 = без limit, API поверне усіх
        : (options?.limit ?? ACTIVE_BASE_LIMIT);
      const useOffset = options?.offset ?? 0;
      const append = options?.append ?? false;
      if (useLimit > 0) {
        params.set("limit", String(useLimit));
        params.set("offset", String(useOffset));
      }

      const currentViewMode = currentSortBy === 'updatedAt' && currentSortOrder === 'desc' ? 'active' : 'passive';
      console.log('[DirectPage] Loading clients...', {
        filters: f,
        sortBy: currentSortBy,
        sortOrder: currentSortOrder,
        viewMode: currentViewMode,
        stateSortBy: sBy,
        stateSortOrder: sOrder
      });
      // Один запит — API повертає counts у відповіді при limit (з повного списку до фільтрації)
      if (options?.lightweight) {
        params.set("lightweight", "1");
      }
      const requestStartedAt = Date.now();
      const res = await fetch(`/api/admin/direct/clients?${params.toString()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      
      // Якщо помилка HTTP, не очищаємо клієнтів
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[DirectPage] Failed to load clients: ${res.status} ${res.statusText}`, errorText);
        // Не очищаємо клієнтів при помилці, щоб вони залишилися на екрані
        setError(`Помилка завантаження: ${res.status} ${res.statusText}`);
        return;
      }
      
      const data = await res.json();
      const requestMs = Date.now() - requestStartedAt;
      console.log('[DirectPage] loadClients timing (ms):', requestMs, { lightweight: options?.lightweight === true, limit: useLimit, offset: useOffset, append });
      console.log('[DirectPage] Clients response:', { 
        ok: data.ok, 
        clientsCount: data.clients?.length, 
        error: data.error,
        warning: data.warning,
        debug: data.debug,
      });
      
      if (data.totalCount !== undefined) {
        setTotalClientsCount(data.totalCount);
      }
      // Counts фільтрів тепер приходять з основної відповіді (при limit) — один запит
      if (data.statusCounts && typeof data.statusCounts === 'object') setStatusCounts(data.statusCounts);
      if (data.daysCounts && typeof data.daysCounts === 'object') {
        setDaysCounts({
          none: Number(data.daysCounts.none ?? 0),
          growing: Number(data.daysCounts.growing ?? 0),
          grown: Number(data.daysCounts.grown ?? 0),
          overgrown: Number(data.daysCounts.overgrown ?? 0),
        });
      }
      if (data.stateCounts && typeof data.stateCounts === 'object') setStateCounts(data.stateCounts);
      if (data.instCounts && typeof data.instCounts === 'object') setInstCounts(data.instCounts);
      if (data.clientTypeCounts && typeof data.clientTypeCounts === 'object') setClientTypeCounts(data.clientTypeCounts);
      if (data.consultationCounts && typeof data.consultationCounts === 'object') setConsultationCounts(data.consultationCounts);
      if (data.recordCounts && typeof data.recordCounts === 'object') setRecordCounts(data.recordCounts);
      if (data.binotelCallsFilterCounts && typeof data.binotelCallsFilterCounts === 'object') {
        setBinotelCallsFilterCounts({
          incoming: Number(data.binotelCallsFilterCounts.incoming ?? 0),
          outgoing: Number(data.binotelCallsFilterCounts.outgoing ?? 0),
          success: Number(data.binotelCallsFilterCounts.success ?? 0),
          fail: Number(data.binotelCallsFilterCounts.fail ?? 0),
          onlyNew: Number(data.binotelCallsFilterCounts.onlyNew ?? 0),
        });
      }

      if (data.ok && Array.isArray(data.clients)) {
        let filteredClients = data.clients;

        // Пошук по Instagram username та Повне ім'я
        if (f.search) {
          const searchLower = f.search.toLowerCase();
          filteredClients = filteredClients.filter((c: DirectClient) => {
            // Пошук по Instagram username
            const matchesInstagram = c.instagramUsername?.toLowerCase().includes(searchLower) || false;
            
            // Пошук по окремих частинах імені
            const matchesFirstName = c.firstName?.toLowerCase().includes(searchLower) || false;
            const matchesLastName = c.lastName?.toLowerCase().includes(searchLower) || false;
            
            // Пошук по повному імені (firstName + lastName разом)
            const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').toLowerCase();
            const matchesFullName = fullName.includes(searchLower);
            
            return matchesInstagram || matchesFirstName || matchesLastName || matchesFullName;
          });
        }

        console.log('[DirectPage] Setting clients:', filteredClients.length, 'from API:', data.clients.length, 'append:', append);
        if (filteredClients.length === 0 && clients.length > 0 && !append) {
          console.warn('[DirectPage] API returned 0 clients, but we have existing clients. Keeping existing clients.');
          setError('Помилка завантаження: API повернув 0 клієнтів. Показуємо попередні дані.');
          return;
        }
        // Зливаємо з нещодавно очищеними візитами (altegioClientId → id → instagramUsername)
        const merged = filteredClients.map((c) => {
          const keyByAltegio = c.altegioClientId != null ? String(c.altegioClientId) : null;
          const keyByUsername = (c.instagramUsername ?? '').toString().trim().toLowerCase();
          const entry = (keyByAltegio ? recentlyClearedVisitsRef.current.get(keyByAltegio) : undefined)
            || recentlyClearedVisitsRef.current.get(c.id)
            || (keyByUsername ? recentlyClearedVisitsRef.current.get(keyByUsername) : undefined);
          if (!entry) return c;
          const now = Date.now();
          const consultationStillCleared = (entry.consultationClearedAt ?? 0) > 0 && now - entry.consultationClearedAt < CLEARED_VISITS_GRACE_MS;
          const paidStillCleared = (entry.paidClearedAt ?? 0) > 0 && now - entry.paidClearedAt < CLEARED_VISITS_GRACE_MS;
          if (!consultationStillCleared && !paidStillCleared) return c;
          const next = { ...c };
          if (consultationStillCleared) {
            next.consultationBookingDate = undefined;
            next.consultationAttended = undefined;
            next.consultationMasterName = undefined;
            next.consultationMasterId = undefined;
            next.isOnlineConsultation = false;
            next.consultationCancelled = false;
            next.consultationDeletedInAltegio = true;
          }
          if (paidStillCleared) {
            next.paidServiceDate = undefined;
            next.paidServiceAttended = undefined;
            next.signedUpForPaidService = false;
            next.paidServiceVisitId = undefined;
            next.paidServiceRecordId = undefined;
            next.paidServiceVisitBreakdown = undefined;
            next.paidServiceTotalCost = undefined;
            next.paidServiceDeletedInAltegio = true;
          }
          return next;
        });
        console.log('[DirectPage] 🔄 Before setClients:', { sortBy, sortOrder, viewMode, append, mergedCount: merged.length });
        if (append) {
          // Infinite scroll: зливаємо з існуючими, уникаємо дублікатів за id
          setClients((prev) => {
            const prevIds = new Set(prev.map((c) => c.id));
            const newUnique = merged.filter((c) => !prevIds.has(c.id));
            loadedClientsCountRef.current = prev.length + newUnique.length;
            return [...prev, ...newUnique];
          });
          loadMoreOffsetRef.current = (options?.offset ?? 0) + merged.length; // Оновлюємо для наступного load more
        } else {
          setClients(merged);
          loadedClientsCountRef.current = merged.length;
          loadMoreOffsetRef.current = merged.length;
        }

        const prefetchAfterLoadCount = options?.prefetchAfterLoadCount ?? 0;
        if (!append && prefetchAfterLoadCount > 0 && !initialPrefetchInFlightRef.current) {
          initialPrefetchInFlightRef.current = true;
          const prefetchOffset = merged.length;
          const prefetchStartedAt = Date.now();
          void loadClients(true, {
            limit: prefetchAfterLoadCount,
            offset: prefetchOffset,
            append: true,
            lightweight: true,
          })
            .catch((prefetchErr) => {
              console.warn('[DirectPage] Initial prefetch +35 failed (non-critical):', prefetchErr);
            })
            .finally(() => {
              const prefetchMs = Date.now() - prefetchStartedAt;
              console.log('[DirectPage] Initial prefetch timing (ms):', prefetchMs, {
                prefetchCount: prefetchAfterLoadCount,
                prefetchOffset,
              });
              setIsInitialPrefetchCompleted(true);
              initialPrefetchInFlightRef.current = false;
            });
        } else if (!append && prefetchAfterLoadCount === 0) {
          setIsInitialPrefetchCompleted(true);
        }
        console.log('[DirectPage] 🔄 After setClients:', { sortBy, sortOrder, viewMode });
        setError(null); // Очищаємо помилку при успішному завантаженні
        
        // Перевіряємо sortBy після setClients
        setTimeout(() => {
          console.log('[DirectPage] 🔄 After setClients (next tick):', { sortBy, sortOrder, viewMode });
          if (typeof window !== 'undefined') {
            const savedSortBy = localStorage.getItem('direct-sort-by');
            const savedSortOrder = localStorage.getItem('direct-sort-order');
            console.log('[DirectPage] 🔄 localStorage after setClients:', { savedSortBy, savedSortOrder });
          }
        }, 0);
        
        // Якщо клієнти завантажилися успішно, але статуси/майстри відсутні - завантажуємо їх
        if (filteredClients.length > 0 && (statuses.length === 0 || masters.length === 0)) {
          console.log('[DirectPage] Clients loaded but statuses/masters missing, loading them...');
          loadStatusesAndMasters();
        }
      } else {
        const errorMsg = data.error || "Unknown error";
        console.error('[DirectPage] Failed to load clients:', errorMsg, data);
        setError(`Помилка: ${errorMsg}`);
        // Не очищаємо клієнтів при помилці, щоб вони залишилися на екрані
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[DirectPage] Error loading clients:', err);
      setError(`Помилка: ${errorMsg}`);
      // Не очищаємо клієнтів при помилці, щоб вони залишилися на екрані
    }
  };


  // Завантажуємо клієнтів при зміні фільтрів/сортування
  // Використовуємо useRef, щоб уникнути зайвих викликів під час ініціалізації
  const isInitialMount = useRef(true);
  const prevFiltersRef = useRef(filters);
  const prevSortByRef = useRef(sortBy);
  const prevSortOrderRef = useRef(sortOrder);
  
  useEffect(() => {
    const stack = new Error().stack;
    const sortByChanged = prevSortByRef.current !== sortBy;
    const sortOrderChanged = prevSortOrderRef.current !== sortOrder;
    
    console.log('[DirectPage] 🔄 Filter/Sort useEffect triggered:', {
      sortBy,
      sortOrder,
      viewMode,
      sortByChanged,
      sortOrderChanged,
      prevSortBy: prevSortByRef.current,
      prevSortOrder: prevSortOrderRef.current,
      isInitialMount: isInitialMount.current,
      timestamp: new Date().toISOString(),
      stack: stack?.split('\n').slice(1, 6).join('\n')
    });
    
    // Перевіряємо, чи не змінився sortBy перед оновленням
    if (typeof window !== 'undefined') {
      const savedSortBy = localStorage.getItem('direct-sort-by');
      const savedSortOrder = localStorage.getItem('direct-sort-order');
      
      console.log('[DirectPage] 🔄 Checking localStorage in useEffect:', {
        savedSortBy,
        savedSortOrder,
        currentSortBy: sortBy,
        currentSortOrder: sortOrder
      });
      
      // Якщо в localStorage збережено активний режим, але поточний стан не відповідає - відновлюємо
      if (savedSortBy === 'updatedAt' && savedSortOrder === 'desc') {
        if (sortBy !== 'updatedAt' || sortOrder !== 'desc') {
          console.warn('[DirectPage] 🛡️ Filter change useEffect: restoring active mode before loadClients', {
            was: { sortBy, sortOrder },
            saved: { savedSortBy, savedSortOrder },
            restoring: { sortBy: 'updatedAt', sortOrder: 'desc' },
            timestamp: new Date().toISOString()
          });
          setSortBy('updatedAt');
          setSortOrder('desc');
          prevSortByRef.current = 'updatedAt';
          prevSortOrderRef.current = 'desc';
          return;
        }
      }
    }
    
    // Пропускаємо перший виклик, бо він вже відбувається в loadData()
    if (isInitialMount.current) {
      console.log('[DirectPage] ⏭️ Skipping initial mount');
      isInitialMount.current = false;
      prevFiltersRef.current = filters;
      prevSortByRef.current = sortBy;
      prevSortOrderRef.current = sortOrder;
      return;
    }
    
    prevFiltersRef.current = filters;
    prevSortByRef.current = sortBy;
    prevSortOrderRef.current = sortOrder;
    
    loadedClientsCountRef.current = 0; // скидаємо — це новий набір даних
    console.log('[DirectPage] ✅ Calling loadClients from useEffect');
    loadClients();
  }, [filters, sortBy, sortOrder]);

  // Автоматичне оновлення даних кожні 30 секунд: вебхуки Altegio, cron/sync та інші адміни змінюють дані в БД —
  // без періодичного refetch таблиця показувала б застарілий стан до перезавантаження або зміни фільтрів.
  // Після "Очистити видалені візити" паузимо авто-оновлення на 2 хв, щоб не перезаписати щойно очищені дані.
  useEffect(() => {
    const interval = setInterval(() => {
      if (pauseAutoRefreshUntilRef.current && Date.now() < pauseAutoRefreshUntilRef.current) {
        return; // пауза після очищення візитів
      }
      if (statuses.length === 0 || masters.length === 0) {
        loadStatusesAndMasters();
      }
      const preserveCount = Math.min(200, Math.max(ACTIVE_BASE_LIMIT, loadedClientsCountRef.current));
      loadClients(false, { limit: preserveCount, offset: 0, append: false }).catch(err => {
        console.warn('[DirectPage] Auto-refresh error (non-critical):', err);
      });
    }, 30000); // 30 секунд

    return () => clearInterval(interval);
  }, [statuses.length, masters.length]);

  const handleStatusMenuOpen = useCallback((clientId: string) => {
    // Prefetch: warm-up serverless перед PATCH при виборі статусу
    fetch(`/api/admin/direct/clients/${clientId}`, { cache: 'no-store' }).catch(() => {});
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      await loadClients(false, { limit: ACTIVE_BASE_LIMIT, offset: loadMoreOffsetRef.current, append: true });
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore]);

  const handleClientUpdate = async (clientId: string, updates: Partial<DirectClient>) => {
    if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
      alert('Помилка: ID клієнта відсутній');
      return;
    }
    try {
      const res = await fetch(`/api/admin/direct/clients/${clientId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.ok) {
        // Оновлюємо UI: мержимо data.client з API (містить statusSetAt при зміні статусу)
        setClients((prev) =>
          prev.map((c) =>
            c.id === clientId ? { ...c, ...(data.client || updates) } : c
          )
        );
      } else {
        // При 404 оновлюємо список — клієнт міг бути об'єднаний або видалений
        if (res.status === 404) {
          await loadClients();
        }
        alert(data.error || "Failed to update client");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStatusCreated = async () => {
    await loadData();
  };

  /** Оновити одного клієнта локально після sync API,KV (без перезавантаження всієї бази) */
  const handleClientSynced = (client: DirectClient) => {
    setClients((prev) =>
      prev.map((c) => (c.id === client.id ? { ...c, ...client } : c))
    );
    // Пауза auto-refresh на 30 сек, щоб loadClients не перезаписав щойно синхронізовані дані (крапочка не зникала)
    pauseAutoRefreshUntilRef.current = Date.now() + 30 * 1000;
  };

  const handleClearVisitsSuccess = (data: {
    clientId: string;
    altegioClientId?: number | null;
    instagramUsername?: string | null;
    clearedConsultation?: boolean;
    clearedPaid?: boolean;
  }) => {
    const now = Date.now();
    const entry = {
      consultationClearedAt: data.clearedConsultation ? now : undefined,
      paidClearedAt: data.clearedPaid ? now : undefined,
    };
    // Ключі: altegioClientId (основний), clientId, instagramUsername (для дублікатів і клієнтів без altegio)
    const keyByAltegio = data.altegioClientId != null ? String(data.altegioClientId) : null;
    const username = (data.instagramUsername ?? '').toString().trim().toLowerCase();
    if (keyByAltegio) recentlyClearedVisitsRef.current.set(keyByAltegio, entry);
    recentlyClearedVisitsRef.current.set(data.clientId, entry);
    if (username) recentlyClearedVisitsRef.current.set(username, entry);
    // На 2 хв призупиняємо авто-refetch (30 с), щоб таблиця не перезаписалась відповіддю API
    pauseAutoRefreshUntilRef.current = Date.now() + 2 * 60 * 1000;
    setClients((prev) =>
      prev.map((c) => {
        const matchByAltegio = data.altegioClientId != null && c.altegioClientId === data.altegioClientId;
        const matchById = c.id === data.clientId;
        const matchByUsername = username && (c.instagramUsername ?? '').toString().trim().toLowerCase() === username;
        if (!matchByAltegio && !matchById && !matchByUsername) return c;
        const next = { ...c };
        if (data.clearedConsultation) {
          next.consultationBookingDate = undefined;
          next.consultationAttended = undefined;
          next.consultationMasterName = undefined;
          next.consultationMasterId = undefined;
          next.isOnlineConsultation = false;
          next.consultationCancelled = false;
          next.consultationDeletedInAltegio = true;
        }
        if (data.clearedPaid) {
          next.paidServiceDate = undefined;
          next.paidServiceAttended = undefined;
          next.signedUpForPaidService = false;
          next.paidServiceVisitId = undefined;
          next.paidServiceRecordId = undefined;
          next.paidServiceVisitBreakdown = undefined;
          next.paidServiceTotalCost = undefined;
          next.paidServiceDeletedInAltegio = true;
        }
        return next;
      })
    );
  };

  const tableHeaderRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [bodyScrollLeft, setBodyScrollLeft] = useState(0);
  const [headerSlotReady, setHeaderSlotReady] = useState(false);
  const [scrollContentWidth, setScrollContentWidth] = useState<number | null>(null);
  const ignoreHeaderScroll = useRef(false);
  const ignoreBodyScroll = useRef(false);
  const setHeaderRef = useCallback((el: HTMLDivElement | null) => {
    (tableHeaderRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    setHeaderSlotReady(!!el);
  }, []);

  const onBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (ignoreBodyScroll.current) {
      ignoreBodyScroll.current = false;
      return;
    }
    const sl = el.scrollLeft;
    setBodyScrollLeft(sl);
    const header = tableHeaderRef.current;
    if (header && header.scrollLeft !== sl) {
      ignoreHeaderScroll.current = true;
      header.scrollLeft = sl;
    }
  }, []);

  const onHeaderScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (ignoreHeaderScroll.current) {
      ignoreHeaderScroll.current = false;
      return;
    }
    const sl = el.scrollLeft;
    setBodyScrollLeft(sl);
    const body = tableScrollRef.current;
    if (body && body.scrollLeft !== sl) {
      ignoreBodyScroll.current = true;
      body.scrollLeft = sl;
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const el = tableScrollRef.current;
    if (!el) return;
    const update = () => setScrollContentWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg"></div>
          <p className="mt-4 text-gray-600">Завантаження...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col w-full pb-1.5">
      {/* Хедер (навбар + рядок заголовків таблиці) — fixed вгорі */}
      <header className="fixed top-0 left-0 right-0 z-20 bg-white border-b border-gray-200 shrink-0 leading-none">
        <div className="w-full px-2 py-0 flex flex-col md:flex-row md:items-center md:justify-between gap-0.5">
        {/* Зліва: кнопка дірект + поле пошуку */}
        <div className="flex items-center gap-0.5 min-h-[20px] w-full md:max-w-[220px]">
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
            placeholder="Пошук: ім'я, прізвище, Instagram, телефон"
            className="input input-sm input-bordered w-full min-h-8 text-xs"
            aria-label="Пошук клієнтів"
          />
        </div>
        {/* Кнопки навігації — вирівняні по правому краю */}
        <div className="flex gap-0.5 items-center min-h-[20px] flex-1 justify-end">
          {/* Кнопки навігації до інших розділів */}
          {showBank && (
            <Link href="/admin/bank" className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight">
              🏦 Банк
            </Link>
          )}
          {showFinanceReport && (
            <Link href="/admin/finance-report" className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight">
              💰 Фінансовий звіт
            </Link>
          )}
          <Link href={statsFiltersQuery ? `/admin/direct/stats?${statsFiltersQuery}` : "/admin/direct/stats"} className="btn btn-ghost min-h-0 py-0.5 text-[10px] px-1 leading-tight" target="_blank" rel="noopener noreferrer">
            📈 Статистика
          </Link>
          {showDebug && (
            <button
              type="button"
              className="btn btn-ghost min-h-0 py-0.5 px-1 text-[10px] leading-tight"
              onClick={() => setIsAdminToolsModalOpen(true)}
              title="Відкрити тести"
            >
              тести
            </button>
          )}
          {/* Кнопка "+" з випадаючим меню */}
          <div className="relative add-menu-container" ref={addMenuRef}>
            <button
              className="btn btn-primary w-[18px] h-[18px] min-w-[18px] min-h-[18px] rounded p-0 flex items-center justify-center text-[10px] leading-none"
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              title="Додати"
            >
              +
            </button>
            {isAddMenuOpen && (
              <div className="absolute right-0 top-full mt-0.5 bg-white border border-gray-300 rounded shadow-lg z-50 min-w-[160px]">
                <div className="p-0.5">
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShouldOpenAddClient(true);
                      setIsAddMenuOpen(false);
                    }}
                  >
                    + Додати клієнта
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShouldOpenAddMaster(true);
                      setIsAddMenuOpen(false);
                    }}
                  >
                    + відповідальний
                  </button>
                  {showStatusesCreate && (
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-base-200 transition-colors"
                      onClick={() => {
                        setShouldOpenAddStatus(true);
                        setIsAddMenuOpen(false);
                      }}
                    >
                      + Створити статус
                    </button>
                  )}
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
        {/* Справа: логін та вихід */}
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
        {/* Слот для рядка заголовків таблиці; всередині scroll-контейнер для sync з body (ширина = ширина body, без зайвого розширення) */}
        <div
          className="overflow-x-hidden border-t border-gray-200 bg-base-200 min-h-0 px-2 box-border"
          style={scrollContentWidth != null ? { width: scrollContentWidth } : undefined}
        >
          <div
            ref={setHeaderRef}
            className="overflow-x-auto overflow-y-hidden w-full min-h-0"
            onScroll={onHeaderScroll}
          />
        </div>
    </header>
      {/* Контент під фіксованим хедером — pt достатній, щоб перший рядок таблиці не ховався під хедер */}
      <div className="flex-1 min-h-0 flex flex-col pt-[80px] pb-24 px-4">
          {/* Старі кнопки endpoints закоментовані - всі endpoints тепер в AdminToolsModal */}
          {/*
          <button
            className="btn btn-sm btn-error"
            onClick={async () => {
              if (!confirm('Видалити дублікати стану "client" з історії?\n\nЦе видалить всі дублікати стану "client" для Altegio клієнтів, залишивши тільки перший (найстаріший) запис.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/remove-duplicate-client-states', {
                  method: 'POST',
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Видалення дублікатів завершено!\n\n` +
                    `Всього клієнтів: ${data.summary.totalClients}\n` +
                    `Клієнтів з дублікатами: ${data.summary.clientsWithDuplicates}\n` +
                    `Всього видалено записів: ${data.summary.totalDeletedLogs}\n\n` +
                    (data.results && data.results.length > 0
                      ? `Клієнти з видаленими дублікатами:\n${data.results.map((r: any) => 
                          `  ${r.instagramUsername}: видалено ${r.deletedCount} запис(ів), залишено log ${r.keptLogId}`
                        ).join('\n')}\n\n`
                      : '') +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData(); // Перезавантажуємо дані таблиці
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Видалити дублікати стану 'client' з історії для Altegio клієнтів"
          >
            🗑️ Видалити дублікати стану "client"
          </button>
          <button
            className="btn btn-sm btn-error"
            onClick={async () => {
              if (!confirm('Видалити дублікати consultation-related станів з історії?\n\nЦе видалить всі дублікати станів "consultation-booked", "consultation-no-show", "consultation-rescheduled", залишивши тільки перший (найстаріший) запис для кожного стану.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/remove-duplicate-consultation-states', {
                  method: 'POST',
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Видалення дублікатів consultation-related станів завершено!\n\n` +
                    `Всього клієнтів перевірено: ${data.summary.totalClients}\n` +
                    `Клієнтів з дублікатами: ${data.summary.clientsWithDuplicates}\n` +
                    `Всього видалено записів: ${data.summary.totalDeletedLogs}\n\n` +
                    `По станах:\n` +
                    Object.entries(data.summary.byState).map(([state, stats]: [string, any]) =>
                      `  - ${state}: ${stats.clientsWithDuplicates} клієнтів, ${stats.totalDeletedLogs} записів`
                    ).join('\n') +
                    `\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData(); // Оновлюємо список клієнтів
                } else {
                  alert(`❌ Помилка: ${data.error || 'Невідома помилка'}`);
                }
              } catch (err) {
                alert(`❌ Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Видалити дублікати consultation-related станів з історії"
          >
            🗑️ Видалити дублікати consultation-станів
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/diagnose-duplicate-client-states');
                const data = await res.json();
                if (data.ok) {
                  const message = `🔍 Діагностика дублікатів стану "client":\n\n` +
                    `Всього клієнтів: ${data.totalClients}\n` +
                    `Клієнтів з дублікатами: ${data.clientsWithDuplicateClientStates}\n\n` +
                    (data.duplicates && data.duplicates.length > 0
                      ? `Клієнти з дублікатами:\n${data.duplicates.map((d: any) => 
                          `\n${d.instagramUsername} (${d.name})\n` +
                          `  Altegio ID: ${d.altegioClientId || 'N/A'}\n` +
                          `  Поточний стан: ${d.currentState}\n` +
                          `  Дублікатів "client": ${d.duplicateCount}\n` +
                          `  Логи:\n${d.duplicateLogs.map((log: any) => 
                            `    - ${log.createdAt} (${log.reason || 'N/A'}) ID: ${log.id}`
                          ).join('\n')}\n` +
                          `  Всі стани:\n${d.allStates.map((s: any) => 
                            `    - ${s.state} (${s.createdAt}) [${s.reason || 'N/A'}]`
                          ).join('\n')}`
                        ).join('\n\n')}\n\n`
                      : 'Дублікатів не знайдено.\n\n') +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Діагностика дублікатів стану 'client' в базі даних"
          >
            🔍 Діагностика дублікатів "client"
          </button>
          <button
            className="btn btn-sm btn-warning"
            disabled={isLoading}
            onClick={async () => {
              if (!confirm('Об\'єднати дублікати клієнтів по імені?\n\nЦе знайде всіх клієнтів з однаковим іменем та прізвищем і об\'єднає їх в один запис.\n\nКлієнта з правильним Instagram (не missing_instagram_*) та з записами буде залишено.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/merge-duplicates-by-name', {
                  method: 'POST',
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Об'єднання дублікатів завершено!\n\n` +
                    `Груп оброблено: ${data.totalGroups || 0}\n` +
                    `Дублікатів об'єднано: ${data.totalMerged || 0}\n\n` +
                    (data.results && data.results.length > 0
                      ? `Об'єднані клієнти:\n${data.results.map((r: any) => 
                          `${r.name}:\n${r.duplicates.map((d: any) => 
                            `  ${d.kept ? '✅ Залишено' : '🗑️ Видалено'}: ${d.instagramUsername} (${d.altegioClientId || 'N/A'})`
                          ).join('\n')}`
                        ).join('\n\n')}\n\n`
                      : '') +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            title="Об'єднати дублікати клієнтів з однаковим іменем та прізвищем"
          >
            🔗 Об'єднати дублікати по імені
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Очистити помилково встановлені paidServiceDate для клієнтів з консультаціями?\n\nЦе знайде всіх клієнтів, які мають paidServiceDate, але мають тільки консультації (без платних послуг), і очистить цю дату.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/cleanup-paid-service-dates', {
                  method: 'POST',
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Очищення завершено!\n\n` +
                    `Всього клієнтів: ${data.total}\n` +
                    `Очищено: ${data.cleaned}\n\n` +
                    (data.cleanedClients && data.cleanedClients.length > 0
                      ? `Очищені клієнти:\n${data.cleanedClients.map((c: string) => `  - ${c}`).join('\n')}\n\n`
                      : '') +
                    (data.errors && data.errors.length > 0
                      ? `Помилки:\n${data.errors.map((e: string) => `  - ${e}`).join('\n')}\n\n`
                      : '') +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Очистити помилково встановлені paidServiceDate для клієнтів з консультаціями"
          >
            🧹 Очистити paidServiceDate для консультацій
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              if (!confirm('Синхронізувати paidServiceDate з вебхуків для платних послуг?\n\nЦе знайде всі вебхуки з платними послугами (нарощування, інші послуги) і встановить paidServiceDate для відповідних клієнтів.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/sync-paid-service-dates', {
                  method: 'POST',
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Синхронізація завершена!\n\n` +
                    `Всього клієнтів: ${data.results.total}\n` +
                    `Оновлено: ${data.results.updated}\n` +
                    `Пропущено: ${data.results.skipped}\n` +
                    `Помилок: ${data.results.errors}\n\n` +
                    (data.results.details && data.results.details.length > 0
                      ? `Оновлені клієнти:\n${data.results.details.slice(0, 20).map((d: any) => `  - ${d.instagramUsername || d.altegioClientId} (${d.reason})`).join('\n')}` +
                        (data.results.details.length > 20 ? `\n... і ще ${data.results.details.length - 20} клієнтів` : '') + '\n\n'
                      : '') +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Синхронізувати paidServiceDate з вебхуків для платних послуг"
          >
            ✅ Синхронізувати paidServiceDate з вебхуків
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Синхронізувати клієнтів без Instagram з вебхуків?\n\nЦе разова початкова дія. Будуть оброблені всі вебхуки за весь період, які не мають Instagram username.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/sync-missing-instagram', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `Синхронізовано клієнтів без Instagram:\n\n` +
                    `Створено: ${data.created}\n` +
                    `Оновлено: ${data.updated}\n` +
                    `Пропущено (вже існують з Instagram): ${data.skippedAlreadyExists}\n` +
                    `Всього оброблено: ${data.processed} з ${data.totalEvents}`;
                  alert(message);
                  
                  // Оновлюємо дані після синхронізації
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                    await loadData();
                    
                    const checkRes = await fetch('/api/admin/direct/clients');
                    const checkData = await checkRes.json();
                    if (checkData.ok && checkData.clients && checkData.clients.length > 0) {
                      console.log(`[direct] Clients loaded after ${attempt} attempt(s)`);
                      break;
                    }
                  }
                } else {
                  alert(`Помилка: ${data.error || 'Невідома помилка'}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
          >
            ⚠️ Синхронізувати без Instagram
          </button>
          */}
          {/* Всі кнопки endpoints перенесені в AdminToolsModal */}
          {/* 
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              const clientId = prompt('Введіть Altegio Client ID для тестування (наприклад, 176404915):');
              if (!clientId) return;
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-altegio-client', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ client_id: clientId }),
                });
                const data = await res.json();
                if (data.ok) {
                  showCopyableAlert(JSON.stringify(data, null, 2));
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
          >
            🧪 Тест клієнта Altegio
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              const clientId = prompt('Введіть Altegio Client ID для тестування вебхука (наприклад, 176404915):');
              if (!clientId) return;
              
              const format = prompt('Виберіть формат custom_fields:\n1. array_title_value (масив з title/value)\n2. array_name_value (масив з name/value)\n3. object_keys (об\'єкт з ключами)\n4. object_camel (camelCase)\n5. object_spaces (з пробілами)\n\nВведіть номер (1-5) або залиште порожнім для array_title_value:');
              
              const formatMap: Record<string, string> = {
                '1': 'array_title_value',
                '2': 'array_name_value',
                '3': 'object_keys',
                '4': 'object_camel',
                '5': 'object_spaces',
              };
              
              const customFieldsFormat = format && formatMap[format] ? formatMap[format] : 'array_title_value';
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-altegio-webhook', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientId, customFieldsFormat }),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `Тест вебхука:\n\n` +
                    `Клієнт ID: ${data.test.clientId}\n` +
                    `Формат: ${data.test.customFieldsFormat}\n` +
                    `Instagram витягнуто: ${data.extraction.instagram || '❌ НЕ ВИТЯГНУТО'}\n` +
                    `Вебхук відповідь: ${data.webhook.response?.ok ? '✅ OK' : '❌ Помилка'}\n` +
                    `\nДеталі витягування:\n${JSON.stringify(data.extraction.steps, null, 2)}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
          >
            🔗 Тест вебхука Altegio
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              try {
                const res = await fetch('/api/altegio/webhook?limit=20');
                const data = await res.json();
                if (data.ok) {
                  const clientEvents = data.lastClientEvents || [];
                  const message = `Останні вебхуки Altegio:\n\n` +
                    `Всього подій: ${data.eventsCount}\n` +
                    `Події по клієнтах: ${data.clientEventsCount || 0}\n` +
                    `Події по записах: ${data.recordEventsCount || 0}\n\n` +
                    (clientEvents.length > 0 
                      ? `Останні події по клієнтах:\n${clientEvents.map((e: any, i: number) => 
                          `${i + 1}. ${e.status} - Client ID: ${e.clientId}, Name: ${e.clientName || '—'}\n` +
                          `   Custom fields: ${e.hasCustomFields ? '✅' : '❌'}, Type: ${e.customFieldsType}, IsArray: ${e.customFieldsIsArray}\n` +
                          `   Received: ${new Date(e.receivedAt).toLocaleString('uk-UA')}`
                        ).join('\n\n')}\n\n`
                      : '❌ Немає подій по клієнтах\n\n'
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Переглянути останні події вебхука від Altegio"
          >
            📋 Останні вебхуки
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setIsWebhooksModalOpen(true)}
            title="Переглянути таблицю webhook-ів Altegio"
          >
            📊 Таблиця вебхуків Altegio
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setIsManyChatWebhooksModalOpen(true)}
            title="Переглянути таблицю webhook-ів ManyChat"
          >
            📱 Таблиця вебхуків ManyChat
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setIsTelegramMessagesModalOpen(true)}
            title="Переглянути повідомлення з Telegram бота (HOB_client_bot)"
          >
            💬 Повідомлення Telegram бота
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              // Запитуємо Instagram username або ім'я клієнтки
              const input = prompt('Введіть Instagram username (наприклад: @tania.pidgaina) або повне ім\'я клієнтки (наприклад: таня підгайна):');
              if (!input || !input.trim()) {
                return;
              }
              
              try {
                const searchTerm = input.trim();
                // Визначаємо, чи це Instagram username чи ім'я
                const isInstagram = searchTerm.startsWith('@') || searchTerm.includes('_') || /^[a-z0-9._]+$/i.test(searchTerm);
                
                const res = await fetch('/api/admin/direct/diagnose-client', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(
                    isInstagram
                      ? { instagramUsername: searchTerm.replace('@', '') }
                      : { fullName: searchTerm }
                  ),
                });
                const data = await res.json();
                if (data.ok) {
                  const diagnosis = data.diagnosis;
                  let message = `🔍 Діагностика клієнтки: ${searchTerm}\n\n`;
                  
                  if (diagnosis.directClient) {
                    message += `✅ Клієнтка знайдена в Direct Manager\n`;
                    message += `   ID: ${diagnosis.directClient.id}\n`;
                    message += `   Instagram: ${diagnosis.directClient.instagramUsername}\n`;
                    message += `   Ім'я: ${diagnosis.directClient.fullName || 'не вказано'}\n`;
                    message += `   Стан: ${diagnosis.directClient.state || 'не встановлено'}\n`;
                    message += `   Altegio ID: ${diagnosis.directClient.altegioClientId || 'немає'}\n`;
                    message += `   Джерело: ${diagnosis.directClient.source || 'не вказано'}\n\n`;
                  } else {
                    message += `❌ Клієнтка не знайдена в Direct Manager\n\n`;
                  }
                  
                  if (diagnosis.issues && diagnosis.issues.length > 0) {
                    message += `Проблеми:\n${diagnosis.issues.map((i: string) => `  ${i}`).join('\n')}\n\n`;
                  }
                  
                  if (diagnosis.recommendations && diagnosis.recommendations.length > 0) {
                    message += `Рекомендації:\n${diagnosis.recommendations.map((r: string) => `  ${r}`).join('\n')}\n\n`;
                  }
                  
                  if (diagnosis.records) {
                    message += `Записи в Altegio:\n`;
                    message += `  Всього: ${diagnosis.records.total}\n`;
                    message += `  З "Консультація": ${diagnosis.records.withConsultation}\n`;
                    message += `  З "Нарощування волосся": ${diagnosis.records.withHairExtension}\n`;
                    if (diagnosis.records.latest && diagnosis.records.latest.length > 0) {
                      message += `\n  Останні записи:\n`;
                      diagnosis.records.latest.forEach((r: any, idx: number) => {
                        message += `    ${idx + 1}. ${r.receivedAt} - ${r.status}\n`;
                        message += `       Послуги: ${r.services.join(', ')}\n`;
                        message += `       Консультація: ${r.hasConsultation ? '✅' : '❌'}\n`;
                      });
                    }
                    message += `\n`;
                  }
                  
                  if (diagnosis.webhooks) {
                    message += `Вебхуки:\n`;
                    message += `  Всього: ${diagnosis.webhooks.total}\n`;
                    message += `  Записи: ${diagnosis.webhooks.records}\n`;
                    message += `  Клієнти: ${diagnosis.webhooks.clients}\n`;
                    if (diagnosis.webhooks.latest && diagnosis.webhooks.latest.length > 0) {
                      message += `\n  Останні вебхуки:\n`;
                      diagnosis.webhooks.latest.forEach((w: any, idx: number) => {
                        message += `    ${idx + 1}. ${w.receivedAt} - ${w.resource} (${w.status})\n`;
                        if (w.services && w.services.length > 0) {
                          message += `       Послуги: ${w.services.join(', ')}\n`;
                        }
                      });
                    }
                    message += `\n`;
                  }
                  
                  message += `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  
                  showCopyableAlert(message);
                  console.log('Client Diagnosis:', data);
                } else {
                  showCopyableAlert(`Помилка діагностики: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Діагностика конкретної клієнтки (введіть Instagram username або ім'я)"
          >
            🔍 Діагностика
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              const input = prompt('Введіть Instagram username клієнта (без @):');
              if (!input || !input.trim()) {
                return;
              }
              
              setIsLoading(true);
              try {
                const instagramUsername = input.trim().replace('@', '');
                const res = await fetch(`/api/admin/direct/search-webhooks?instagram=${encodeURIComponent(instagramUsername)}`);
                const data = await res.json();
                
                if (data.ok) {
                  const client = data.client;
                  const webhooks = data.webhooks || [];
                  const records = data.records || [];
                  const stats = data.stats || {};
                  
                  let message = `🔍 Пошук вебхуків для: @${instagramUsername}\n\n`;
                  message += `Клієнт:\n`;
                  message += `  ID: ${client.id}\n`;
                  message += `  Ім'я: ${client.fullName || 'не вказано'}\n`;
                  message += `  Altegio ID: ${client.altegioClientId || 'немає'}\n`;
                  message += `  Стан: ${client.state || 'не встановлено'}\n\n`;
                  
                  message += `Статистика:\n`;
                  message += `  Всього вебхуків: ${stats.totalWebhooks || 0}\n`;
                  message += `  Вебхуки по клієнтах: ${stats.clientWebhooks || 0}\n`;
                  message += `  Вебхуки по записах: ${stats.recordWebhooks || 0}\n`;
                  message += `  Записи в records log: ${stats.totalRecords || 0}\n\n`;
                  
                  if (webhooks.length > 0) {
                    message += `Вебхуки (останні 20):\n`;
                    webhooks.slice(0, 20).forEach((w: any, idx: number) => {
                      const date = w.receivedAt ? new Date(w.receivedAt).toLocaleString('uk-UA') : 'немає дати';
                      message += `\n${idx + 1}. ${date} - ${w.type} (${w.status})\n`;
                      if (w.type === 'record') {
                        message += `   Visit ID: ${w.visitId || 'немає'}\n`;
                        message += `   Дата візиту: ${w.datetime || 'немає'}\n`;
                        message += `   Майстер: ${w.staffName || 'немає'}\n`;
                        if (w.services && w.services.length > 0) {
                          message += `   Послуги:\n`;
                          w.services.forEach((s: any) => {
                            message += `     - ${s.title} (${s.cost || 0} ₴)\n`;
                          });
                        }
                        message += `   Прийшов: ${w.attendance === 1 || w.attendance === 2 ? '✅' : '❌'}\n`;
                      } else if (w.type === 'client') {
                        message += `   Клієнт: ${w.clientName || 'немає'}\n`;
                        message += `   Custom fields: ${w.hasCustomFields ? '✅' : '❌'}\n`;
                      }
                    });
                    if (webhooks.length > 20) {
                      message += `\n... і ще ${webhooks.length - 20} вебхуків\n`;
                    }
                  } else {
                    message += `❌ Вебхуків не знайдено\n`;
                  }
                  
                  if (records.length > 0) {
                    message += `\n\nЗаписи з records log (останні 10):\n`;
                    records.slice(0, 10).forEach((r: any, idx: number) => {
                      const date = r.receivedAt ? new Date(r.receivedAt).toLocaleString('uk-UA') : 'немає дати';
                      message += `\n${idx + 1}. ${date} - ${r.status || 'немає статусу'}\n`;
                      message += `   Visit ID: ${r.visitId || 'немає'}\n`;
                      message += `   Дата візиту: ${r.datetime || 'немає'}\n`;
                      if (r.services && r.services.length > 0) {
                        message += `   Послуги:\n`;
                        r.services.forEach((s: any) => {
                          message += `     - ${s.title} (${s.cost || 0} ₴)\n`;
                        });
                      }
                    });
                    if (records.length > 10) {
                      message += `\n... і ще ${records.length - 10} записів\n`;
                    }
                  }
                  
                  message += `\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Пошук вебхуків по Instagram username"
          >
            📋 Пошук вебхуків
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              try {
                const res = await fetch('/api/admin/direct/test-kv');
                const data = await res.json();
                console.log('KV Test Results:', data);
                const test = data.results?.writeTest;
                const index = data.results?.index;
                const message = `Тест KV:\nЗапис: ${test?.success ? '✅' : '❌'}\nІндекс існує: ${index?.exists ? '✅' : '❌'}\nТип індексу: ${index?.type}\n\nДеталі в консолі (F12)\n\nJSON:\n${JSON.stringify(data, null, 2)}`;
                showCopyableAlert(message);
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Тест запису/читання KV"
          >
            🧪 Тест KV
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/recover-client', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ ${data.message}\n\nЗнайдено через getAllDirectClients: ${data.stats.foundViaGetAll}\nЗнайдено через Instagram index: ${data.stats.foundViaInstagram}\nВсього в індексі: ${data.stats.totalInIndex}\n\nJSON:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ ${data.message || data.error || 'Помилка відновлення'}\n\nJSON:\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Відновити втраченого клієнта в індекс"
          >
            🔄 Відновити клієнта
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/check-migration');
                const data = await res.json();
                if (data.ok) {
                  const migration = data.migration;
                  const message = `Перевірка міграції:\n\n` +
                    `Статус: ${migration.status}\n` +
                    `Міграція виконана: ${migration.isMigrated ? '✅' : '❌'}\n\n` +
                    `Postgres:\n` +
                    `  Підключено: ${migration.postgres.connected ? '✅' : '❌'}\n` +
                    `  Клієнтів: ${migration.postgres.clientsCount}\n` +
                    `  Статусів: ${migration.postgres.statusesCount}\n` +
                    (migration.postgres.error ? `  Помилка: ${migration.postgres.error}\n` : '') +
                    `\nKV (старий store):\n` +
                    `  Клієнтів: ${migration.kv.clientsCount}\n` +
                    `  Статусів: ${migration.kv.statusesCount}\n` +
                    `\nStore (новий, через Postgres):\n` +
                    `  Клієнтів: ${migration.store.clientsCount}\n` +
                    `  Статусів: ${migration.store.statusesCount}\n` +
                    (migration.store.error ? `  Помилка: ${migration.store.error}\n` : '') +
                    `\nРекомендація: ${migration.recommendation}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Перевірити стан міграції на Postgres"
          >
            🗄️ Перевірити міграцію
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              const instagram = prompt('Введіть Instagram username (наприклад, lizixxss):');
              if (!instagram) return;
              
              const fullName = prompt('Введіть повне ім\'я (необов\'язково):');
              let firstName: string | undefined;
              let lastName: string | undefined;
              if (fullName) {
                const parts = fullName.trim().split(' ');
                firstName = parts[0] || undefined;
                lastName = parts.slice(1).join(' ') || undefined;
              }
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/add-client', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    instagramUsername: instagram,
                    firstName,
                    lastName,
                    source: 'instagram',
                  }),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `${data.created ? '✅ Клієнт створено' : '✅ Клієнт оновлено'}!\n\n` +
                    `Instagram: ${data.client.instagramUsername}\n` +
                    `Ім'я: ${data.client.firstName || '—'} ${data.client.lastName || ''}\n` +
                    `ID: ${data.client.id}\n` +
                    `Статус: ${data.client.statusId}\n` +
                    `Стан: ${data.client.state || '—'}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Додати клієнта вручну"
          >
            ➕ Додати клієнта
          </button>
          <button
            className="btn btn-sm btn-info"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-status-save', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const test = data.test;
                  const summary = test.summary;
                  const message = `Тест збереження статусу:\n\n` +
                    `Статус збережено в KV: ${summary.saved ? '✅' : '❌'}\n` +
                    `Статус в індексі: ${summary.inIndex ? '✅' : '❌'}\n` +
                    `Статус в getAllDirectStatuses: ${summary.inGetAll ? '✅' : '❌'}\n` +
                    `Індекс збільшився: ${summary.indexIncreased ? '✅' : '❌'}\n\n` +
                    `Деталі в консолі (F12)\n\n` +
                    `JSON:\n${JSON.stringify(data.test, null, 2)}`;
                  console.log('Status Save Test Results:', data.test);
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`Помилка: ${data.error || 'Unknown error'}\n\nJSON:\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Тест збереження статусу"
          >
            🧪 Тест статусу
          </button>
          <button
            className="btn btn-sm btn-error"
            onClick={async () => {
              if (!confirm('Створити таблиці в Postgres (Prisma міграція)?\n\nЦе створить таблиці:\n- direct_clients\n- direct_statuses\n- direct_masters\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/run-migration', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Міграція виконана!\n\n${data.results}\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка міграції: ${data.error || 'Невідома помилка'}\n\n${data.results || ''}\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Створити таблиці в Postgres (Prisma міграція)"
          >
            🗄️ Створити таблиці
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Синхронізувати Prisma схему з базою даних?\n\nЦе додасть колонку telegramChatId до таблиці direct_masters (якщо її ще немає).\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/sync-schema', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Схема синхронізована!\n\n${data.results}\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  // Оновлюємо список майстрів
                  await loadStatusesAndMasters();
                } else {
                  let errorMessage = `❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${data.results || ''}`;
                  if (data.sql) {
                    errorMessage += `\n\n📝 SQL для виконання вручну:\n${data.sql}`;
                  }
                  errorMessage += `\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(errorMessage);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Синхронізувати Prisma схему з базою даних (додати telegramChatId)"
          >
            🔄 Синхронізувати схему
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              if (!confirm('Оновити стани всіх клієнтів на основі записів з Altegio?\n\nЦе перевірить всі записи з Altegio і оновить стани клієнтів:\n- "Консультація" - якщо є послуга "Консультація"\n- "Нарощування волосся" - якщо є послуга з "Нарощування волосся"\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/update-states-from-records', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Оновлення станів завершено!\n\n` +
                    `Всього клієнтів: ${data.stats.totalClients}\n` +
                    `Оновлено: ${data.stats.updated}\n` +
                    `Пропущено: ${data.stats.skipped}\n` +
                    `Помилок: ${data.stats.errors}\n\n` +
                    (data.errors.length > 0
                      ? `Перші помилки:\n${data.errors.slice(0, 5).join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Оновити стани всіх клієнтів на основі записів з Altegio"
          >
            🔄 Оновити стани
          </button>

          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              if (!confirm('Виправити пропущені консультації в історії станів для всіх клієнтів з нарощуванням?\n\nЦе знайде клієнтів зі станом "Нарощування волосся", у яких немає консультації в історії, але в записах Altegio є обидві послуги, і додасть консультацію в історію.\n\nПродовжити?')) {
                return;
              }
              
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/fix-missing-consultations', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Виправлення завершено!\n\n` +
                    `Всього клієнтів перевірено: ${data.stats.totalClients}\n` +
                    `Виправлено: ${data.stats.fixed}\n` +
                    `Пропущено: ${data.stats.skipped}\n` +
                    (data.stats.errors > 0 ? `Помилок: ${data.stats.errors}\n\n` : '\n') +
                    (data.errors.length > 0
                      ? `Перші помилки:\n${data.errors.slice(0, 5).join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Виправити пропущені консультації в історії станів"
          >
            🔧 Виправити пропущені консультації
          </button>

          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/debug-records');
                const data = await res.json();
                if (data.ok) {
                  const message = `🔍 Діагностика записів в KV:\n\n` +
                    `Всього записів в KV: ${data.analysis.totalRecordsInKV}\n` +
                    `Успішно розпарсено: ${data.analysis.successfullyParsed}\n` +
                    `Записів з послугами: ${data.analysis.totalRecordsWithServices}\n` +
                    `Клієнтів з нарощуванням: ${data.analysis.clientsWithHairExtension}\n\n` +
                    `Приклад запису:\n${JSON.stringify(data.analysis.sampleRecord, null, 2)}\n\n` +
                    `Приклад клієнта:\n${JSON.stringify(data.analysis.sampleClient, null, 2)}\n\n` +
                    `Записи з послугами (перші 5):\n${JSON.stringify(data.recordsWithServices.slice(0, 5), null, 2)}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Діагностика структури записів в KV"
          >
            🔍 Діагностика записів
          </button>

          <button
            className="btn btn-sm btn-info"
            onClick={async () => {
              const type = confirm('Надіслати повторне нагадування?\n\nНатисніть OK для повторного нагадування (Недодзвон)\nНатисніть Скасувати для нового нагадування') ? 'repeat' : 'new';
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-reminder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type }),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ ${data.message}\n\n` +
                    `Тип: ${type === 'repeat' ? 'Повторне нагадування' : 'Нове нагадування'}\n` +
                    `Клієнт: ${data.reminder.clientName}\n` +
                    `Телефон: ${data.reminder.phone}\n` +
                    `Instagram: @${data.reminder.instagramUsername}\n` +
                    `Послуга: ${data.reminder.serviceName}\n\n` +
                    `Перевірте Telegram для отримання повідомлення з кнопками.\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Протестувати надсилання нагадування в Telegram з кнопками"
          >
            📱 Тест нагадування
          </button>
          <button
            className="btn btn-sm btn-info btn-outline"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/test-reminder-debug');
                const data = await res.json();
                if (data.ok) {
                  const message = `🔍 Діагностика налаштувань нагадувань\n\n` +
                    `Токени:\n` +
                    `  TELEGRAM_BOT_TOKEN (фото-бот): ${data.debug.tokens.TELEGRAM_BOT_TOKEN}\n` +
                    `  TELEGRAM_HOB_CLIENT_BOT_TOKEN: ${data.debug.tokens.TELEGRAM_HOB_CLIENT_BOT_TOKEN}\n` +
                    `  Використовується: ${data.debug.tokens.usingToken}\n\n` +
                    `Chat IDs адміністраторів:\n` +
                    `  З env (TELEGRAM_ADMIN_CHAT_IDS): ${data.debug.adminChatIds.fromEnv.length > 0 ? data.debug.adminChatIds.fromEnv.join(', ') : 'не встановлено'}\n` +
                    `  З реєстру майстрів: ${data.debug.adminChatIds.fromRegistry.length > 0 ? data.debug.adminChatIds.fromRegistry.join(', ') : 'не знайдено'}\n` +
                    `  Всього: ${data.debug.adminChatIds.total.length} (${data.debug.adminChatIds.total.join(', ')})\n\n` +
                    `Chat ID Миколая: ${data.debug.mykolayChatId || 'не знайдено'}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Діагностика налаштувань нагадувань"
          >
            🔍 Діагностика нагадувань
          </button>
          <button
            className="btn btn-sm btn-info btn-outline"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/check-telegram-webhook');
                const data = await res.json();
                if (data.ok) {
                  const hobWebhook = data.webhooks.HOB_CLIENT_BOT;
                  const botWebhook = data.webhooks.BOT;
                  
                  let message = `🔍 Перевірка налаштування Telegram webhook\n\n`;
                  
                  message += `Токени:\n`;
                  message += `  HOB_CLIENT_BOT_TOKEN: ${data.tokens.HOB_CLIENT_BOT_TOKEN}\n`;
                  message += `  BOT_TOKEN: ${data.tokens.BOT_TOKEN}\n\n`;
                  
                  message += `HOB_client_bot webhook:\n`;
                  if (hobWebhook.error) {
                    message += `  ❌ Помилка: ${hobWebhook.error}\n`;
                  } else if (hobWebhook.error?.code) {
                    message += `  ❌ Помилка API: ${hobWebhook.error.code} - ${hobWebhook.error.description}\n`;
                  } else {
                    message += `  ✅ URL: ${hobWebhook.url || 'NOT SET'}\n`;
                    message += `  Pending updates: ${hobWebhook.pendingUpdateCount}\n`;
                    if (hobWebhook.lastErrorMessage) {
                      message += `  ⚠️ Last error: ${hobWebhook.lastErrorMessage}\n`;
                    }
                  }
                  
                  message += `\nОсновний бот webhook:\n`;
                  if (botWebhook.error) {
                    message += `  ❌ Помилка: ${botWebhook.error}\n`;
                  } else if (botWebhook.error?.code) {
                    message += `  ❌ Помилка API: ${botWebhook.error.code} - ${botWebhook.error.description}\n`;
                  } else {
                    message += `  ✅ URL: ${botWebhook.url || 'NOT SET'}\n`;
                    message += `  Pending updates: ${botWebhook.pendingUpdateCount}\n`;
                    if (botWebhook.lastErrorMessage) {
                      message += `  ⚠️ Last error: ${botWebhook.lastErrorMessage}\n`;
                    }
                  }
                  
                  message += `\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Перевірити налаштування Telegram webhook"
          >
            🔗 Перевірити webhook
          </button>
          <button
            className="btn btn-sm btn-info btn-outline"
            onClick={async () => {
              const username = prompt('Введіть Telegram username для перевірки (наприклад: kolachnykv):', 'kolachnykv');
              if (!username) return;
              
              setIsLoading(true);
              try {
                const res = await fetch(`/api/admin/direct/test-start-command?username=${encodeURIComponent(username)}`);
                const data = await res.json();
                if (data.ok) {
                  const message = `🔍 Перевірка пошуку адміністратора (username: ${username})\n\n` +
                    `Пошук через функцію:\n` +
                    `${data.results.searchResults.byFunction ? `  ✅ Знайдено: ${data.results.searchResults.byFunction.name} (ID: ${data.results.searchResults.byFunction.id})\n  Chat ID: ${data.results.searchResults.byFunction.telegramChatId || 'не встановлено'}` : '  ❌ Не знайдено'}\n\n` +
                    `Пошук через масив:\n` +
                    `${data.results.searchResults.byArray ? `  ✅ Знайдено: ${data.results.searchResults.byArray.name} (ID: ${data.results.searchResults.byArray.id})\n  Chat ID: ${data.results.searchResults.byArray.telegramChatId || 'не встановлено'}` : '  ❌ Не знайдено'}\n\n` +
                    `Пошук в базі даних:\n` +
                    `${data.results.searchResults.byDatabase ? `  ✅ Знайдено: ${data.results.searchResults.byDatabase.name} (ID: ${data.results.searchResults.byDatabase.id})\n  Chat ID: ${data.results.searchResults.byDatabase.telegramChatId || 'не встановлено'}` : '  ❌ Не знайдено'}\n\n` +
                    `Всі відповідальні (${data.results.allMasters?.length || 0}):\n` +
                    (data.results.allMasters?.map((m: any) => `  - ${m.name} (@${m.telegramUsername || 'немає'}) [${m.role}] Chat ID: ${m.telegramChatId || 'немає'}`).join('\n') || 'немає') +
                    `\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Перевірити пошук адміністратора за Telegram username"
          >
            🔍 Тест пошуку адміна
          </button>
          <button
            className="btn btn-sm btn-info btn-outline"
            onClick={async () => {
              const altegioId = prompt('Введіть Altegio ID клієнта для перевірки стану:');
              if (!altegioId) return;
              
              setIsLoading(true);
              try {
                const res = await fetch(`/api/admin/direct/check-client-state?altegioClientId=${altegioId}`);
                const data = await res.json();
                if (data.ok) {
                  const message = `🔍 Перевірка стану клієнта (Altegio ID: ${altegioId})\n\n` +
                    `Клієнт з direct-store:\n` +
                    `  ID: ${data.clientFromStore?.id || 'не знайдено'}\n` +
                    `  Instagram: ${data.clientFromStore?.instagramUsername || 'не вказано'}\n` +
                    `  Стан: ${data.clientFromStore?.state || 'не вказано'}\n\n` +
                    `Клієнт з бази даних:\n` +
                    `  ID: ${data.clientFromDB?.id || 'не знайдено'}\n` +
                    `  Instagram: ${data.clientFromDB?.instagramUsername || 'не вказано'}\n` +
                    `  Стан: ${data.clientFromDB?.state || 'не вказано'}\n` +
                    `  Оновлено: ${data.clientFromDB?.updatedAt || 'не вказано'}\n\n` +
                    `Співпадіння: ${data.match ? '✅ Так' : '❌ Ні'}\n\n` +
                    `Останні зміни стану:\n${data.stateLogs?.map((log: any, i: number) => 
                      `${i + 1}. ${log.createdAt} - ${log.previousState || 'null'} → ${log.state || 'null'} (${log.reason || 'без причини'})`
                    ).join('\n') || 'немає'}\n\n` +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Перевірити стан клієнта в базі даних"
          >
            🔍 Перевірити стан клієнта
          </button>
          <button
            className="btn btn-sm btn-success btn-outline"
            onClick={async () => {
              if (!confirm('Налаштувати webhook для HOB_client_bot на спеціальний endpoint (/api/telegram/direct-reminders-webhook)?\n\nЦе дозволить обробляти повідомлення від HOB_client_bot без помилок авторизації.')) {
                return;
              }
              
              setIsLoading(true);
              try {
                // Отримуємо поточний URL
                const currentUrl = window.location.origin;
                // Використовуємо спеціальний endpoint для HOB_client_bot
                const webhookUrl = `${currentUrl}/api/telegram/direct-reminders-webhook`;
                
                const res = await fetch('/api/admin/direct/check-telegram-webhook', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: webhookUrl }),
                });
                const data = await res.json();
                
                if (data.ok) {
                  showCopyableAlert(`✅ Webhook налаштовано успішно!\n\nURL: ${webhookUrl}\n\nТепер повідомлення від HOB_client_bot будуть оброблятися через спеціальний endpoint.\n\nПовна відповідь:\n${JSON.stringify(data, null, 2)}`);
                  // Оновлюємо інформацію про webhook
                  setTimeout(() => {
                    const button = document.querySelector('button[title="Перевірити налаштування Telegram webhook"]') as HTMLButtonElement;
                    button?.click();
                  }, 1000);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Налаштувати webhook для HOB_client_bot на спеціальний endpoint"
          >
            ⚙️ Налаштувати webhook
          </button>
          <button
            className="btn btn-sm btn-info"
            onClick={async () => {
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/check-data');
                const data = await res.json();
                if (data.ok) {
                  const message = `📊 Діагностика даних:\n\n` +
                    `Postgres:\n` +
                    `  Клієнти: ${data.summary.postgresClients}\n` +
                    `  Статуси: ${data.summary.postgresStatuses}\n` +
                    `  Відповідальні: ${data.summary.postgresMasters}\n` +
                    `  SQL count: ${data.summary.directSqlCount}\n\n` +
                    `KV:\n` +
                    `  Клієнти: ${data.summary.kvClients}\n` +
                    `  Статуси: ${data.summary.kvStatuses}\n\n` +
                    `Рекомендація: ${data.recommendation}\n\n` +
                    (data.details.postgres.clients.sample && data.details.postgres.clients.sample.length > 0
                      ? `Приклади клієнтів:\n${data.details.postgres.clients.sample.map((c: any) => `  - ${c.username} (${c.name || 'без імені'})`).join('\n')}\n\n`
                      : ''
                    ) +
                    (data.details.postgres.clients.error
                      ? `Помилка клієнтів: ${data.details.postgres.clients.error}\n\n`
                      : ''
                    ) +
                    (data.details.postgres.statuses.error
                      ? `Помилка статусів: ${data.details.postgres.statuses.error}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Перевірити наявність даних в Postgres та KV"
          >
            🔍 Перевірити дані
          </button>
          <button
            className="btn btn-sm btn-accent"
            onClick={async () => {
              if (!confirm('Виконати міграцію даних з KV → Postgres?\n\nЦе перенесе всіх клієнтів та статуси з KV в Postgres.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/migrate-data', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Міграція завершена!\n\n` +
                    `Статуси:\n` +
                    `  Знайдено: ${data.stats.statuses.found}\n` +
                    `  Мігровано: ${data.stats.statuses.migrated}\n` +
                    `  Помилок: ${data.stats.statuses.errors}\n` +
                    `  Всього в Postgres: ${data.stats.statuses.finalCount}\n\n` +
                    `Клієнти:\n` +
                    `  Знайдено: ${data.stats.clients.found}\n` +
                    `  Мігровано: ${data.stats.clients.migrated}\n` +
                    `  Помилок: ${data.stats.clients.errors}\n\n` +
                    (data.errors.statuses.length > 0 || data.errors.clients.length > 0
                      ? `Помилки:\n${JSON.stringify(data.errors, null, 2)}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка міграції: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Мігрувати дані з KV в Postgres"
          >
            🚀 Мігрувати дані
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              // Спочатку показуємо попередній перегляд
              try {
                const previewRes = await fetch('/api/admin/direct/cleanup-altegio-generated');
                const previewData = await previewRes.json();
                if (previewData.ok) {
                  const count = previewData.stats?.toDelete || 0;
                  if (count === 0) {
                    alert('✅ Немає клієнтів для видалення');
                    return;
                  }
                  
                  const confirmMessage = `Знайдено ${count} клієнтів з Altegio, які мають згенерований Instagram username (починається з "altegio_").\n\nВидалити їх?`;
                  if (!confirm(confirmMessage)) {
                    return;
                  }
                  
                  setIsLoading(true);
                  try {
                    const res = await fetch('/api/admin/direct/cleanup-altegio-generated', { method: 'POST' });
                    const data = await res.json();
                    if (data.ok) {
                      const message = `✅ ${data.message}\n\n` +
                        `Всього клієнтів: ${data.stats.totalClients}\n` +
                        `Знайдено для видалення: ${data.stats.foundToDelete}\n` +
                        `Видалено: ${data.stats.deleted}\n` +
                        `Помилки: ${data.stats.errors}\n\n` +
                        `Деталі:\n${JSON.stringify(data.deletedClients?.slice(0, 10) || [], null, 2)}\n\n` +
                        `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                      showCopyableAlert(message);
                      await loadData();
                    } else {
                      showCopyableAlert(`Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                    }
                  } catch (err) {
                    showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
                  } finally {
                    setIsLoading(false);
                  }
                } else {
                  showCopyableAlert(`Помилка перегляду: ${previewData.error || 'Невідома помилка'}\n\n${JSON.stringify(previewData, null, 2)}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            disabled={isLoading}
            title="Видалити клієнтів з Altegio, які мають згенерований Instagram username"
          >
            🗑️ Очистити згенеровані
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Відновити індекс клієнтів? Це перебудує індекс з усіх збережених клієнтів.')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/rebuild-index', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  alert(data.message || `Індекс відновлено: ${data.stats?.afterRebuild || 0} клієнтів`);
                  // Оновлюємо дані
                  setTimeout(async () => {
                    await loadData();
                  }, 2000);
                } else {
                  alert(`Помилка: ${data.error}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            title="Відновити індекс клієнтів"
          >
            🔧 Відновити індекс
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={async () => {
              if (!confirm('Відновити всі дані з KV в Postgres?\n\nЦе знайде всіх клієнтів та статуси в KV і перенесе їх в Postgres.\n\nПродовжити?')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/recover-all-data', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Відновлення даних завершено!\n\n` +
                    `Статуси:\n` +
                    `  Знайдено в KV: ${data.stats.statuses.foundInKV}\n` +
                    `  Було в Postgres: ${data.stats.statuses.foundInPostgres}\n` +
                    `  Мігровано: ${data.stats.statuses.migrated}\n` +
                    `  Помилок: ${data.stats.statuses.errors}\n` +
                    `  Всього в Postgres: ${data.stats.final.statuses}\n\n` +
                    `Клієнти:\n` +
                    `  Знайдено в KV: ${data.stats.clients.foundInKV}\n` +
                    `  Було в Postgres: ${data.stats.clients.foundInPostgres}\n` +
                    `  Мігровано: ${data.stats.clients.migrated}\n` +
                    `  Помилок: ${data.stats.clients.errors}\n` +
                    `  Всього в Postgres: ${data.stats.final.clients}\n\n` +
                    (data.errors.statuses.length > 0 || data.errors.clients.length > 0
                      ? `Помилки:\n${[...data.errors.statuses, ...data.errors.clients].slice(0, 5).join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Відновити всі дані з KV в Postgres"
          >
            🔄 Відновити дані з KV
          </button>
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Мігрувати майстрів з mock-data в базу даних?\n\nЦе перенесе всіх майстрів з фото-звітів в нову базу даних.')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/migrate-masters', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                  const message = `✅ Міграція майстрів завершена!\n\n` +
                    `Знайдено: ${data.stats.found}\n` +
                    `Мігровано: ${data.stats.migrated}\n` +
                    `Пропущено: ${data.stats.skipped}\n` +
                    `Помилок: ${data.stats.errors}\n` +
                    `Всього в базі: ${data.stats.finalCount}\n\n` +
                    (data.errors.length > 0
                      ? `Помилки:\n${data.errors.join('\n')}\n\n`
                      : ''
                    ) +
                    `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                  showCopyableAlert(message);
                  await loadData();
                } else {
                  showCopyableAlert(`❌ Помилка: ${data.error || 'Невідома помилка'}\n\n${JSON.stringify(data, null, 2)}`);
                }
              } catch (err) {
                showCopyableAlert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            title="Мігрувати майстрів з mock-data в базу даних"
          >
            👥 Мігрувати майстрів
          </button>
          */}

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button
            className="btn btn-sm btn-ghost ml-4"
            onClick={() => {
              setError(null);
              loadData();
            }}
          >
            Оновити
          </button>
        </div>
      )}

      {/* Модальне вікно webhook-ів Altegio */}
      <WebhooksTableModal
        isOpen={isWebhooksModalOpen}
        onClose={() => setIsWebhooksModalOpen(false)}
      />

      {/* Модальне вікно webhook-ів ManyChat */}
      <ManyChatWebhooksTableModal
        isOpen={isManyChatWebhooksModalOpen}
        onClose={() => setIsManyChatWebhooksModalOpen(false)}
      />

      {/* Модальне вікно webhook-ів ManyChat */}
      <ManyChatWebhooksTableModal
        isOpen={isManyChatWebhooksModalOpen}
        onClose={() => setIsManyChatWebhooksModalOpen(false)}
      />

      {/* Модальне вікно повідомлень Telegram бота */}
      <TelegramMessagesModal
        isOpen={isTelegramMessagesModalOpen}
        onClose={() => setIsTelegramMessagesModalOpen(false)}
      />
      
      {/* Модальне вікно інструментів адміністратора */}
      <AdminToolsModal
        isOpen={isAdminToolsModalOpen}
        onClose={() => setIsAdminToolsModalOpen(false)}
        isLoading={isLoading}
        setIsLoading={setIsLoading}
        showCopyableAlert={showCopyableAlert}
        onActivateColumnWidthEdit={() => setIsEditingColumnWidths(true)}
        loadData={loadData}
        setIsWebhooksModalOpen={setIsWebhooksModalOpen}
        setIsManyChatWebhooksModalOpen={setIsManyChatWebhooksModalOpen}
        setIsTelegramMessagesModalOpen={setIsTelegramMessagesModalOpen}
        onClearVisitsSuccess={handleClearVisitsSuccess}
        adminTokenFromUrl={adminTokenForModal}
      />

      {/* Управління статусами та відповідальними */}
      <div className="flex gap-4 items-start">
        {showStatusesCreate && (
          <div className="flex-1">
            <StatusManager
              statuses={statuses}
              onStatusCreated={handleStatusCreated}
              onStatusesRefresh={loadStatusesOnly}
              shouldOpenCreate={shouldOpenAddStatus}
              onOpenCreateChange={(open) => setShouldOpenAddStatus(open)}
            />
          </div>
        )}
        <div className="flex-1">
          <MasterManager
            masters={masters}
            onMasterUpdated={handleStatusCreated}
            shouldOpenCreate={shouldOpenAddMaster}
            onOpenCreateChange={(open) => setShouldOpenAddMaster(open)}
          />
        </div>
      </div>

      {/* Таблиця — overflow-auto; ref + onScroll для синхрону горизонтального скролу з хедером */}
      <div
        ref={tableScrollRef}
        className="flex-1 min-h-0 min-w-0 overflow-auto"
        onScroll={onBodyScroll}
      >
      <DirectClientTable
        headerPortalRef={tableHeaderRef}
        headerSlotReady={headerSlotReady}
        bodyScrollLeft={bodyScrollLeft}
        clients={clients}
        totalClientsCount={totalClientsCount}
        statuses={statuses}
        statusCounts={statusCounts}
        daysCounts={daysCounts}
        stateCounts={stateCounts}
        instCounts={instCounts}
        clientTypeCounts={clientTypeCounts}
        consultationCounts={consultationCounts}
        recordCounts={recordCounts}
        binotelCallsFilterCounts={binotelCallsFilterCounts}
        chatStatuses={chatStatuses}
        callStatuses={callStatuses}
        onCallStatusCreated={(status) => setCallStatuses((prev) => [...prev, status])}
        masters={masters}
        filters={filters}
          onFiltersChange={(newFilters) => {
          // Забезпечуємо, що clientType завжди присутній
          setFilters({
            ...newFilters,
            clientType: newFilters.clientType || [],
          });
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(by, order) => {
          setSortBy(by);
          setSortOrder(order);
        }}
        onClientUpdate={handleClientUpdate}
        onRefresh={loadData}
        onClientSynced={handleClientSynced}
        onStatusMenuOpen={handleStatusMenuOpen}
        scrollContainerRef={tableScrollRef}
        onLoadMore={handleLoadMore}
        hasMore={clients.length < totalClientsCount}
        isLoadingMore={isLoadingMore}
        shouldOpenAddClient={shouldOpenAddClient}
        onOpenAddClientChange={(open) => setShouldOpenAddClient(open)}
        isEditingColumnWidths={isEditingColumnWidths}
        setIsEditingColumnWidths={setIsEditingColumnWidths}
        hideSalesColumn={hideSalesColumn}
        hideActionsColumn={hideActionsColumn}
        hideFinances={hideFinances}
        canListenCalls={canListenCalls}
        enableFooterStats={isInitialPrefetchCompleted}
      />
      </div>
      </div>

      {/* Шар для порталу фільтрів — над таблицею, щоб dropdown не ховався */}
      <div
        id="direct-filter-dropdown-root"
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 999999 }}
        aria-hidden="true"
      />
    </div>
  );
}

export default function DirectPage() {
  return (
    <Suspense fallback={null}>
      <DirectPageContent />
    </Suspense>
  );
}
