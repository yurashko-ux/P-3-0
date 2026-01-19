// web/app/admin/direct/_components/ManyChatWebhooksTableModal.tsx
// Модальне вікно для відображення ManyChat webhook-ів у вигляді таблиці

'use client';

import { useState, useEffect } from 'react';

interface ManyChatWebhookRow {
  receivedAt: string;
  instagramUsername: string | null;
  subscriberId?: string | null;
  fullName: string;
  text: string;
  bodyLength: number;
  rawBody?: string | null;
  headers?: Record<string, unknown> | null;
}

interface ManyChatWebhooksTableModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ManyChatWebhooksTableModal({ isOpen, onClose }: ManyChatWebhooksTableModalProps) {
  const [webhooks, setWebhooks] = useState<ManyChatWebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ManyChatWebhookRow | null>(null);
  const [copied, setCopied] = useState<'raw' | 'headers' | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadWebhooks();
    }
  }, [isOpen]);

  async function loadWebhooks() {
    try {
      setLoading(true);
      setError(null);
      setSelected(null);
      
      const response = await fetch('/api/admin/direct/manychat-webhooks-table?limit=1000&includeRaw=1');
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

  async function copyToClipboard(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label === 'raw' ? 'raw' : 'headers');
      setTimeout(() => setCopied(null), 900);
    } catch (err) {
      alert(`Не вдалося скопіювати: ${err instanceof Error ? err.message : String(err)}`);
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

  function formatRelativeTime(dateString: string): string {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'щойно';
      if (diffMins < 60) return `${diffMins} хв тому`;
      if (diffHours < 24) return `${diffHours} год тому`;
      if (diffDays < 7) return `${diffDays} дн тому`;
      return formatDate(dateString);
    } catch {
      return formatDate(dateString);
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
            <h3 className="font-bold text-lg">Webhook-и ManyChat</h3>
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
                    <th className="text-xs">Instagram</th>
                    <th className="text-xs">Subscriber ID</th>
                    <th className="text-xs">Ім'я</th>
                    <th className="text-xs">Повідомлення</th>
                    <th className="text-xs">Розмір</th>
                    <th className="text-xs">RAW</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((webhook, index) => (
                    <tr
                      key={`${webhook.receivedAt}-${index}`}
                      className={`hover cursor-pointer ${selected?.receivedAt === webhook.receivedAt ? 'bg-blue-50' : ''}`}
                      onClick={() => setSelected(webhook)}
                      title="Натисніть, щоб подивитися сирий payload"
                    >
                      <td className="text-xs whitespace-nowrap">
                        <div className="flex flex-col">
                          <span>{formatDate(webhook.receivedAt)}</span>
                          <span className="text-gray-400 text-xs">
                            {formatRelativeTime(webhook.receivedAt)}
                          </span>
                        </div>
                      </td>
                      <td className="text-xs">
                        {webhook.instagramUsername ? (
                          <span className="badge badge-sm badge-success">@{webhook.instagramUsername}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {webhook.subscriberId ? (
                          <span className="font-mono text-[11px]">{webhook.subscriberId}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {webhook.fullName}
                      </td>
                      <td className="text-xs">
                        <div className="max-w-xs truncate" title={webhook.text}>
                          {webhook.text}
                        </div>
                      </td>
                      <td className="text-xs text-gray-400">
                        {webhook.bodyLength} байт
                      </td>
                      <td className="text-xs">
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(webhook);
                          }}
                          title="Відкрити сирий webhook"
                        >
                          🧾
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && selected && (
            <div className="mt-4 border rounded-lg bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Сирий webhook (обраний)
                  {selected.instagramUsername ? ` — @${selected.instagramUsername}` : ''}
                  {selected.subscriberId ? ` — subscriber_id: ${selected.subscriberId}` : ''}
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-xs"
                    onClick={() => copyToClipboard('raw', selected.subscriberId || '')}
                    disabled={!selected.subscriberId}
                    title="Скопіювати subscriber_id"
                  >
                    📋 ID
                  </button>
                  <button
                    className="btn btn-xs"
                    onClick={() => copyToClipboard('headers', JSON.stringify(selected.headers || {}, null, 2))}
                  >
                    {copied === 'headers' ? '✅ Headers' : '📋 Headers'}
                  </button>
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() => copyToClipboard('raw', selected.rawBody || '')}
                    disabled={!selected.rawBody}
                  >
                    {copied === 'raw' ? '✅ RAW' : '📋 RAW'}
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Headers</div>
                  <pre className="text-[11px] whitespace-pre-wrap break-words max-h-[220px] overflow-auto bg-white border rounded p-2">
                    {JSON.stringify(selected.headers || {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">RAW body</div>
                  <pre className="text-[11px] whitespace-pre-wrap break-words max-h-[220px] overflow-auto bg-white border rounded p-2">
                    {selected.rawBody || '—'}
                  </pre>
                </div>
              </div>
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
