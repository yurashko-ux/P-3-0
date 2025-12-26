// web/app/admin/direct/_components/StateHistoryModal.tsx
// Модальне вікно для відображення історії змін станів клієнта

"use client";

import { useState, useEffect } from "react";
import type { DirectClient } from "@/lib/direct-types";

type StateHistoryLog = {
  id: string;
  clientId: string;
  state: string | null;
  previousState: string | null;
  reason?: string;
  metadata?: string;
  createdAt: string;
};

type StateHistoryModalProps = {
  client: DirectClient | null;
  isOpen: boolean;
  onClose: () => void;
};

// Функція для отримання назви стану
function getStateName(state: string | null): string {
  const stateNames: Record<string, string> = {
    'lead': 'Лід',
    'client': 'Клієнт',
    'consultation': 'Консультація',
    'hair-extension': 'Нарощування волосся',
    'other-services': 'Інші послуги',
    'all-good': 'Все чудово',
    'too-expensive': 'За дорого',
  };
  return state ? (stateNames[state] || state) : 'Не встановлено';
}

// Функція для отримання причини зміни
function getReasonName(reason?: string): string {
  const reasonNames: Record<string, string> = {
    'altegio-webhook-record': 'Вебхук Altegio (запис)',
    'cron-update-states': 'Автоматичне оновлення',
    'manual-update-states': 'Ручне оновлення',
    'manychat-webhook': 'Вебхук ManyChat',
    'saveDirectClient': 'Збереження клієнта',
    'unknown': 'Невідомо',
  };
  return reason ? (reasonNames[reason] || reason) : 'Невідомо';
}

// Компонент для відображення піктограми стану
function StateIcon({ state }: { state: string | null }) {
  if (state === 'client') {
    return (
      <img 
        src="/assets/image-client.png" 
        alt="Клієнт" 
        className="w-6 h-6 object-contain"
      />
    );
  } else if (state === 'consultation') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  } else if (state === 'hair-extension') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="10" r="6" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5"/>
        <path d="M8 10 Q8 4 14 4 Q20 4 20 10" stroke="#8b5cf6" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <path d="M9 10 Q9 5 14 5 Q19 5 19 10" stroke="#8b5cf6" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M10 10 Q10 6 14 6 Q18 6 18 10" stroke="#8b5cf6" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="12" cy="9" r="0.8" fill="#1f2937"/>
        <circle cx="16" cy="9" r="0.8" fill="#1f2937"/>
        <path d="M12 11 Q14 12 16 11" stroke="#1f2937" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      </svg>
    );
  } else if (state === 'other-services') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 6 L10 22 M18 6 L18 22" stroke="#ec4899" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="10" cy="6" r="2" fill="#ec4899"/>
        <circle cx="18" cy="6" r="2" fill="#ec4899"/>
        <path d="M10 8 Q14 10 18 8" stroke="#ec4899" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <path d="M10 12 Q14 14 18 12" stroke="#ec4899" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <rect x="6" y="16" width="16" height="8" rx="1" stroke="#ec4899" strokeWidth="1.5" fill="none"/>
        <circle cx="14" cy="20" r="2" stroke="#ec4899" strokeWidth="1" fill="none"/>
      </svg>
    );
  } else if (state === 'all-good') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="12" fill="#10b981" stroke="#059669" strokeWidth="1.5"/>
        <path d="M8 14 L12 18 L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'too-expensive') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="12" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5"/>
        <path d="M14 8 L14 20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <path d="M10 12 L18 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <path d="M10 16 L18 16" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="14" cy="14" r="3" stroke="white" strokeWidth="1.5" fill="none"/>
      </svg>
    );
  } else {
    return (
      <img 
        src="/assets/image-lead.png" 
        alt="Лід" 
        className="w-6 h-6 object-contain"
      />
    );
  }
}

export function StateHistoryModal({ client, isOpen, onClose }: StateHistoryModalProps) {
  const [history, setHistory] = useState<StateHistoryLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentState, setCurrentState] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && client) {
      loadHistory();
    }
  }, [isOpen, client]);

  const loadHistory = async () => {
    if (!client) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/direct/state-history?clientId=${client.id}`);
      const data = await res.json();
      
      if (data.ok) {
        setHistory(data.data.history || []);
        setCurrentState(data.data.currentState);
      }
    } catch (err) {
      console.error('Failed to load state history:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  if (!isOpen || !client) return null;

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
        <div className="p-6 flex-shrink-0 border-b border-base-300">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">
              Історія змін стану: {client.firstName} {client.lastName}
            </h3>
            <button
              className="btn btn-sm btn-circle btn-ghost"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Поточний стан */}
              <div className="bg-base-200 p-3 rounded-lg">
                <div className="flex items-center gap-3">
                  <StateIcon state={currentState} />
                  <div>
                    <div className="text-sm font-semibold">Поточний стан</div>
                    <div className="text-xs text-base-content/70">{getStateName(currentState)}</div>
                  </div>
                </div>
              </div>

              {/* Історія */}
              {history.length === 0 ? (
                <div className="text-center py-8 text-base-content/50">
                  Історія змін стану відсутня
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((log, index) => (
                    <div key={log.id} className="border-b border-base-300 pb-2">
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          <StateIcon state={log.state} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-sm">
                              {getStateName(log.state)}
                            </div>
                            <div className="text-xs text-base-content/50">
                              {formatDate(log.createdAt)}
                            </div>
                          </div>
                          {log.previousState && (
                            <div className="text-xs text-base-content/60 mt-1">
                              Зміна з: <span className="font-medium">{getStateName(log.previousState)}</span>
                            </div>
                          )}
                          <div className="text-xs text-base-content/50 mt-1">
                            Причина: {getReasonName(log.reason)}
                          </div>
                          {log.metadata && (
                            <details className="mt-1">
                              <summary className="text-xs text-base-content/50 cursor-pointer">
                                Деталі
                              </summary>
                              <pre className="text-xs bg-base-200 p-2 rounded mt-1 overflow-x-auto">
                                {JSON.stringify(JSON.parse(log.metadata), null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 flex-shrink-0 border-t border-base-300">
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={onClose}>
              Закрити
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
