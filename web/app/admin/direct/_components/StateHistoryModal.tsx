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
  masterId?: string;
  masterName?: string;
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
    // Стан `consultation` більше не використовуємо як окремий, але залишаємо мапінг для старих логів
    'consultation': 'Запис на консультацію',
    'consultation-booked': 'Запис на консультацію',
    'consultation-no-show': "Не з'явився (конс.)",
    'consultation-rescheduled': 'Перенос (конс.)',
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
    'initial': 'Початковий стан',
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
  } else if (state === 'consultation') {
    // Стан `consultation` більше не відображаємо окремо (щоб не плутати зі “записом на консультацію”).
    // Для сумісності зі старими даними показуємо той самий значок, що й `consultation-booked`.
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#2563eb" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M12 18 L13.5 19.5 L16 17" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'message') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  } else if (state === 'consultation-booked') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#2563eb" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M12 18 L13.5 19.5 L16 17" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'consultation-no-show') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#ef4444" stroke="#dc2626" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#dc2626" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M11 18 L17 18" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );
  } else if (state === 'consultation-rescheduled') {
    return (
      <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#d97706" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#d97706" strokeWidth="1.5"/>
        <path d="M11 17 L14 14 L17 17 M17 17 L14 20 L11 17" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'hair-extension') {
    return (
      <img 
        src="/assets/image-client.png" 
        alt="Нарощування волосся" 
        className="w-6 h-6 object-contain"
      />
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
  const [currentStateMasterName, setCurrentStateMasterName] = useState<string | undefined>(undefined);
  const [currentStateDate, setCurrentStateDate] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (isOpen && client) {
      loadHistory();
    }
  }, [isOpen, client]);

  const loadHistory = async () => {
    if (!client) return;
    
    setLoading(true);
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'verify-1',hypothesisId:'H0',location:'StateHistoryModal.tsx:loadHistory',message:'loadHistory start',data:{clientId:String(client.id||''),isOpen:!!isOpen,ts:new Date().toISOString()},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log

      const res = await fetch(`/api/admin/direct/state-history?clientId=${client.id}`);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'verify-1',hypothesisId:'H0',location:'StateHistoryModal.tsx:loadHistory',message:'state-history fetch response',data:{status:res.status,ok:res.ok},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
      const data = await res.json();
      
      if (data.ok) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1',location:'StateHistoryModal.tsx:loadHistory',message:'Fetched state-history payload summary',data:{hasData:!!data?.data,currentState:String(data?.data?.currentState||''),historyLen:Array.isArray(data?.data?.history)?data.data.history.length:0,historyStates:Array.isArray(data?.data?.history)?data.data.history.map((h:any)=>String(h?.state||'')).slice(0,20):[]},timestamp:Date.now()})}).catch(()=>{});
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'post-fix',hypothesisId:'H1',location:'StateHistoryModal.tsx:loadHistory',message:'Fetched state-history payload summary',data:{hasData:!!data?.data,currentState:String(data?.data?.currentState||''),historyLen:Array.isArray(data?.data?.history)?data.data.history.length:0,historyStates:Array.isArray(data?.data?.history)?data.data.history.map((h:any)=>String(h?.state||'')).slice(0,20):[]},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        // Фільтруємо записи зі станом "no-instagram" (видалений стан)
        const filteredHistory = (data.data.history || []).filter(
          (log: StateHistoryLog) => log.state !== 'no-instagram'
        );

        // #region agent log
        try {
          // Дивимось, чи лишилися дублікати станів у raw history
          const states = filteredHistory.map((h) => String(h?.state || ''));
          const counts: Record<string, number> = {};
          for (const s of states) counts[s] = (counts[s] || 0) + 1;
          const dups = Object.entries(counts).filter(([, n]) => n > 1).map(([s, n]) => `${s}:${n}`).slice(0, 20);
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H2',location:'StateHistoryModal.tsx:loadHistory',message:'Raw history duplicate states (counts>1)',data:{dups},timestamp:Date.now()})}).catch(()=>{});
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'post-fix',hypothesisId:'H2',location:'StateHistoryModal.tsx:loadHistory',message:'Raw history duplicate states (counts>1)',data:{dups},timestamp:Date.now()})}).catch(()=>{});
        } catch {}
        // #endregion agent log

        setHistory(filteredHistory);
        // Якщо поточний стан - "no-instagram", не показуємо його.
        // Нормалізація: `consultation` -> `consultation-booked`
        let currentStateValue = data.data.currentState === 'no-instagram' ? null : data.data.currentState;
        if (currentStateValue === 'consultation') currentStateValue = 'consultation-booked';

        // #region agent log
        try {
          const lastHistoryState = filteredHistory.length ? String(filteredHistory[filteredHistory.length - 1]?.state || '') : '';
          const cs = currentStateValue ? String(currentStateValue) : '';
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'StateHistoryModal.tsx:loadHistory',message:'currentState vs lastHistoryState',data:{currentState:cs,lastHistoryState,lastHistoryDiff:cs!==lastHistoryState},timestamp:Date.now()})}).catch(()=>{});
          fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'post-fix',hypothesisId:'H3',location:'StateHistoryModal.tsx:loadHistory',message:'currentState vs lastHistoryState',data:{currentState:cs,lastHistoryState,lastHistoryDiff:cs!==lastHistoryState},timestamp:Date.now()})}).catch(()=>{});
        } catch {}
        // #endregion agent log

        setCurrentState(currentStateValue);
        setCurrentStateMasterName(data.data.currentStateMasterName);
        setCurrentStateDate(data.data.currentStateDate);
      }
    } catch (err) {
      console.error('Failed to load state history:', err);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'verify-1',hypothesisId:'H0',location:'StateHistoryModal.tsx:loadHistory',message:'loadHistory catch',data:{err:String(err instanceof Error ? err.message : err)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
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
              {/* Історія (включаючи поточний стан) */}
              {history.length === 0 && !currentState ? (
                <div className="text-center py-8 text-base-content/50">
                  Історія змін стану відсутня
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Поточний стан відображається першим, якщо він не збігається з останнім записом в історії */}
                  {/* РАДИКАЛЬНЕ ПРАВИЛО: "Лід" тільки для клієнтів з Manychat (БЕЗ altegioClientId) */}
                  {(() => {
                    const isManychatClient = !client.altegioClientId;
                    
                    // Для Altegio клієнтів - НЕ показуємо поточний стан, якщо він "lead"
                    if (!isManychatClient && currentState === 'lead') {
                      return null;
                    }
                    
                    // Для Manychat клієнтів - перевіряємо, чи є "lead" в історії
                    const hasLeadInHistory = history.some(log => log.state === 'lead');
                    // Не показуємо поточний стан "lead", якщо в історії вже є "lead"
                    if (isManychatClient && currentState === 'lead' && hasLeadInHistory) {
                      return null;
                    }
                    
                    // Не дублюємо поточний стан: якщо такий state вже є в історії — окремо зверху не показуємо.
                    const currentStateExistsInHistory = currentState ? history.some((h) => h.state === currentState) : false;
                    return currentState && !currentStateExistsInHistory ? (
                      <div className="flex items-center gap-3 pb-2 border-b border-base-300">
                        <div className="text-xs text-base-content/50 font-medium min-w-[140px]">
                          {currentStateDate ? formatDate(currentStateDate) : (client.updatedAt ? formatDate(client.updatedAt) : 'Поточний')}
                        </div>
                        <div className="flex items-center gap-2">
                          <StateIcon state={currentState} />
                          <div className="font-semibold text-sm">
                            {getStateName(currentState)}
                          </div>
                          {currentStateMasterName && (
                            <div className="text-xs text-base-content/60 ml-2">
                              {currentStateMasterName}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null;
                  })()}
                  
                  {/* Історія (від новіших до старіших - реверсуємо масив) */}
                  {(() => {
                    // РАДИКАЛЬНЕ ПРАВИЛО: "Лід" тільки для клієнтів з Manychat (БЕЗ altegioClientId)
                    const isManychatClient = !client.altegioClientId;
                    
                    // Спочатку сортуємо за датою (від старіших до новіших), щоб знайти найстаріший "lead"
                    const sortedHistory = [...history].sort((a, b) => 
                      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    );
                    
                    // Розділяємо на "lead", "client", consultation-related стани, "message" та інші стани
                    const leadLogs = sortedHistory.filter(log => log.state === 'lead');
                    const clientLogs = sortedHistory.filter(log => log.state === 'client');
                    const messageLogs = sortedHistory.filter(log => log.state === 'message');
                    const consultationBookedLogs = sortedHistory.filter(log => log.state === 'consultation-booked');
                    const consultationNoShowLogs = sortedHistory.filter(log => log.state === 'consultation-no-show');
                    const consultationRescheduledLogs = sortedHistory.filter(log => log.state === 'consultation-rescheduled');
                    const otherLogs = sortedHistory.filter(log => 
                      log.state !== 'lead' && 
                      log.state !== 'client' && 
                      log.state !== 'message' &&
                      log.state !== 'no-instagram' &&
                      log.state !== 'consultation' &&
                      log.state !== 'consultation-booked' &&
                      log.state !== 'consultation-no-show' &&
                      log.state !== 'consultation-rescheduled'
                    );
                    
                    // НОВЕ ПРАВИЛО: Якщо найстаріший стан - "message", відображаємо його як "Лід"
                    // Це працює для ВСІХ клієнтів (навіть з altegioClientId), бо перше повідомлення = перший контакт = Лід
                    // АЛЕ: якщо є справжній "lead" стан, він має пріоритет
                    let oldestMessageAsLead: typeof sortedHistory[0] | null = null;
                    if (messageLogs.length > 0 && leadLogs.length === 0) {
                      // Перевіряємо, чи "message" найстаріший стан тільки якщо немає справжнього "lead"
                      const oldestMessage = messageLogs[0]; // Вже відсортовано від старіших до новіших
                      
                      // Перевіряємо, чи "message" найстаріший стан (перевіряємо проти всіх інших станів)
                      const allOtherStates = [...clientLogs, ...consultationBookedLogs, ...consultationNoShowLogs, ...consultationRescheduledLogs, ...otherLogs];
                      const olderThanMessage = allOtherStates.filter(log => 
                        new Date(log.createdAt).getTime() < new Date(oldestMessage.createdAt).getTime()
                      );
                      
                      // Якщо "message" найстаріший - відображаємо його як "Лід"
                      if (olderThanMessage.length === 0) {
                        oldestMessageAsLead = {
                          ...oldestMessage,
                          state: 'lead', // Відображаємо як "Лід"
                        };
                      }
                    }
                    
                    // ФІЛЬТРУЄМО: для Altegio клієнтів - видаляємо ВСІ "lead" (крім якщо це перше повідомлення)
                    // для Manychat клієнтів - залишаємо тільки найстаріший "lead", але ТІЛЬКИ якщо він дійсно найстаріший
                    // для ВСІХ клієнтів - залишаємо тільки найстаріший "client"
                    // для consultation-related станів - залишаємо тільки найстаріший (якщо є)
                    let filteredHistory: typeof sortedHistory = [];
                    
                    // Якщо перше повідомлення має відображатися як "Лід" - додаємо його
                    if (oldestMessageAsLead) {
                      filteredHistory.push(oldestMessageAsLead);
                    } else if (isManychatClient && leadLogs.length > 0) {
                      // Знаходимо найстаріший "lead"
                      const oldestLead = leadLogs[0]; // Вже відсортовано від старіших до новіших
                      
                      // Перевіряємо, чи є стани старіші за "lead" (враховуючи всі стани, включно з consultation та message)
                      const allOtherStates = [...clientLogs, ...messageLogs, ...consultationBookedLogs, ...consultationNoShowLogs, ...consultationRescheduledLogs, ...otherLogs];
                      const olderThanLead = allOtherStates.filter(log => 
                        new Date(log.createdAt).getTime() < new Date(oldestLead.createdAt).getTime()
                      );
                      
                      // Якщо "lead" найстаріший - залишаємо його
                      if (olderThanLead.length === 0) {
                        filteredHistory.push(oldestLead);
                      }
                      // Якщо є стани старіші - не показуємо "lead"
                    }
                    
                    // Для ВСІХ клієнтів - залишаємо тільки найстаріший "client"
                    if (clientLogs.length > 0) {
                      filteredHistory.push(clientLogs[0]); // Тільки найстаріший "client"
                    }
                    
                    // Для consultation-related станів - залишаємо тільки найстаріший (якщо є)
                    // Стан `consultation` більше не показуємо в UI (факт приходу дивимось по ✅ у даті консультації).
                    if (consultationBookedLogs.length > 0) {
                      filteredHistory.push(consultationBookedLogs[0]); // Тільки найстаріший "consultation-booked"
                    }
                    if (consultationNoShowLogs.length > 0) {
                      filteredHistory.push(consultationNoShowLogs[0]); // Тільки найстаріший "consultation-no-show"
                    }
                    if (consultationRescheduledLogs.length > 0) {
                      filteredHistory.push(consultationRescheduledLogs[0]); // Тільки найстаріший "consultation-rescheduled"
                    }
                    
                    // Додаємо всі інші стани (без "no-instagram")
                    // Якщо перше повідомлення вже відображено як "Лід", не додаємо інші "message" стани
                    const remainingMessageLogs = oldestMessageAsLead 
                      ? messageLogs.filter(log => log.id !== oldestMessageAsLead.id)
                      : messageLogs;
                    // Уникаємо дублювання стану `message` — показуємо тільки один запис (найстаріший).
                    if (remainingMessageLogs.length > 0) {
                      filteredHistory.push(remainingMessageLogs[0]);
                    }
                    filteredHistory.push(...otherLogs);
                    
                    // Сортуємо назад від новіших до старіших для відображення
                    filteredHistory.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                    
                    return filteredHistory.map((log, index) => (
                    <div key={log.id} className="flex items-center gap-3 pb-2 border-b border-base-300 last:border-b-0">
                      <div className="text-xs text-base-content/50 font-medium min-w-[140px]">
                        {formatDate(log.createdAt)}
                      </div>
                      <div className="flex items-center gap-2">
                        <StateIcon state={log.state} />
                        <div className="font-semibold text-sm">
                          {getStateName(log.state)}
                        </div>
                        {log.masterName && (
                          <div className="text-xs text-base-content/60 ml-2">
                            {log.masterName}
                          </div>
                        )}
                      </div>
                    </div>
                    ));
                  })()}
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
