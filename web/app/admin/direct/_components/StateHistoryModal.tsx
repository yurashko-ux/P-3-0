// web/app/admin/direct/_components/StateHistoryModal.tsx
// Модальне вікно для відображення історії змін станів клієнта

"use client";

import { useState, useEffect } from "react";
import type { DirectClient } from "@/lib/direct-types";
import { ClientNameWithLoyalty } from "@/app/admin/_components/ClientNameWithLoyalty";
import { getFullName } from "./direct-client-table-formatters";
import { StateIcon } from "./StateIcon";

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

type LeadSourceOption = { code: string; name: string; kind: string };

// Швидке призначення рекламного кабінету прямо з картки клієнта — за ad_id (referral),
// без заходу на окрему сторінку "Джерела". Показується лише якщо лід прийшов з реклами (є leadAdId).
function AdSourceQuickAssign({ client }: { client: DirectClient }) {
  const leadAdId = (client as unknown as { leadAdId?: string }).leadAdId;
  const [sources, setSources] = useState<LeadSourceOption[]>([]);
  const [sourceCode, setSourceCode] = useState<string>("");
  const [adTitle, setAdTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!leadAdId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sourcesRes, adIdsRes] = await Promise.all([
          fetch("/api/admin/direct/lead-sources", { cache: "no-store" }),
          fetch("/api/admin/direct/lead-sources/ad-ids", { cache: "no-store" }),
        ]);
        const sourcesData = await sourcesRes.json().catch(() => null);
        const adIdsData = await adIdsRes.json().catch(() => null);
        if (cancelled) return;
        if (sourcesData?.ok) setSources(sourcesData.sources || []);
        const row = ((adIdsData?.adIds || []) as Array<{ adId: string; sourceCode: string | null; adTitle: string | null }>).find(
          (r) => r.adId === leadAdId,
        );
        setSourceCode(row?.sourceCode || "");
        setAdTitle(row?.adTitle || null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadAdId]);

  async function assign(code: string) {
    if (!leadAdId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/direct/lead-sources/ad-ids", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adId: leadAdId, sourceCode: code || null }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) setSourceCode(code);
    } finally {
      setSaving(false);
    }
  }

  if (!leadAdId) return null;
  const adsSources = sources.filter((s) => s.kind === "ads");

  return (
    <div className="flex flex-col items-end gap-0.5" title={adTitle ? `Оголошення: ${adTitle}` : undefined}>
      <select
        className="select select-bordered select-xs"
        value={sourceCode}
        disabled={loading || saving}
        onChange={(event) => void assign(event.target.value)}
      >
        <option value="">— не призначено —</option>
        {adsSources.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="text-[10px] text-base-content/50">Кабінет (ad_id)</span>
    </div>
  );
}

// Функція для отримання назви стану
function getStateName(state: string | null): string {
  const stateNames: Record<string, string> = {
    // Стан "lead" більше не використовується - видалено
    'client': 'Клієнт',
    'new-lead': 'Новий лід',
    'message': 'Повідомлення',
    // Стан `consultation` більше не використовуємо як окремий, але залишаємо мапінг для старих логів
    'consultation': 'Запис на консультацію',
    'consultation-booked': 'Запис на консультацію',
    'consultation-past': 'Консультація з минулою датою',
    'consultation-no-show': "Не з'явився (конс.)",
    'consultation-rescheduled': 'Перенос (конс.)',
    'hair-extension': 'Нарощування волосся',
    'other-services': 'Інші послуги',
    'all-good': 'Все чудово',
    'too-expensive': 'За дорого',
    'sold': 'Продано!',
    'inactive': 'Неактивний клієнт',
    'restored': 'Відновлений клієнт',
    'binotel-lead': 'Binotel-лід',
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
      const res = await fetch(`/api/admin/direct/state-history?clientId=${client.id}`);
      const data = await res.json();
      
      if (data.ok) {
        // Фільтруємо записи зі станом "no-instagram" (видалений стан)
        const filteredHistory = (data.data.history || []).filter(
          (log: StateHistoryLog) => log.state !== 'no-instagram'
        );
        setHistory(filteredHistory);
        // Якщо поточний стан - "no-instagram", не показуємо його.
        // Нормалізація: `consultation` -> `consultation-booked`
        let currentStateValue = data.data.currentState === 'no-instagram' ? null : data.data.currentState;
        if (currentStateValue === 'consultation') currentStateValue = 'consultation-booked';

        setCurrentState(currentStateValue);
        setCurrentStateMasterName(data.data.currentStateMasterName);
        setCurrentStateDate(data.data.currentStateDate);
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
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-lg flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>Історія змін стану:</span>
              <ClientNameWithLoyalty
                name={
                  (() => {
                    const n = getFullName(client);
                    return n && n !== "-"
                      ? n
                      : client.instagramUsername || "Клієнт";
                  })()
                }
                spent={client.spent}
                visits={client.visits}
                nameClassName="font-bold text-lg"
              />
            </h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              <AdSourceQuickAssign client={client} />
              <button
                className="btn btn-sm btn-circle btn-ghost"
                onClick={onClose}
              >
                ✕
              </button>
            </div>
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
                    
                    // Стан "lead" видалено — не робимо спеціальних хаків для нього
                    
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
                    
                    // Сортуємо за датою (від старіших до новіших)
                    const sortedHistory = [...history].sort((a, b) => 
                      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    );
                    
                    // Розділяємо на "client", consultation-related стани, "message" та інші стани
                    // Стан "lead" більше не використовується
                    const clientLogs = sortedHistory.filter(log => log.state === 'client');
                    const messageLogs = sortedHistory.filter(log => log.state === 'message');
                    const consultationBookedLogs = sortedHistory.filter(log => log.state === 'consultation-booked');
                    const consultationNoShowLogs = sortedHistory.filter(log => log.state === 'consultation-no-show');
                    const consultationRescheduledLogs = sortedHistory.filter(log => log.state === 'consultation-rescheduled');
                    const otherLogs = sortedHistory.filter(log => 
                      log.state !== 'client' && 
                      log.state !== 'message' &&
                      log.state !== 'no-instagram' &&
                      log.state !== 'consultation' &&
                      log.state !== 'consultation-booked' &&
                      log.state !== 'consultation-no-show' &&
                      log.state !== 'consultation-rescheduled'
                    );
                    
                    // Стан "lead" більше не використовується - фільтруємо історію
                    let filteredHistory: typeof sortedHistory = [];
                    
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
                    const remainingMessageLogs = messageLogs;
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
