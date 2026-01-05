// web/app/admin/direct/_components/WebhooksTableModal.tsx
// Модальне вікно для відображення webhook-ів у вигляді таблиці

'use client';

import { useState, useEffect } from 'react';

interface WebhookRow {
  receivedAt: string;
  datetime: string | null;
  clientName: string;
  staffName: string;
  services: string[];
  visitId: number;
  status: string;
  instagramUsername: string | null;
}

interface WebhooksTableModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WebhooksTableModal({ isOpen, onClose }: WebhooksTableModalProps) {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadWebhooks();
    }
  }, [isOpen]);

  async function loadWebhooks() {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/admin/direct/webhooks-table?limit=100');
      const data = await response.json();
      
      if (data.ok) {
        setWebhooks(data.rows || []);
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
            <h3 className="font-bold text-lg">Webhook-и Altegio</h3>
            <button
              className="btn btn-sm btn-circle btn-ghost"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          {loading ? (
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
              Немає webhook-ів для відображення
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm w-full">
                <thead>
                  <tr>
                    <th className="text-xs">Дата вебхука</th>
                    <th className="text-xs">Клієнт</th>
                    <th className="text-xs">Instagram</th>
                    <th className="text-xs">Майстер</th>
                    <th className="text-xs">Послуги</th>
                    <th className="text-xs">Дата послуг</th>
                    <th className="text-xs">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((webhook, index) => (
                    <tr key={`${webhook.visitId}-${index}`} className="hover">
                      <td className="text-xs whitespace-nowrap">
                        {formatDate(webhook.receivedAt)}
                      </td>
                      <td className="text-xs">
                        {webhook.clientName}
                      </td>
                      <td className="text-xs">
                        {webhook.instagramUsername ? (
                          <span className="badge badge-sm badge-success">@{webhook.instagramUsername}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {webhook.staffName}
                      </td>
                      <td className="text-xs">
                        {webhook.services.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {webhook.services.map((service, i) => (
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
        <div className="p-4 border-t flex justify-end gap-2">
          {!loading && !error && (
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
  );
}
