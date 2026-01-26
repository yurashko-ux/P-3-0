// web/app/admin/direct/stats/page.tsx
// Сторінка статистики Direct

"use client";

import { useState, useEffect } from "react";
import { DirectStats } from "../_components/DirectStats";
import type { DirectStats as DirectStatsType } from "@/lib/direct-types";

export default function DirectStatsPage() {
  const [stats, setStats] = useState<DirectStatsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/direct/stats", {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      
      if (!res.ok) {
        throw new Error(`Помилка завантаження: ${res.status} ${res.statusText}`);
      }
      
      const data = await res.json();
      if (data.ok) {
        setStats(data.stats);
      } else {
        throw new Error(data.error || 'Помилка завантаження статистики');
      }
    } catch (err) {
      console.error("Failed to load stats:", err);
      setError(err instanceof Error ? err.message : 'Невідома помилка');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Статистика Direct</h1>
        <p className="text-sm text-gray-500 mt-1">
          Конверсії та загальна статистика клієнтів
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      )}

      {error && (
        <div className="alert alert-error mb-4">
          <span>{error}</span>
          <button className="btn btn-sm" onClick={loadStats}>
            Спробувати знову
          </button>
        </div>
      )}

      {stats && !loading && (
        <div>
          <DirectStats stats={stats} />
          <div className="mt-4">
            <button
              className="btn btn-sm btn-outline"
              onClick={loadStats}
            >
              Оновити
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
