// web/app/admin/direct/_components/ClientWebhooksModal.tsx
// Модальне вікно для відображення webhook-ів конкретного клієнта

'use client';

import { useState, useEffect } from 'react';

interface ClientWebhookRow {
  receivedAt: string;
  datetime: string | null;
  clientName: string;
  staffName: string;
  services: string[];
  visitId: number;
  status: string;
  attendance: number | null; // 1=прийшов, 0=очікується, -1=не з'явився, -2=скасовано
  instagramUsername: string | null;
  fullBody: any;
}

interface ClientWebhooksModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  altegioClientId: number | null | undefined;
  /** Після успішного застосування даних з вебхуків (KV) — оновити таблицю */
  onSynced?: () => void;
}

export function ClientWebhooksModal({ isOpen, onClose, clientName, altegioClientId, onSynced }: ClientWebhooksModalProps) {
  const [webhooks, setWebhooks] = useState<ClientWebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (isOpen && altegioClientId) {
      loadWebhooks();
    } else if (isOpen && !altegioClientId) {
      setError('У клієнта немає Altegio ID');
      setLoading(false);
    }
  }, [isOpen, altegioClientId]);

  async function loadWebhooks() {
    if (!altegioClientId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/admin/direct/client-webhooks?altegioClientId=${altegioClientId}`);
      const data = await response.json();
      
      if (data.ok) {
        // Додаткова фільтрація "Запис" на клієнті (навіть якщо вже відфільтровано на сервері)
        const filteredRows = (data.rows || []).map((row: any) => ({
          ...row,
          services: Array.isArray(row.services) 
            ? row.services.filter((s: string) => s.toLowerCase() !== 'запис')
            : row.services,
        }));
        
        // Перевіряємо, чи було відфільтровано "Запис"
        const hadZapis = (data.rows || []).some((row: any) => 
          Array.isArray(row.services) && row.services.some((s: string) => s.toLowerCase() === 'запис')
        );
        
        if (hadZapis) {
          console.warn('[ClientWebhooksModal] ⚠️ Found "Запис" in services, filtered out:', {
            before: data.rows,
            after: filteredRows,
          });
        }
        
        setWebhooks(filteredRows);
        
        // Діагностична інформація (тільки в консолі для дебагу)
        if (data.debug) {
          console.log('[ClientWebhooksModal] Debug info:', data.debug);
          if (data.total === 0 && data.debug.recordEvents > 0) {
            console.warn('[ClientWebhooksModal] No webhooks found but record events exist. Sample client IDs:', data.debug.sampleClientIds);
          }
          
          // Показуємо діагностику в alert, якщо є "Запис" в послугах
          if (data.debug.hasZapis || (data.debug.servicesStats && ('Запис' in data.debug.servicesStats || 'запис' in data.debug.servicesStats)) || hadZapis) {
            const debugText = `🔍 Діагностика "Запис" в послугах:\n\n` +
              `Статистика послуг: ${JSON.stringify(data.debug.servicesStats, null, 2)}\n\n` +
              `Знайдено "Запис" в response: ${hadZapis}\n\n` +
              `Діагностика перших рядків:\n${JSON.stringify(data.debug.sampleDebugRows || [], null, 2)}`;
            console.warn('[ClientWebhooksModal] ⚠️ Found "Запис" in services!', debugText);
            // Показуємо alert з можливістю копіювання
            alert(debugText + '\n\n(Також перевірте консоль F12 для деталей)');
          }
        }
      } else {
        setError(data.error || 'Помилка завантаження webhook-ів');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження webhook-ів');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateString: string | null): string {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  }

  function getAttendanceLabel(attendance: number | null): string {
    if (attendance === null || attendance === undefined) return '-';
    // 1 = прийшов, 2 = підтвердив запис (Altegio)
    if (attendance === 1 || attendance === 2) return '✅ Прийшов';
    if (attendance === -2) return '🚫 Скасовано';
    if (attendance === -1) return '❌ Не з\'явився';
    if (attendance === 0) return '⏳ Очікується';
    return String(attendance);
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg">Webhook-и для клієнта: {clientName}</h3>
            <button
              className="btn btn-sm btn-circle btn-ghost"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          {!altegioClientId ? (
            <div className="alert alert-warning">
              <span>У цього клієнта немає Altegio ID, тому вебхуки недоступні</span>
            </div>
          ) : loading ? (
            <div className="text-center p-8">
              <div className="loading loading-spinner loading-lg"></div>
              <p className="mt-4 text-gray-600">Завантаження...</p>
            </div>
          ) : error ? (
            <div className="alert alert-error">
              <span>Помилка: {error}</span>
              <button className="btn btn-sm" onClick={loadWebhooks}>
                Спробувати ще раз
              </button>
            </div>
          ) : webhooks.length === 0 ? (
            <div className="text-center p-8 text-gray-500">
              Немає webhook-ів для цього клієнта
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm w-full">
                <thead>
                  <tr>
                    <th className="text-xs">Дата вебхука</th>
                    <th className="text-xs">Майстер</th>
                    <th className="text-xs">Instagram</th>
                    <th className="text-xs">Послуги</th>
                    <th className="text-xs">Дата послуг</th>
                    <th className="text-xs">Статус</th>
                    <th className="text-xs">Присутність</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((webhook, index) => (
                    <tr key={`${webhook.visitId}-${index}`} className="hover">
                      <td className="text-xs whitespace-nowrap">
                        {formatDate(webhook.receivedAt)}
                      </td>
                      <td className="text-xs">
                        {webhook.staffName}
                      </td>
                      <td className="text-xs">
                        {webhook.instagramUsername ? (
                          <span className="badge badge-sm badge-success">@{webhook.instagramUsername}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {webhook.services.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {webhook.services
                              .filter((service) => service.toLowerCase() !== 'запис') // Фільтруємо "Запис" на клієнті
                              .map((service, i) => (
                                <span key={i} className="badge badge-sm badge-outline">
                                  {service}
                                </span>
                              ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        {formatDate(webhook.datetime)}
                      </td>
                      <td className="text-xs">
                        <span className={`badge badge-sm ${
                          webhook.status === 'create' ? 'badge-success' :
                          webhook.status === 'update' ? 'badge-warning' :
                          webhook.status === 'delete' ? 'badge-error' :
                          'badge-neutral'
                        }`}>
                          {webhook.status || '-'}
                        </span>
                      </td>
                      <td className="text-xs">
                        {getAttendanceLabel(webhook.attendance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && webhooks.length > 0 && (
            <div className="mt-4 text-sm text-gray-500">
              Всього записів: {webhooks.length}
            </div>
          )}
        </div>
        <div className="p-4 border-t flex justify-between">
          <div>
            {!loading && !error && webhooks.length > 0 && altegioClientId && (
              <button
                className="btn btn-sm btn-info"
                disabled={!!syncing}
                onClick={async () => {
                  if (!altegioClientId) return;
                  setSyncing(true);
                  try {
                    const res = await fetch('/api/admin/direct/sync-consultation-for-client', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ altegioClientId }),
                    });
                    const data = await res.json();
                    const updated =
                      data?.result?.consultation?.bookingDateUpdated ||
                      data?.result?.consultation?.attendanceUpdated ||
                      data?.result?.paidService?.dateUpdated ||
                      data?.result?.paidService?.attendanceUpdated ||
                      data?.result?.lastActivityKeysRepair;
                    if (data?.ok && updated) {
                      onSynced?.();
                      const parts = [];
                      if (data.result.consultation?.bookingDateUpdated) parts.push('консультація: дата');
                      if (data.result.consultation?.attendanceUpdated) parts.push('консультація: присутність');
                      if (data.result.paidService?.dateUpdated) parts.push('запис: дата');
                      if (data.result.paidService?.attendanceUpdated) parts.push('запис: присутність');
                      if (data.result?.lastActivityKeysRepair) parts.push('крапочка');
                      alert(`✅ Застосовано з вебхуків!\n\n${parts.join(', ')}`);
                    } else if (data?.ok) {
                      onSynced?.();
                      alert('Дані вже актуальні (API та KV).');
                    } else {
                      alert(data?.error || 'Помилка синхронізації');
                    }
                  } catch (err) {
                    alert('Помилка: ' + (err instanceof Error ? err.message : String(err)));
                  } finally {
                    setSyncing(false);
                  }
                }}
              >
                {syncing ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  '📥 Застосувати дані з вебхуків'
                )}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {!loading && !error && altegioClientId && (
              <button className="btn btn-sm btn-primary" onClick={loadWebhooks}>
                🔄 Оновити
              </button>
            )}
            <button className="btn btn-sm" onClick={onClose}>
              Закрити
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

