// web/app/admin/direct/_components/RecordHistoryModal.tsx
// Модальне вікно для історії записів/консультацій (Altegio records/webhooks), згруповано по днях.

'use client';

import { useEffect, useMemo, useState } from 'react';

type RecordHistoryType = 'paid' | 'consultation';

type RecordHistoryRow = {
  kyivDay: string;
  type: RecordHistoryType;
  datetime: string | null;
  receivedAt: string | null;
  attendance: number | null; // 1 | 0 | -1 | -2 | null
  attendanceStatus: string;
  attendanceIcon: string;
  attendanceLabel: string;
  staffNames: string[];
  services: string[];
  rawEventsCount: number;
  events: Array<{
    receivedAt: string | null;
    datetime: string | null;
    staffName: string | null;
    attendance: number | null;
    status?: string | null;
    visitId?: number | null;
  }>;
};

interface RecordHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  altegioClientId: number | null | undefined;
  type: RecordHistoryType;
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

export function RecordHistoryModal({ isOpen, onClose, clientName, altegioClientId, type }: RecordHistoryModalProps) {
  const [rows, setRows] = useState<RecordHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const title = useMemo(() => {
    const t = type === 'consultation' ? 'Історія консультацій' : 'Історія записів';
    return `${t}: ${clientName}`;
  }, [type, clientName]);

  useEffect(() => {
    if (!isOpen) return;
    if (!altegioClientId) {
      setError('У клієнта немає Altegio ID');
      setRows([]);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, altegioClientId, type]);

  async function load() {
    if (!altegioClientId) return;
    try {
      setLoading(true);
      setError(null);
      setRows([]);
      setExpandedKey(null);

      const res = await fetch(`/api/admin/direct/record-history?altegioClientId=${altegioClientId}&type=${type}`);
      const data = await res.json();
      if (!data?.ok) {
        setError(data?.error || 'Помилка завантаження історії');
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold text-lg">{title}</h3>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {!altegioClientId ? (
            <div className="alert alert-warning">
              <span>У цього клієнта немає Altegio ID, тому історія недоступна</span>
            </div>
          ) : loading ? (
            <div className="text-center p-8">
              <div className="loading loading-spinner loading-lg"></div>
              <p className="mt-4 text-gray-600">Завантаження...</p>
            </div>
          ) : error ? (
            <div className="alert alert-error">
              <span>Помилка: {error}</span>
              <button className="btn btn-sm" onClick={load}>
                Спробувати ще раз
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center p-8 text-gray-500">Немає записів для цього клієнта</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm w-full">
                <thead>
                  <tr>
                    <th className="text-xs">Дата візиту</th>
                    <th className="text-xs">Статус</th>
                    <th className="text-xs">Майстри</th>
                    <th className="text-xs">Послуги</th>
                    <th className="text-xs">Raw</th>
                    <th className="text-xs"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const key = `${r.type}:${r.kyivDay}:${r.datetime || ''}:${r.receivedAt || ''}`;
                    const isExpanded = expandedKey === key;
                    return (
                      <>
                        <tr key={key} className="hover">
                          <td className="text-xs whitespace-nowrap">{formatDateTime(r.datetime)}</td>
                          <td className="text-xs whitespace-nowrap" title={r.attendanceStatus}>
                            <span className="flex items-center gap-2">
                              <span className="text-lg">{r.attendanceIcon}</span>
                              <span>{r.attendanceLabel}</span>
                            </span>
                          </td>
                          <td className="text-xs">{r.staffNames?.length ? r.staffNames.join(', ') : '-'}</td>
                          <td className="text-xs">
                            {r.services?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {r.services.map((s, i) => (
                                  <span key={`${key}-s-${i}`} className="badge badge-sm badge-outline">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="text-xs whitespace-nowrap">{r.rawEventsCount}</td>
                          <td className="text-xs whitespace-nowrap">
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => setExpandedKey(isExpanded ? null : key)}
                              title="Показати/сховати raw події"
                            >
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${key}-expanded`}>
                            <td colSpan={6} className="bg-base-100">
                              <div className="p-2">
                                <div className="text-xs text-gray-600 mb-2">
                                  Raw події (останні/перші 50)
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="table table-xs w-full">
                                    <thead>
                                      <tr>
                                        <th className="text-xs">receivedAt</th>
                                        <th className="text-xs">datetime</th>
                                        <th className="text-xs">майстер</th>
                                        <th className="text-xs">attendance</th>
                                        <th className="text-xs">status</th>
                                        <th className="text-xs">visitId</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(r.events || []).map((e, idx) => (
                                        <tr key={`${key}-e-${idx}`}>
                                          <td className="text-xs whitespace-nowrap">{formatDateTime(e.receivedAt)}</td>
                                          <td className="text-xs whitespace-nowrap">{formatDateTime(e.datetime)}</td>
                                          <td className="text-xs">{e.staffName || '-'}</td>
                                          <td className="text-xs">{e.attendance ?? '-'}</td>
                                          <td className="text-xs">{e.status || '-'}</td>
                                          <td className="text-xs">{e.visitId ?? '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

