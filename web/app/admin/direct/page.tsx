// web/app/admin/direct/page.tsx
// Сторінка для роботи дірект-менеджера з клієнтами Instagram Direct

"use client";

import { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import Link from "next/link";
import { DirectClientTable, type DirectFilters } from "./_components/DirectClientTable";
import { StatusManager } from "./_components/StatusManager";
import { MasterManager } from "./_components/MasterManager";
import { WebhooksTableModal } from "./_components/WebhooksTableModal";
import { ManyChatWebhooksTableModal } from "./_components/ManyChatWebhooksTableModal";
import { TelegramMessagesModal } from "./_components/TelegramMessagesModal";
import { AdminToolsModal } from "./_components/AdminToolsModal";
import type { DirectClient, DirectStatus, DirectChatStatus } from "@/lib/direct-types";

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

export default function DirectPage() {
  // Логуємо кожен ре-рендер компонента
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  console.log(`[DirectPage] 🎨 Component render #${renderCountRef.current}`, {
    timestamp: new Date().toISOString()
  });
  
  const [clients, setClients] = useState<DirectClient[]>([]);
  const [totalClientsCount, setTotalClientsCount] = useState<number>(0);
  const [statuses, setStatuses] = useState<DirectStatus[]>([]);
  const [masters, setMasters] = useState<DirectMaster[]>([]);
  const [chatStatuses, setChatStatuses] = useState<DirectChatStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
  const [filters, setFilters] = useState<DirectFilters>({
    statusId: "",
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
      created: { mode: null },
      appointed: { mode: null },
      appointedPreset: null,
      attendance: null,
      type: null,
      masterIds: [],
    },
    record: {
      created: { mode: null },
      appointed: { mode: null },
      appointedPreset: null,
      client: null,
      sum: null,
    },
    master: { hands: null, primaryMasterIds: [], secondaryMasterIds: [] },
  });
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
  filtersRef.current = filters;
  sortByRef.current = sortBy;
  sortOrderRef.current = sortOrder;
  
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

  // Функція для завантаження статусів та майстрів
  const loadStatusesAndMasters = async () => {
    // Завантажуємо статуси
    try {
      const statusesRes = await fetch("/api/admin/direct/statuses");
      if (statusesRes.ok) {
        const statusesData = await statusesRes.json();
        if (statusesData.ok && statusesData.statuses) {
          setStatuses(statusesData.statuses);
          console.log(`[DirectPage] Loaded ${statusesData.statuses.length} statuses`);
        }
      } else {
        console.warn(`[DirectPage] Failed to load statuses: ${statusesRes.status} ${statusesRes.statusText}`);
      }
    } catch (err) {
      console.warn("[DirectPage] Failed to load statuses:", err);
    }

    // Завантажуємо відповідальних (майстрів, дірект-менеджерів, адміністраторів)
    // ВАЖЛИВО: НЕ використовуємо onlyMasters=true тут, бо MasterManager має показувати ВСІХ відповідальних
    // Фільтр onlyMasters=true використовується тільки для вибору майстра в колонку "Майстер" клієнта
    try {
      const mastersRes = await fetch("/api/admin/direct/masters");
      if (mastersRes.ok) {
        const mastersData = await mastersRes.json();
        if (mastersData.ok && mastersData.masters) {
          setMasters(mastersData.masters);
          console.log(`[DirectPage] Loaded ${mastersData.masters.length} masters (all roles)`);
        }
      } else {
        console.warn(`[DirectPage] Failed to load masters: ${mastersRes.status} ${mastersRes.statusText}`);
      }
    } catch (mastersErr) {
      console.warn("[DirectPage] Failed to load masters:", mastersErr);
    }

    try {
      const chatRes = await fetch("/api/admin/direct/chat-statuses");
      if (chatRes.ok) {
        const chatData = await chatRes.json();
        if (chatData.ok && Array.isArray(chatData.statuses)) {
          setChatStatuses(chatData.statuses);
          console.log(`[DirectPage] Loaded ${chatData.statuses.length} chat statuses`);
        }
      }
    } catch (chatErr) {
      console.warn("[DirectPage] Failed to load chat statuses:", chatErr);
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Завантажуємо статуси та майстрів
      await loadStatusesAndMasters();

      // Завантажуємо клієнтів
      await loadClients();

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const loadClients = async (skipMergeDuplicates = false) => {
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
    if (!skipMergeDuplicates && !hasAutoMergedDuplicates.current) {
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
      if (f.statusId) params.set("statusId", f.statusId);
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
      if (c.created.mode === "current_month") params.set("consultCreatedMode", "current_month");
      else if (c.created.mode === "year_month" && c.created.year && c.created.month) {
        params.set("consultCreatedMode", "year_month");
        params.set("consultCreatedYear", c.created.year);
        params.set("consultCreatedMonth", c.created.month);
      }
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
      if (r.created.mode === "current_month") params.set("recordCreatedMode", "current_month");
      else if (r.created.mode === "year_month" && r.created.year && r.created.month) {
        params.set("recordCreatedMode", "year_month");
        params.set("recordCreatedYear", r.created.year);
        params.set("recordCreatedMonth", r.created.month);
      }
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
      params.set("sortBy", currentSortBy);
      params.set("sortOrder", currentSortOrder);

      const currentViewMode = currentSortBy === 'updatedAt' && currentSortOrder === 'desc' ? 'active' : 'passive';
      console.log('[DirectPage] Loading clients...', {
        filters: f,
        sortBy: currentSortBy,
        sortOrder: currentSortOrder,
        viewMode: currentViewMode,
        stateSortBy: sBy,
        stateSortOrder: sOrder
      });
      const res = await fetch(`/api/admin/direct/clients?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
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

        console.log('[DirectPage] Setting clients:', filteredClients.length, 'from API:', data.clients.length);
        if (filteredClients.length === 0 && clients.length > 0) {
          console.warn('[DirectPage] API returned 0 clients, but we have existing clients. Keeping existing clients.');
          setError('Помилка завантаження: API повернув 0 клієнтів. Показуємо попередні дані.');
          return;
        }
        console.log('[DirectPage] 🔄 Before setClients:', { sortBy, sortOrder, viewMode });
        setClients(filteredClients);
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
    
    console.log('[DirectPage] ✅ Calling loadClients from useEffect');
    loadClients();
  }, [filters, sortBy, sortOrder]);

  // Автоматичне оновлення даних кожні 30 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      if (statuses.length === 0 || masters.length === 0) {
        loadStatusesAndMasters();
      }
      loadClients().catch(err => {
        console.warn('[DirectPage] Auto-refresh error (non-critical):', err);
      });
    }, 30000); // 30 секунд

    return () => clearInterval(interval);
  }, [statuses.length, masters.length]);

  const handleClientUpdate = async (clientId: string, updates: Partial<DirectClient>) => {
    try {
      const res = await fetch(`/api/admin/direct/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.ok) {
        await loadClients();
      } else {
        alert(data.error || "Failed to update client");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStatusCreated = async () => {
    await loadData();
  };

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

  const tableHeaderRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [bodyScrollLeft, setBodyScrollLeft] = useState(0);

  return (
    <div className="min-h-screen flex flex-col w-full pb-1.5">
      {/* Хедер (навбар + рядок заголовків таблиці) — fixed вгорі */}
      <header className="fixed top-0 left-0 right-0 z-20 bg-white border-b border-gray-200 shrink-0">
        <div className="w-full px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          {/* Лівий блок залишається порожнім */}
        </div>
        <div className="flex gap-2 items-center">
          {/* Кнопки навігації до інших розділів */}
          <Link href="/admin/finance-report" className="btn btn-xs btn-ghost">
            💰 Фінансовий звіт
          </Link>
          <Link href="/admin/direct/stats" className="btn btn-xs btn-ghost">
            📈 Статистика
          </Link>
          {/* Всі кнопки синхронізації перенесені в AdminToolsModal */}
          <button
            className="btn btn-sm btn-ghost px-2"
            onClick={() => setIsAdminToolsModalOpen(true)}
            title="Відкрити тести"
          >
            тести
          </button>
          
          {/* Кнопка "+" з випадаючим меню */}
          <div className="relative add-menu-container" ref={addMenuRef}>
            <button
              className="btn btn-primary w-6 h-6 aspect-square rounded-lg p-0 flex items-center justify-center text-sm"
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              title="Додати"
            >
              +
            </button>
            {isAddMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 min-w-[180px]">
                <div className="p-1">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 rounded text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShouldOpenAddClient(true);
                      setIsAddMenuOpen(false);
                    }}
                  >
                    + Додати клієнта
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 rounded text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShouldOpenAddMaster(true);
                      setIsAddMenuOpen(false);
                    }}
                  >
                    + відповідальний
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 rounded text-sm hover:bg-base-200 transition-colors"
                    onClick={() => {
                      setShouldOpenAddStatus(true);
                      setIsAddMenuOpen(false);
                    }}
                  >
                    + Створити статус
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
        {/* Слот для рядка заголовків таблиці (portal з DirectClientTable); px-4 як у контенті */}
        <div ref={tableHeaderRef} className="overflow-x-hidden border-t border-gray-200 bg-base-200 min-h-[44px] px-4" />
    </header>
      {/* Контент під фіксованим хедером — pt під навбар+рядок заголовків */}
      <div className="flex-1 min-h-0 flex flex-col pt-[100px] pb-24 px-4">
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
                        message += `   Прийшов: ${w.attendance === 1 ? '✅' : '❌'}\n`;
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
      />

      {/* Управління статусами та відповідальними */}
      <div className="flex gap-4 items-start">
        <div className="flex-1">
          <StatusManager
            statuses={statuses}
            onStatusCreated={handleStatusCreated}
            shouldOpenCreate={shouldOpenAddStatus}
            onOpenCreateChange={(open) => setShouldOpenAddStatus(open)}
          />
        </div>
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
        onScroll={(e) => setBodyScrollLeft(e.currentTarget.scrollLeft)}
      >
      <DirectClientTable
        headerPortalRef={tableHeaderRef}
        bodyScrollLeft={bodyScrollLeft}
        clients={clients}
        totalClientsCount={totalClientsCount}
        statuses={statuses}
        chatStatuses={chatStatuses}
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
        shouldOpenAddClient={shouldOpenAddClient}
        onOpenAddClientChange={(open) => setShouldOpenAddClient(open)}
        isEditingColumnWidths={isEditingColumnWidths}
        setIsEditingColumnWidths={setIsEditingColumnWidths}
      />
      </div>
      </div>
    </div>
  );
}
