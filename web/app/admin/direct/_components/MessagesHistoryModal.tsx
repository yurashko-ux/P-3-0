// web/app/admin/direct/_components/MessagesHistoryModal.tsx
// Модальне вікно для відображення історії повідомлень ManyChat для клієнта

'use client';

import { useState, useEffect } from 'react';
import type { DirectChatStatus, DirectClient, DirectClientChatStatusLog } from '@/lib/direct-types';
import { ChatBadgeIcon, CHAT_BADGE_KEYS } from './ChatBadgeIcon';

interface Message {
  receivedAt: string;
  text: string;
  fullName?: string;
  username?: string;
  direction?: 'incoming' | 'outgoing';
  id?: string;
  type?: string;
}

interface MessagesHistoryModalProps {
  client: DirectClient | null;
  isOpen: boolean;
  onClose: () => void;
  onChatStatusUpdated?: () => void;
}

export function MessagesHistoryModal({ client, isOpen, onClose, onChatStatusUpdated }: MessagesHistoryModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);

  const [chatStatuses, setChatStatuses] = useState<DirectChatStatus[]>([]);
  const [chatHistory, setChatHistory] = useState<DirectClientChatStatusLog[]>([]);
  const [chatStatusLoading, setChatStatusLoading] = useState(false);
  const [chatStatusError, setChatStatusError] = useState<string | null>(null);

  const [createMode, setCreateMode] = useState(false);
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusBadgeKey, setNewStatusBadgeKey] = useState<string>('badge_1');

  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && client) {
      loadMessages();
      void loadChatPanel();
    }
  }, [isOpen, client]);

  useEffect(() => {
    if (!client) return;
    setSelectedStatusId((client.chatStatusId || null) as any);
    setNeedsAttention(Boolean((client as any).chatNeedsAttention));
  }, [client?.id, client?.chatStatusId, (client as any)?.chatNeedsAttention]);

  async function loadMessages() {
    if (!client) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const instagramUsername = client.instagramUsername;
      if (!instagramUsername) {
        setError('У клієнта немає Instagram username');
        return;
      }
      
      // Спочатку спробуємо отримати повну історію через ManyChat API
      const apiResponse = await fetch(`/api/admin/direct/manychat-conversation?instagramUsername=${encodeURIComponent(instagramUsername)}`);
      const apiData = await apiResponse.json();
      
      console.log('[MessagesHistoryModal] API response:', apiData);
      
      // Зберігаємо діагностику
      if (apiData.diagnostics) {
        setDiagnostics(apiData.diagnostics);
      }
      
      // Якщо API Key не налаштовано, показуємо помилку
      if (!apiData.ok && apiData.error && apiData.error.includes('API Key not configured')) {
        setError(`API Key не налаштовано. Діагностика: ${JSON.stringify(apiData.diagnostics || {}, null, 2)}`);
        setDiagnostics(apiData.diagnostics);
        return;
      }
      
      if (apiData.ok && apiData.messages && apiData.messages.length > 0) {
        // Конвертуємо повідомлення з ManyChat API в наш формат
        const convertedMessages: Message[] = apiData.messages.map((msg: any) => ({
          receivedAt: msg.timestamp || new Date().toISOString(),
          text: msg.text || '-',
          direction: msg.direction,
          id: msg.id,
          type: msg.type,
        }));
        setMessages(convertedMessages);
        return;
      }
      
      // Якщо API не повернув повідомлення, але subscriber знайдено - показуємо повідомлення
      if (apiData.ok && apiData.subscriberId && apiData.messages && apiData.messages.length === 0) {
        console.log('[MessagesHistoryModal] API returned but no messages. Diagnostics:', apiData.diagnostics);
        // Продовжуємо до fallback (вебхуки)
      }
      
      // Якщо API повернув помилку, але subscriber не знайдено
      if (!apiData.ok && apiData.error) {
        console.log('[MessagesHistoryModal] API error:', apiData.error);
        // Продовжуємо до fallback (вебхуки)
      }
      
      // Якщо API не повернув повідомлення, використовуємо вебхуки
      const response = await fetch(`/api/admin/direct/messages-history?instagramUsername=${encodeURIComponent(instagramUsername)}`);
      const data = await response.json();
      
      if (data.ok) {
        setMessages(data.messages || []);
      } else {
        setError(data.error || 'Помилка завантаження повідомлень');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження повідомлень');
    } finally {
      setLoading(false);
    }
  }

  async function loadChatPanel() {
    if (!client?.id) return;
    try {
      setChatStatusLoading(true);
      setChatStatusError(null);

      const [sRes, hRes] = await Promise.all([
        fetch('/api/admin/direct/chat-statuses'),
        fetch(`/api/admin/direct/clients/${encodeURIComponent(client.id)}/chat-status-history?limit=50`),
      ]);

      const sData = await sRes.json().catch(() => ({}));
      const hData = await hRes.json().catch(() => ({}));

      if (!sData?.ok) {
        setChatStatusError(sData?.error || 'Не вдалося завантажити статуси переписки');
        setChatStatuses([]);
      } else {
        setChatStatuses(Array.isArray(sData.statuses) ? sData.statuses : []);
      }

      if (!hData?.ok) {
        setChatHistory([]);
      } else {
        setChatHistory(Array.isArray(hData.logs) ? hData.logs : []);
      }
    } catch (err) {
      setChatStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatStatusLoading(false);
    }
  }

  async function createChatStatus() {
    try {
      const name = newStatusName.trim();
      if (!name) {
        setChatStatusError('Вкажіть назву статусу');
        return;
      }
      setChatStatusLoading(true);
      setChatStatusError(null);

      const res = await fetch('/api/admin/direct/chat-statuses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, badgeKey: newStatusBadgeKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        setChatStatusError(data?.error || 'Не вдалося створити статус');
        return;
      }
      setCreateMode(false);
      setNewStatusName('');
      setNewStatusBadgeKey('badge_1');
      await loadChatPanel();
    } catch (err) {
      setChatStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatStatusLoading(false);
    }
  }

  async function setClientChatStatus(nextStatusId: string | null) {
    if (!client?.id) return;
    try {
      setChatStatusLoading(true);
      setChatStatusError(null);

      const res = await fetch(`/api/admin/direct/clients/${encodeURIComponent(client.id)}/chat-status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId: nextStatusId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        setChatStatusError(data?.error || 'Не вдалося зберегти статус');
        return;
      }

      setSelectedStatusId(nextStatusId);
      // Після підтвердження/зміни статусу — прибираємо індикатор уваги
      setNeedsAttention(false);

      await loadChatPanel();
      onChatStatusUpdated?.();
    } catch (err) {
      setChatStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatStatusLoading(false);
    }
  }

  function formatDate(dateString: string): string {
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

  if (!isOpen || !client) return null;

  const clientName = client.firstName && client.lastName 
    ? `${client.firstName} ${client.lastName}` 
    : client.firstName || client.lastName || 'Невідомий клієнт';

  const currentStatus = selectedStatusId
    ? (chatStatuses.find((s) => s.id === selectedStatusId) || null)
    : null;

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
        <div className="p-6 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-lg">Історія повідомлень</h3>
              <p className="text-sm text-gray-600 mt-1">
                {clientName} {client.instagramUsername && `(@${client.instagramUsername})`}
              </p>
            </div>
            <button
              className="btn btn-sm btn-circle btn-ghost"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex gap-4">
            {/* Ліва колонка: повідомлення */}
            <div className="flex-1 min-w-0 overflow-y-auto pr-2">
              {loading ? (
                <div className="text-center p-8">
                  <div className="loading loading-spinner loading-lg"></div>
                  <p className="mt-4 text-gray-600">Завантаження...</p>
                </div>
              ) : error ? (
                <div className="alert alert-error">
                  <span>Помилка: {error}</span>
                  <button className="btn btn-sm" onClick={loadMessages}>
                    Спробувати ще раз
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center p-8 text-gray-500">
                  <p className="mb-2">Немає повідомлень для відображення</p>
                  {diagnostics && (
                    <div className="text-xs mt-4 p-4 bg-gray-100 rounded text-left max-w-md mx-auto">
                      <p className="font-semibold mb-2">Діагностика:</p>
                      <ul className="space-y-1">
                        <li>API Key: {diagnostics.apiKeyConfigured ? '✅ Налаштовано' : '❌ Не налаштовано'}</li>
                        <li>Subscriber знайдено: {diagnostics.subscriberFound ? '✅ Так' : '❌ Ні'}</li>
                        {diagnostics.subscriberId && <li>Subscriber ID: {diagnostics.subscriberId}</li>}
                        <li>Повідомлень знайдено: {diagnostics.messagesFound || 0}</li>
                      </ul>
                      {diagnostics.subscriberFound && diagnostics.messagesFound === 0 && (
                        <p className="mt-2 text-orange-600">
                          ⚠️ ManyChat API може не підтримувати endpoint для історії повідомлень
                        </p>
                      )}
                    </div>
                  )}
                  <p className="text-xs mt-2">
                    Повідомлення зберігаються тільки коли клієнт пише в ManyChat
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message, index) => {
                    const isOutgoing = message.direction === 'outgoing';
                    return (
                      <div key={message.id || `${message.receivedAt}-${index}`} className="border-b border-gray-200 pb-4 last:border-b-0">
                        <div className={`flex items-start gap-3 ${isOutgoing ? 'flex-row-reverse' : ''}`}>
                          <div className="flex-1">
                            <div className={`flex items-center gap-2 mb-1 ${isOutgoing ? 'justify-end' : ''}`}>
                              {isOutgoing && (
                                <span className="text-xs font-medium text-blue-600">
                                  Ви
                                </span>
                              )}
                              <span className="text-xs font-medium text-gray-600">
                                {formatDate(message.receivedAt)}
                              </span>
                              <span className="text-xs text-gray-400">
                                ({formatRelativeTime(message.receivedAt)})
                              </span>
                              {!isOutgoing && (
                                <span className="text-xs font-medium text-gray-600">
                                  Клієнт
                                </span>
                              )}
                            </div>
                            <div className={`rounded-lg p-3 text-sm ${
                              isOutgoing
                                ? 'bg-blue-100 text-blue-900 ml-auto max-w-[80%]'
                                : 'bg-gray-100'
                            }`}>
                              {message.text}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!loading && !error && messages.length > 0 && (
                <div className="mt-4 text-sm text-gray-500">
                  Всього повідомлень: {messages.length}
                  <p className="text-xs mt-1 text-gray-400">
                    {messages.some(m => m.direction === 'outgoing')
                      ? 'Показуються всі повідомлення (включно з нашими відповідями через ManyChat API)'
                      : 'Показуються тільки повідомлення від клієнта (через ManyChat вебхуки). Для повної історії налаштуйте MANYCHAT_API_KEY'
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Права колонка: статуси переписки + історія */}
            <div className="w-[320px] shrink-0 border-l pl-4 overflow-y-auto">
              <div className="mb-3">
                <div className="text-sm font-semibold">Статус переписки</div>
                <div className="text-xs text-gray-600 mt-1">
                  Поточний: {currentStatus ? (
                    <span className="inline-flex items-center gap-2" title={currentStatus.name}>
                      <ChatBadgeIcon badgeKey={(currentStatus as any).badgeKey} size={16} />
                      <span className="truncate">{currentStatus.name}</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">без статусу</span>
                  )}
                </div>
                {needsAttention ? (
                  <div className="mt-2 text-xs text-red-600 flex items-center gap-2">
                    <span className="inline-block w-[8px] h-[8px] rounded-full bg-red-600" />
                    Є нові вхідні повідомлення — потрібна увага
                  </div>
                ) : null}
              </div>

              <div className="mb-3 flex items-center gap-2">
                <button
                  className="btn btn-xs btn-outline"
                  onClick={() => setCreateMode((v) => !v)}
                >
                  {createMode ? 'Скасувати' : 'Створити статус'}
                </button>
                <button
                  className="btn btn-xs"
                  onClick={() => void setClientChatStatus(selectedStatusId)}
                  disabled={chatStatusLoading}
                  title="Підтвердити поточний статус (прибрати червону крапку)"
                >
                  Підтвердити
                </button>
              </div>

              {createMode ? (
                <div className="mb-4 p-3 rounded border bg-base-100">
                  <div className="text-xs font-semibold mb-2">Новий статус</div>
                  <label className="form-control w-full mb-2">
                    <div className="label py-0">
                      <span className="label-text text-xs">Назва</span>
                    </div>
                    <input
                      className="input input-xs input-bordered w-full"
                      value={newStatusName}
                      onChange={(e) => setNewStatusName(e.target.value)}
                      placeholder="Напр.: Консультація уточнити"
                    />
                  </label>
                  <div className="mb-2">
                    <div className="text-xs mb-1">Бейдж</div>
                    <div className="grid grid-cols-5 gap-2">
                      {CHAT_BADGE_KEYS.map((k) => {
                        const isSelected = newStatusBadgeKey === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            className={`btn btn-xs ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setNewStatusBadgeKey(k)}
                            title={`Обрати ${k}`}
                          >
                            <ChatBadgeIcon badgeKey={k} size={16} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button className="btn btn-xs btn-primary" onClick={createChatStatus} disabled={chatStatusLoading}>
                    Зберегти
                  </button>
                </div>
              ) : null}

              {chatStatusError ? (
                <div className="text-xs text-red-600 mb-3">{chatStatusError}</div>
              ) : null}

              <div className="mb-4">
                <div className="text-xs font-semibold mb-2">Варіанти</div>
                <div className="flex flex-col gap-2">
                  <button
                    className="btn btn-xs"
                    onClick={() => void setClientChatStatus(null)}
                    disabled={chatStatusLoading}
                    title="Зняти статус (без статусу)"
                  >
                    Без статусу
                  </button>
                  {chatStatuses.map((s) => {
                    const isSelected = selectedStatusId === s.id;
                    return (
                      <button
                        key={s.id}
                        className={`btn btn-xs justify-start ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => void setClientChatStatus(s.id)}
                        disabled={chatStatusLoading}
                        title={s.name}
                      >
                        <ChatBadgeIcon badgeKey={(s as any).badgeKey} size={16} />
                        <span className="truncate">{s.name}</span>
                      </button>
                    );
                  })}
                  {chatStatuses.length === 0 && !chatStatusLoading ? (
                    <div className="text-xs text-gray-400">Немає статусів (створіть перший)</div>
                  ) : null}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold mb-2">Історія статусів</div>
                {chatStatusLoading ? (
                  <div className="text-xs text-gray-500">Завантаження…</div>
                ) : chatHistory.length === 0 ? (
                  <div className="text-xs text-gray-400">Немає змін статусів</div>
                ) : (
                  <div className="space-y-2">
                    {chatHistory.map((h) => {
                      const fromName = h.fromStatus?.name || (h.fromStatusId ? '—' : 'без статусу');
                      const toName = h.toStatus?.name || (h.toStatusId ? '—' : 'без статусу');
                      return (
                        <div key={h.id} className="text-xs p-2 rounded border">
                          <div className="text-gray-600">{formatDate(h.changedAt)}</div>
                          <div className="mt-1">
                            <span className="opacity-70">{fromName}</span> → <span className="font-semibold">{toName}</span>
                          </div>
                          {h.changedBy ? (
                            <div className="mt-1 text-gray-500">Хто: {h.changedBy}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          {!loading && !error && (
            <button className="btn btn-sm btn-primary" onClick={loadMessages}>
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
