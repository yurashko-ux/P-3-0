// web/app/admin/direct/page.tsx
// Сторінка для роботи дірект-менеджера з клієнтами Instagram Direct

"use client";

import { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { DirectClientTable } from "./_components/DirectClientTable";
import { StatusManager } from "./_components/StatusManager";
import { MasterManager } from "./_components/MasterManager";
import { DirectStats } from "./_components/DirectStats";
import { WebhooksTableModal } from "./_components/WebhooksTableModal";
import type { DirectClient, DirectStatus, DirectStats as DirectStatsType } from "@/lib/direct-types";

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
  const [clients, setClients] = useState<DirectClient[]>([]);
  const [statuses, setStatuses] = useState<DirectStatus[]>([]);
  const [masters, setMasters] = useState<DirectMaster[]>([]);
  const [stats, setStats] = useState<DirectStatsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWebhooksModalOpen, setIsWebhooksModalOpen] = useState(false);
  const [filters, setFilters] = useState({
    statusId: "",
    masterId: "",
    source: "",
    search: "",
    hasAppointment: "",
  });
  const [isSearchLocked, setIsSearchLocked] = useState(false); // Флаг для блокування автоматичного оновлення пошуку
  
  // Режим відображення: 'passive' | 'active'
  // Використовуємо useSyncExternalStore для синхронізації з localStorage
  // Це гарантує, що viewMode завжди читається з localStorage і не може бути втрачений
  const [viewModeTrigger, setViewModeTrigger] = useState(0);
  
  // Функція для читання viewMode з localStorage
  const getViewMode = (): 'passive' | 'active' => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('direct-view-mode');
      return (saved === 'active' || saved === 'passive') ? saved : 'passive';
    }
    return 'passive';
  };
  
  // Завжди читаємо viewMode з localStorage (не зберігаємо в стані)
  const viewMode = getViewMode();
  
  // Обгортка для setViewMode, яка завжди зберігає в localStorage і тригерить ре-рендер
  const setViewMode = (newMode: 'passive' | 'active') => {
    if (typeof window !== 'undefined') {
      const currentMode = getViewMode();
      localStorage.setItem('direct-view-mode', newMode);
      console.log('[DirectPage] viewMode changed:', currentMode, '->', newMode);
      // Тригеримо ре-рендер
      setViewModeTrigger(prev => prev + 1);
    }
  };
  
  // Слухаємо зміни localStorage (на випадок зміни з іншої вкладки або іншого джерела)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'direct-view-mode') {
        console.log('[DirectPage] localStorage changed externally, triggering re-render');
        setViewModeTrigger(prev => prev + 1);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  
  
  // Додатковий захист: перевіряємо viewMode перед кожним завантаженням клієнтів
  const loadClientsProtected = async () => {
    // Перевіряємо і відновлюємо viewMode перед завантаженням
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('direct-view-mode');
      const expectedMode = (saved === 'active' || saved === 'passive') ? saved : 'passive';
      if (viewMode !== expectedMode) {
        console.warn('[DirectPage] loadClients: viewMode mismatch, restoring:', viewMode, '->', expectedMode);
        setViewModeState(expectedMode);
      }
    }
    return loadClients();
  };
  
  // Відстежуємо всі зміни viewMode для діагностики
  useEffect(() => {
    console.log('[DirectPage] viewMode state changed to:', viewMode);
  }, [viewMode]);

  // Ініціалізуємо сортування на основі viewMode
  const [sortBy, setSortBy] = useState<string>(() => {
    // Завантажуємо viewMode з localStorage для правильної ініціалізації сортування
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('direct-view-mode');
      return saved === 'active' ? 'updatedAt' : 'firstContactDate';
    }
    return 'firstContactDate';
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Агресивний захист: перевіряємо localStorage кожну секунду і оновлюємо sortBy якщо потрібно
  useEffect(() => {
    const interval = setInterval(() => {
      const currentViewMode = getViewMode();
      
      // Оновлюємо sortBy відповідно до поточного viewMode
      if (currentViewMode === 'active' && sortBy !== 'updatedAt') {
        console.log('[DirectPage] Interval check: Active mode detected, updating sortBy to updatedAt');
        setSortBy('updatedAt');
        setSortOrder('desc');
      } else if (currentViewMode === 'passive' && sortBy !== 'firstContactDate') {
        console.log('[DirectPage] Interval check: Passive mode detected, updating sortBy to firstContactDate');
        setSortBy('firstContactDate');
        setSortOrder('desc');
      }
    }, 1000); // Перевіряємо кожну секунду
    
    return () => clearInterval(interval);
  }, [sortBy]);

  useEffect(() => {
    loadData();
  }, []);

  // Автоматична зміна сортування при зміні режиму
  // Використовуємо useRef, щоб відстежувати попередній режим і не встановлювати сортування зайвий раз
  const prevViewModeRef = useRef<'passive' | 'active' | null>(null);
  useEffect(() => {
    // Встановлюємо сортування тільки при зміні режиму
    const viewModeChanged = prevViewModeRef.current !== null && prevViewModeRef.current !== viewMode;
    
    if (viewModeChanged || prevViewModeRef.current === null) {
      console.log('[DirectPage] viewMode changed, updating sortBy. Old:', prevViewModeRef.current, 'New:', viewMode);
      if (viewMode === 'passive') {
        // Пасивний режим: сортування за датою першого контакту
        setSortBy('firstContactDate');
        setSortOrder('desc');
      } else {
        // Активний режим: сортування за останнім оновленням
        setSortBy('updatedAt');
        setSortOrder('desc');
      }
      prevViewModeRef.current = viewMode;
    }
  }, [viewMode]); // Залежність тільки від viewMode, щоб уникнути циклічних оновлень

  // Захищаємо активний режим: перевіряємо, чи sortBy відповідає viewMode
  // Використовуємо useRef, щоб відстежувати, чи зміна сортування ініційована користувачем
  const userSortChangeRef = useRef(false);
  const lastSortByRef = useRef<string>(sortBy);
  
  useEffect(() => {
    // Якщо сортування не змінилося, нічого не робимо
    if (lastSortByRef.current === sortBy) {
      return;
    }
    lastSortByRef.current = sortBy;
    
    // Якщо користувач змінив сортування, не перезаписуємо його
    if (userSortChangeRef.current) {
      userSortChangeRef.current = false;
      return;
    }
    
    // Перевіряємо, чи sortBy відповідає поточному viewMode
    if (viewMode === 'active' && sortBy !== 'updatedAt') {
      console.log('[DirectPage] Active mode protection: resetting sortBy to updatedAt (was:', sortBy, ')');
      lastSortByRef.current = 'updatedAt';
      setSortBy('updatedAt');
      setSortOrder('desc');
    }
  }, [viewMode, sortBy]);

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

    // Завантажуємо відповідальних (майстрів)
    try {
      const mastersRes = await fetch("/api/admin/direct/masters");
      if (mastersRes.ok) {
        const mastersData = await mastersRes.json();
        if (mastersData.ok && mastersData.masters) {
          setMasters(mastersData.masters);
          console.log(`[DirectPage] Loaded ${mastersData.masters.length} masters`);
        }
      } else {
        console.warn(`[DirectPage] Failed to load masters: ${mastersRes.status} ${mastersRes.statusText}`);
      }
    } catch (mastersErr) {
      console.warn("[DirectPage] Failed to load masters:", mastersErr);
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

      // Завантажуємо статистику
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const loadClients = async () => {
    // Захист: перевіряємо viewMode перед завантаженням
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('direct-view-mode');
      const expectedMode = (saved === 'active' || saved === 'passive') ? saved : 'passive';
      if (viewMode !== expectedMode) {
        console.warn('[DirectPage] loadClients: viewMode mismatch detected! Restoring:', viewMode, '->', expectedMode);
        setViewModeState(expectedMode);
        // Якщо режим змінився, оновлюємо sortBy відповідно
        if (expectedMode === 'active' && sortBy !== 'updatedAt') {
          setSortBy('updatedAt');
          setSortOrder('desc');
        } else if (expectedMode === 'passive' && sortBy !== 'firstContactDate') {
          setSortBy('firstContactDate');
          setSortOrder('desc');
        }
      }
    }
    
    try {
      const params = new URLSearchParams();
      if (filters.statusId) params.set("statusId", filters.statusId);
      if (filters.masterId) params.set("masterId", filters.masterId);
      if (filters.source) params.set("source", filters.source);
      if (filters.hasAppointment === "true") params.set("hasAppointment", "true");
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);

      console.log('[DirectPage] Loading clients...', { filters, sortBy, sortOrder, viewMode });
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
      
      if (data.ok && Array.isArray(data.clients)) {
        let filteredClients = data.clients;

        // Пошук по Instagram username та Повне ім'я
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
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
        
        // Захист: не очищаємо клієнтів, якщо новий запит повертає 0, але у нас вже є клієнти
        // (це може бути помилка API або тимчасовий збій)
        if (filteredClients.length === 0 && clients.length > 0) {
          console.warn('[DirectPage] API returned 0 clients, but we have existing clients. Keeping existing clients.');
          setError('Помилка завантаження: API повернув 0 клієнтів. Показуємо попередні дані.');
          return; // Не оновлюємо клієнтів
        }
        
        setClients(filteredClients);
        setError(null); // Очищаємо помилку при успішному завантаженні
        
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

  const loadStats = async () => {
    try {
      const res = await fetch("/api/admin/direct/stats");
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

  // Завантажуємо клієнтів при зміні фільтрів/сортування
  // Використовуємо useRef, щоб уникнути зайвих викликів під час ініціалізації
  const isInitialMount = useRef(true);
  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    // Пропускаємо перший виклик, бо він вже відбувається в loadData()
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevFiltersRef.current = filters;
      return;
    }
    // Якщо пошук заблокований і змінився тільки search фільтр, не оновлюємо
    const searchChanged = prevFiltersRef.current.search !== filters.search;
    if (isSearchLocked && searchChanged) {
      prevFiltersRef.current = filters;
      return;
    }
    prevFiltersRef.current = filters;
    loadClients();
  }, [filters, sortBy, sortOrder]);

  // Автоматичне оновлення даних кожні 30 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      // Оновлюємо статистику та статуси/майстрів
      loadStats().catch(err => {
        console.warn('[DirectPage] Auto-refresh stats error (non-critical):', err);
      });
      // Оновлюємо статуси та майстрів, якщо вони не завантажилися
      if (statuses.length === 0 || masters.length === 0) {
        loadStatusesAndMasters();
      }
      // Оновлюємо клієнтів тільки якщо пошук не заблокований
      // Якщо пошук заблокований, не оновлюємо клієнтів, щоб зберегти результати пошуку
      if (!isSearchLocked) {
        loadClients().catch(err => {
          console.warn('[DirectPage] Auto-refresh error (non-critical):', err);
        });
      }
    }, 30000); // 30 секунд

    return () => clearInterval(interval);
  }, [statuses.length, masters.length, isSearchLocked]);

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
        await loadStats();
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

  return (
    <div className="w-full px-4 py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Direct Manager</h1>
          <p className="text-sm text-gray-600 mt-1">
            Робота з клієнтами Instagram Direct
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setIsLoading(true);
              loadData();
            }}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="loading loading-spinner loading-xs"></span>
                Оновлення...
              </>
            ) : (
              "🔄 Оновити"
            )}
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              if (!confirm('Синхронізувати клієнтів з KeyCRM? Це може зайняти деякий час.')) {
                return;
              }
              setIsLoading(true);
              try {
                // Для тесту: max_clients: 10, для повної синхронізації: max_pages: 0
                const testMode = confirm('Тестовий режим (10 клієнтів)?\n\nOK - тест на 10 клієнтах\nСкасувати - повна синхронізація');
                const syncParams = testMode 
                  ? { max_clients: 10 } 
                  : { max_pages: 0 }; // 0 = синхронізувати всіх (до 100 сторінок)
                
                const res = await fetch('/api/admin/direct/sync-keycrm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(syncParams),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = data.message || `Синхронізовано: ${data.stats.syncedClients} клієнтів з ${data.stats.totalCards} карток`;
                  if (data.stats.finalIndexLength !== undefined) {
                    alert(`${message}\n\nІндекс містить: ${data.stats.finalIndexLength} записів`);
                  } else {
                    alert(message);
                  }
                  
                  // Затримка перед оновленням, щоб KV встиг оновитися (eventual consistency)
                  // Спробуємо оновити кілька разів з затримками
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // 2s, 4s, 6s
                    await loadData();
                    
                    // Якщо клієнти з'явилися, припиняємо спроби
                    const checkRes = await fetch('/api/admin/direct/clients');
                    const checkData = await checkRes.json();
                    if (checkData.ok && checkData.clients && checkData.clients.length > 0) {
                      console.log(`[direct] Clients loaded after ${attempt} attempt(s)`);
                      break;
                    }
                  }
                } else {
                  alert(`Помилка: ${data.error}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
          >
            🔗 Синхронізувати з KeyCRM
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={async () => {
              if (!confirm('Завантажити клієнтів з Altegio? Це може зайняти деякий час.')) {
                return;
              }
              setIsLoading(true);
              try {
                const testMode = confirm('Тестовий режим (50 клієнтів)?\n\nOK - тест на 50 клієнтах\nСкасувати - повна синхронізація');
                const syncParams = testMode 
                  ? { max_clients: 50, page_size: 50 } 
                  : { page_size: 100 }; // Повна синхронізація
                
                const res = await fetch('/api/admin/direct/sync-altegio-bulk', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(syncParams),
                });
                const data = await res.json();
                if (data.ok) {
                  const message = data.message || `Синхронізовано: ${data.stats.totalCreated} створено, ${data.stats.totalUpdated} оновлено`;
                  alert(`${message}\n\nОброблено: ${data.stats.totalProcessed} клієнтів\nПропущено (немає Instagram): ${data.stats.totalSkippedNoInstagram}`);
                  
                  // Затримка перед оновленням, щоб KV встиг оновитися (eventual consistency)
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // 2s, 4s, 6s
                    await loadData();
                    
                    const checkRes = await fetch('/api/admin/direct/clients');
                    const checkData = await checkRes.json();
                    if (checkData.ok && checkData.clients && checkData.clients.length > 0) {
                      console.log(`[direct] Clients loaded after ${attempt} attempt(s)`);
                      break;
                    }
                  }
                } else {
                  alert(`Помилка: ${data.error}`);
                }
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
          >
            📥 Завантажити з Altegio
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
          <button
            className="btn btn-sm btn-warning"
            onClick={async () => {
              if (!confirm('Відправити Telegram повідомлення для всіх клієнтів без Instagram?\n\nЦе надішле повідомлення вам та адміністраторам з проханням додати Instagram username.')) {
                return;
              }
              setIsLoading(true);
              try {
                const res = await fetch('/api/admin/direct/send-missing-instagram-notifications', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                });
                const data = await res.json();
                if (data.ok) {
                  const message = `Відправлено повідомлень:\n\n` +
                    `Всього клієнтів: ${data.totalClients}\n` +
                    `Відправлено: ${data.sent}\n` +
                    `Не вдалося: ${data.failed}`;
                  alert(message);
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
            📨 Відправити повідомлення
          </button>

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
            📊 Таблиця вебхуків
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
        </div>
      </div>

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

      {/* Статистика */}
      {stats && <DirectStats stats={stats} />}

      {/* Модальне вікно webhook-ів */}
      <WebhooksTableModal
        isOpen={isWebhooksModalOpen}
        onClose={() => setIsWebhooksModalOpen(false)}
      />

      {/* Управління статусами та відповідальними */}
      <div className="flex gap-4 items-start">
        <div className="flex-1">
          <StatusManager
            statuses={statuses}
            onStatusCreated={handleStatusCreated}
          />
        </div>
        <div className="flex-1">
          <MasterManager
            masters={masters}
            onMasterUpdated={handleStatusCreated}
          />
        </div>
      </div>

      {/* Перемикач режимів відображення */}
      <div className="card bg-base-100 shadow-sm mb-4">
        <div className="card-body p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="label-text font-semibold">Режим відображення:</span>
            <div className="tabs tabs-boxed">
              <button
                className={`tab ${viewMode === 'passive' ? 'tab-active' : ''}`}
                onClick={() => setViewMode('passive')}
              >
                Пасивний
              </button>
              <button
                className={`tab ${viewMode === 'active' ? 'tab-active' : ''}`}
                onClick={() => setViewMode('active')}
              >
                Активний
              </button>
            </div>
            {viewMode === 'active' && (
              <span className="text-xs text-gray-500">
                Клієнти з останніми оновленнями зверху
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Таблиця клієнтів */}
      <DirectClientTable
        clients={clients}
        statuses={statuses}
        filters={filters}
        onFiltersChange={(newFilters) => {
          // Якщо очищено search (стало порожнім), розблоковуємо пошук
          if (newFilters.search === "" && filters.search !== "") {
            setIsSearchLocked(false);
          }
          // Якщо змінився інший фільтр (не search), розблоковуємо пошук
          if (newFilters.search === filters.search && 
              (newFilters.statusId !== filters.statusId || 
               newFilters.masterId !== filters.masterId || 
               newFilters.source !== filters.source)) {
            setIsSearchLocked(false);
          }
          setFilters(newFilters);
        }}
        onSearchClick={() => {
          // При натисканні "Знайти" блокуємо автоматичне оновлення пошуку
          setIsSearchLocked(true);
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(by, order) => {
          // Позначаємо, що користувач змінює сортування
          userSortChangeRef.current = true;
          
          // В активному режимі не дозволяємо змінювати сортування
          if (viewMode === 'active') {
            console.log('[DirectPage] Sort change blocked in active mode');
            return;
          }
          
          setSortBy(by);
          setSortOrder(order);
        }}
        onClientUpdate={handleClientUpdate}
        onRefresh={loadData}
      />
    </div>
  );
}
