// web/app/admin/direct/page.tsx
// Сторінка для роботи дірект-менеджера з клієнтами Instagram Direct

"use client";

import { useState, useEffect } from "react";
import { DirectClientTable } from "./_components/DirectClientTable";
import { StatusManager } from "./_components/StatusManager";
import { DirectStats } from "./_components/DirectStats";
import type { DirectClient, DirectStatus, DirectStats as DirectStatsType } from "@/lib/direct-types";

export default function DirectPage() {
  const [clients, setClients] = useState<DirectClient[]>([]);
  const [statuses, setStatuses] = useState<DirectStatus[]>([]);
  const [stats, setStats] = useState<DirectStatsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    statusId: "",
    masterId: "",
    source: "",
    search: "",
  });
  const [sortBy, setSortBy] = useState<"firstContactDate" | "lastMessageAt" | "statusId">("firstContactDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Завантажуємо статуси
      const statusesRes = await fetch("/api/admin/direct/statuses");
      if (statusesRes.ok) {
        const statusesData = await statusesRes.json();
        if (statusesData.ok) {
          setStatuses(statusesData.statuses);
        }
      }

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
    try {
      const params = new URLSearchParams();
      if (filters.statusId) params.set("statusId", filters.statusId);
      if (filters.masterId) params.set("masterId", filters.masterId);
      if (filters.source) params.set("source", filters.source);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/admin/direct/clients?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        let filteredClients = data.clients;

        // Пошук по Instagram username
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          filteredClients = filteredClients.filter((c: DirectClient) =>
            c.instagramUsername.toLowerCase().includes(searchLower) ||
            c.firstName?.toLowerCase().includes(searchLower) ||
            c.lastName?.toLowerCase().includes(searchLower)
          );
        }

        setClients(filteredClients);
      } else {
        setError(data.error || "Failed to load clients");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  useEffect(() => {
    loadClients();
  }, [filters, sortBy, sortOrder]);

  // Автоматичне оновлення даних кожні 10 секунд
  useEffect(() => {
    const interval = setInterval(() => {
      loadClients();
      loadStats();
    }, 10000); // 10 секунд

    return () => clearInterval(interval);
  }, []);

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
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
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
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              try {
                const res = await fetch('/api/admin/direct/debug');
                const data = await res.json();
                console.log('Direct Debug Info:', data);
                alert(`Діагностика:\nІндекс: ${data.index?.length || 0} клієнтів\nЗавантажено: ${data.allClientsCount || 0} клієнтів\n\nДеталі в консолі (F12)`);
              } catch (err) {
                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
          >
            🔍 Діагностика
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
                alert(`Тест KV:\nЗапис: ${test?.success ? '✅' : '❌'}\nІндекс існує: ${index?.exists ? '✅' : '❌'}\nТип індексу: ${index?.type}\n\nДеталі в консолі (F12)`);
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
                  alert(`✅ ${data.message}\n\nЗнайдено через getAllDirectClients: ${data.stats.foundViaGetAll}\nЗнайдено через Instagram index: ${data.stats.foundViaInstagram}\nВсього в індексі: ${data.stats.totalInIndex}`);
                  await loadData();
                } else {
                  alert(`❌ ${data.message || data.error || 'Помилка відновлення'}`);
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

      {/* Управління статусами */}
      <StatusManager
        statuses={statuses}
        onStatusCreated={handleStatusCreated}
      />

      {/* Таблиця клієнтів */}
      <DirectClientTable
        clients={clients}
        statuses={statuses}
        filters={filters}
        onFiltersChange={setFilters}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(by, order) => {
          setSortBy(by);
          setSortOrder(order);
        }}
        onClientUpdate={handleClientUpdate}
        onRefresh={loadData}
      />
    </div>
  );
}
