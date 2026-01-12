// web/app/admin/direct/_components/MessagesHistoryModal.tsx
// Модальне вікно для відображення історії повідомлень ManyChat для клієнта

'use client';

import { useState, useEffect } from 'react';
import type { DirectClient } from '@/lib/direct-types';

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
}

export function MessagesHistoryModal({ client, isOpen, onClose }: MessagesHistoryModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);

  useEffect(() => {
    if (isOpen && client) {
      loadMessages();
    }
  }, [isOpen, client]);

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
      
      // Зберігаємо діагностику
      if (apiData.diagnostics) {
        setDiagnostics(apiData.diagnostics);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 flex-1 overflow-y-auto">
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
