// web/app/admin/direct/page.tsx
// Сторінка для роботи дірект-менеджера з клієнтами Instagram Direct

"use client";

export const dynamic = 'force-dynamic';

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
    let mounted = true;
    
    const loadDataWithTimeout = async () => {
      try {
        await loadData();
      } catch (err) {
        if (mounted) {
          console.error('[direct] Load data error:', err);
          setIsLoading(false);
          setError('Помилка завантаження даних. Перезавантажте сторінку.');
        }
      }
    };
    
    loadDataWithTimeout();
    
    // Таймаут на випадок, якщо завантаження зависне
    const timeout = setTimeout(() => {
      if (mounted && isLoading) {
        console.error('[direct] Loading timeout, forcing stop');
        setIsLoading(false);
        setError('Час очікування вичерпано. Перезавантажте сторінку.');
      }
    }, 15000); // 15 секунд
    
    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Завантажуємо статуси (initializeDefaultStatuses викликається автоматично в getAllDirectStatuses)
      try {
        const statusesRes = await fetch("/api/admin/direct/statuses", {
          signal: AbortSignal.timeout(10000), // 10 секунд таймаут
        });
        if (statusesRes.ok) {
          const statusesData = await statusesRes.json();
          if (statusesData.ok) {
            setStatuses(statusesData.statuses || []);
          } else {
            console.warn('[direct] Failed to load statuses:', statusesData.error);
            setStatuses([]);
          }
        } else {
          console.warn('[direct] Statuses API returned:', statusesRes.status);
          setStatuses([]);
        }
      } catch (fetchErr) {
        console.error('[direct] Error fetching statuses:', fetchErr);
        setStatuses([]);
      }

      // Завантажуємо клієнтів
      await loadClients();

      // Завантажуємо статистику
      await loadStats();
    } catch (err) {
      console.error('[direct] Error loading data:', err);
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`/api/admin/direct/clients?${params.toString()}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        console.error('[direct] Clients API returned:', res.status, res.statusText);
        setClients([]);
        return;
      }
      
      const data = await res.json();
      if (data.ok) {
        let filteredClients = data.clients || [];

        // Пошук по Instagram username
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          filteredClients = filteredClients.filter((c: DirectClient) =>
            c.instagramUsername?.toLowerCase().includes(searchLower) ||
            c.firstName?.toLowerCase().includes(searchLower) ||
            c.lastName?.toLowerCase().includes(searchLower)
          );
        }

        setClients(filteredClients);
      } else {
        console.error('[direct] Failed to load clients:', data.error);
        setClients([]);
        if (!error) {
          setError(data.error || "Failed to load clients");
        }
      }
    } catch (err) {
      console.error('[direct] Error loading clients:', err);
      setClients([]);
      if (!error) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const loadStats = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch("/api/admin/direct/stats", {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        console.warn('[direct] Stats API returned:', res.status);
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
      } else {
        console.warn('[direct] Failed to load stats:', data.error);
      }
    } catch (err) {
      console.error("[direct] Error loading stats:", err);
      // Не встановлюємо помилку для stats, бо це не критично
    }
  };

  useEffect(() => {
    // Завантажуємо клієнтів тільки після початкового завантаження
    if (!isLoading) {
      loadClients();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, sortOrder]);

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
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
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
