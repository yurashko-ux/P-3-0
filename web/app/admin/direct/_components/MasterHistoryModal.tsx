// web/app/admin/direct/_components/MasterHistoryModal.tsx
// Модальне вікно: історія змін майстра по клієнту (serviceMasterHistory)

"use client";

import { useMemo } from "react";

type MasterHistoryItem = {
  kyivDay?: string;
  masterName?: string;
  source?: string;
  recordedAt?: string;
};

interface MasterHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  currentMasterName: string | null | undefined;
  historyJson: string | null | undefined;
}

function formatDateTime(iso?: string) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("uk-UA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function MasterHistoryModal({ isOpen, onClose, clientName, currentMasterName, historyJson }: MasterHistoryModalProps) {
  const { rows, error } = useMemo(() => {
    try {
      if (!historyJson) return { rows: [] as MasterHistoryItem[], error: null as string | null };
      const parsed = JSON.parse(historyJson);
      if (!Array.isArray(parsed)) return { rows: [] as MasterHistoryItem[], error: "Некоректний формат історії (очікується масив)" };
      const rows = (parsed as MasterHistoryItem[]).slice(-200);
      return { rows, error: null };
    } catch (e) {
      return { rows: [] as MasterHistoryItem[], error: e instanceof Error ? e.message : String(e) };
    }
  }, [historyJson]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg">Історія майстрів</h3>
            <div className="text-xs opacity-70 mt-1">
              {clientName} • Поточний: <span className="font-medium">{currentMasterName || "-"}</span>
            </div>
          </div>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {error ? (
            <div className="alert alert-warning">
              <span className="text-sm">Помилка парсингу історії: {error}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center p-8 text-gray-500">Історія порожня</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm w-full">
                <thead>
                  <tr>
                    <th className="text-xs">Kyiv day</th>
                    <th className="text-xs">Майстер</th>
                    <th className="text-xs">Джерело</th>
                    <th className="text-xs">Записано</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.kyivDay || "day"}-${r.masterName || "m"}-${idx}`}>
                      <td className="text-xs whitespace-nowrap">{r.kyivDay || "-"}</td>
                      <td className="text-xs">{r.masterName || "-"}</td>
                      <td className="text-xs">{r.source || "-"}</td>
                      <td className="text-xs whitespace-nowrap">{formatDateTime(r.recordedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

