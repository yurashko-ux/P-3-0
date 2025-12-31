// web/app/admin/direct/_components/TelegramMessagesModal.tsx
// Модальне вікно для перегляду повідомлень з Telegram бота

"use client";

import { useState, useEffect } from "react";

type TelegramMessage = {
  receivedAt: string;
  updateId: number;
  hasMessage: boolean;
  hasCallbackQuery: boolean;
  messageText?: string;
  messageChatId?: number;
  messageFromUsername?: string;
  messageFromId?: number;
  messageFromFirstName?: string;
  messageFromLastName?: string;
  replyToMessage?: boolean;
  replyToMessageId?: number;
  replyToMessageText?: string;
  callbackData?: string;
  fullUpdate?: string;
};

type TelegramMessagesModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function TelegramMessagesModal({ isOpen, onClose }: TelegramMessagesModalProps) {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadMessages();
    }
  }, [isOpen]);

  const loadMessages = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/direct/telegram-messages?limit=200');
      const data = await res.json();
      if (data.ok) {
        setMessages(data.messages || []);
      } else {
        setError(data.error || 'Помилка завантаження повідомлень');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <h3 className="font-bold text-lg mb-4">Повідомлення з Telegram бота (HOB_client_bot)</h3>
        
        <div className="flex gap-2 mb-4">
          <button
            className="btn btn-sm btn-primary"
            onClick={loadMessages}
            disabled={loading}
          >
            {loading ? 'Завантаження...' : '🔄 Оновити'}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={onClose}
          >
            ✕ Закрити
          </button>
        </div>

        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}

        <div className="overflow-y-auto flex-1">
          {loading && messages.length === 0 ? (
            <div className="text-center py-8">
              <span className="loading loading-spinner loading-lg"></span>
              <p className="mt-4">Завантаження повідомлень...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Немає повідомлень
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, index) => (
                <div key={index} className="card bg-base-200 shadow-sm">
                  <div className="card-body p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="font-semibold">Час отримання:</span>
                        <span className="ml-2">{formatDate(msg.receivedAt)}</span>
                      </div>
                      <div>
                        <span className="font-semibold">Update ID:</span>
                        <span className="ml-2">{msg.updateId}</span>
                      </div>
                      
                      {msg.hasMessage && (
                        <>
                          <div>
                            <span className="font-semibold">Chat ID:</span>
                            <span className="ml-2">{msg.messageChatId}</span>
                          </div>
                          <div>
                            <span className="font-semibold">Від:</span>
                            <span className="ml-2">
                              {msg.messageFromFirstName} {msg.messageFromLastName}
                              {msg.messageFromUsername && ` (@${msg.messageFromUsername})`}
                              {msg.messageFromId && ` [${msg.messageFromId}]`}
                            </span>
                          </div>
                          {msg.messageText && (
                            <div className="md:col-span-2">
                              <span className="font-semibold">Текст повідомлення:</span>
                              <div className="mt-1 p-2 bg-base-100 rounded">
                                <pre className="whitespace-pre-wrap break-words">{msg.messageText}</pre>
                              </div>
                            </div>
                          )}
                          {msg.replyToMessage && msg.replyToMessageText && (
                            <div className="md:col-span-2">
                              <span className="font-semibold">Відповідь на:</span>
                              <div className="mt-1 p-2 bg-base-100 rounded">
                                <pre className="whitespace-pre-wrap break-words text-xs">{msg.replyToMessageText}</pre>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      
                      {msg.hasCallbackQuery && msg.callbackData && (
                        <div className="md:col-span-2">
                          <span className="font-semibold">Callback Data:</span>
                          <div className="mt-1 p-2 bg-base-100 rounded">
                            <code className="text-xs">{msg.callbackData}</code>
                          </div>
                        </div>
                      )}
                      
                      {msg.fullUpdate && (
                        <div className="md:col-span-2">
                          <details className="collapse collapse-arrow bg-base-100">
                            <summary className="collapse-title text-sm font-medium">
                              Повний JSON
                            </summary>
                            <div className="collapse-content">
                              <pre className="text-xs overflow-x-auto">
                                {JSON.stringify(JSON.parse(msg.fullUpdate), null, 2)}
                              </pre>
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
}

