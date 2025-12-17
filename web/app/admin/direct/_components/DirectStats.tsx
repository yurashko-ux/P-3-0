// web/app/admin/direct/_components/DirectStats.tsx
// Статистика Direct

"use client";

import type { DirectStats as DirectStatsType } from "@/lib/direct-types";

type DirectStatsProps = {
  stats: DirectStatsType;
};

export function DirectStats({ stats }: DirectStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Загальна кількість */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="text-2xl font-bold">{stats.totalClients}</div>
          <div className="text-sm text-gray-600">Всього клієнтів</div>
        </div>
      </div>

      {/* Конверсія 1 */}
      <div className="card bg-base-100 shadow-sm border-l-4 border-l-blue-500">
        <div className="card-body p-4">
          <div className="text-2xl font-bold">{stats.conversion1.rate.toFixed(1)}%</div>
          <div className="text-sm text-gray-600">Конверсія 1</div>
          <div className="text-xs text-gray-500 mt-1">
            Прийшли: {stats.conversion1.visitedSalon} / Записані: {stats.conversion1.consultationsWithMaster}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Консультація → Візит в салон
          </div>
        </div>
      </div>

      {/* Конверсія 2 */}
      <div className="card bg-base-100 shadow-sm border-l-4 border-l-green-500">
        <div className="card-body p-4">
          <div className="text-2xl font-bold">{stats.conversion2.rate.toFixed(1)}%</div>
          <div className="text-sm text-gray-600">Конверсія 2</div>
          <div className="text-xs text-gray-500 mt-1">
            Записалися: {stats.conversion2.signedUpForPaid} / Прийшли: {stats.conversion2.visitedSalon}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Візит в салон → Запис на послугу
          </div>
        </div>
      </div>

      {/* Загальна конверсія */}
      <div className="card bg-base-100 shadow-sm border-l-4 border-l-purple-500">
        <div className="card-body p-4">
          <div className="text-2xl font-bold">{stats.overallConversion.rate.toFixed(1)}%</div>
          <div className="text-sm text-gray-600">Загальна конверсія</div>
          <div className="text-xs text-gray-500 mt-1">
            Записалися: {stats.overallConversion.signedUpForPaid} / Записані: {stats.overallConversion.consultationsWithMaster}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Консультація → Запис на послугу
          </div>
        </div>
      </div>
    </div>
  );
}
