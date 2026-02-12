// web/app/admin/direct/_components/MessagesHistoryModal.tsx
// Модальне вікно для відображення історії повідомлень ManyChat для клієнта

'use client';

import { useState, useEffect, useMemo } from 'react';
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
  onChatStatusUpdated?: (update: {
    clientId: string;
    chatStatusId: string | null;
    chatStatusName?: string;
    chatStatusBadgeKey?: string;
    chatNeedsAttention?: boolean;
    chatStatusAnchorMessageId?: string | null;
    chatStatusAnchorMessageReceivedAt?: string | null;
    chatStatusAnchorSetAt?: string | null;
  }) => void;
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

  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editStatusName, setEditStatusName] = useState<string>('');
  const [editStatusBadgeKey, setEditStatusBadgeKey] = useState<string>('badge_1');

  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState<boolean>(false);
  const [statusAnchorMessageId, setStatusAnchorMessageId] = useState<string | null>(null);
  const [statusAnchorReceivedAt, setStatusAnchorReceivedAt] = useState<string | null>(null);

  const NEW_STATUS_NAME_MAX_LEN = 24;

  function dayKeyFromDateString(dateString: string): string {
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return '';
    }
  }

  function formatDayHeaderFromKey(dayKey: string): string {
    try {
      const [y, m, d] = dayKey.split('-').map((x) => Number(x));
      if (!y || !m || !d) return dayKey;
      const dt = new Date(y, m - 1, d);
      const now = new Date();
      const sameYear = dt.getFullYear() === now.getFullYear();
      return new Intl.DateTimeFormat('uk-UA', {
        day: 'numeric',
        month: 'long',
        ...(sameYear ? {} : { year: 'numeric' }),
      }).format(dt);
    } catch {
      return dayKey;
    }
  }

  function formatTimeHHMM(dateString: string): string {
    try {
      const dt = new Date(dateString);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  const groupedMessages = useMemo(() => {
    const arr = Array.isArray(messages) ? messages : [];
    const out: Array<{ dayKey: string; items: Message[] }> = [];
    let lastKey = '';
    for (const msg of arr) {
      const k = dayKeyFromDateString(msg.receivedAt) || 'unknown';
      if (!out.length || k !== lastKey) {
        out.push({ dayKey: k, items: [msg] });
        lastKey = k;
      } else {
        out[out.length - 1].items.push(msg);
      }
    }
    return out;
  }, [messages]);

  function toMsSafe(dateString: string | null | undefined): number | null {
    try {
      if (!dateString) return null;
      const ms = new Date(String(dateString)).getTime();
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }

  function ChatAvatar40({ username }: { username: string }) {
    const u = (username || '').toString().trim();
    const isNoInstagram = u === 'NO INSTAGRAM' || u.startsWith('no_instagram_');
    const isMissingInstagram = u.startsWith('missing_instagram_');
    const isNormalInstagram = Boolean(u) && !isNoInstagram && !isMissingInstagram;
    const avatarSrc = isNormalInstagram
      ? `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(u)}`
      : null;

    return (
      <span className="w-10 h-10 rounded-full bg-base-200 overflow-hidden border border-base-300 shrink-0">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt=""
            className="w-10 h-10 object-cover"
            onError={(e) => {
              // Ховаємо <img>, але залишаємо слот (щоб верстка не “стрибала”)
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
      </span>
    );
  }

  useEffect(() => {
    if (isOpen && client) {
      loadMessages();
      void loadChatPanel();
    }
  }, [isOpen, client?.id]);

  useEffect(() => {
    if (!client) return;
    setSelectedStatusId((client.chatStatusId || null) as any);
    setNeedsAttention(Boolean((client as any).chatNeedsAttention));
    setStatusAnchorMessageId(((client as any).chatStatusAnchorMessageId || null) as any);
    setStatusAnchorReceivedAt(((client as any).chatStatusAnchorMessageReceivedAt || null) as any);
  }, [client?.id, client?.chatStatusId, (client as any)?.chatNeedsAttention]);

  async function loadMessages() {
    if (!client) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const instagramUsername = client.instagramUsername;
      const hasInstagram = Boolean(instagramUsername && !instagramUsername.startsWith('missing_instagram_') && !instagramUsername.startsWith('no_instagram_'));
      
      // Якщо немає Instagram — завантажуємо тільки з БД (DirectMessage) по clientId
      if (!hasInstagram) {
        const params = new URLSearchParams();
        params.set('clientId', client.id);
        const response = await fetch(`/api/admin/direct/messages-history?${params.toString()}`);
        const data = await response.json();
        if (data.ok) {
          setMessages(data.messages || []);
          setError(null);
        } else {
          setError(data.error || 'Помилка завантаження повідомлень');
        }
        return;
      }
      
      // Спочатку спробуємо отримати повну історію через ManyChat API
      const apiResponse = await fetch(`/api/admin/direct/manychat-conversation?instagramUsername=${encodeURIComponent(instagramUsername!)}`);
      const apiData = await apiResponse.json();
      
      // Зберігаємо діагностику
      if (apiData.diagnostics) {
        setDiagnostics(apiData.diagnostics);
      }
      
      // Якщо API Key не налаштовано, показуємо помилку
      if (!apiData.ok && apiData.error && apiData.error.includes('API Key not configured')) {
        // Не зупиняємось — пробуємо fallback по вебхуках, щоб UI працював локально без ключа.
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
        // Продовжуємо до fallback (вебхуки)
      }
      
      // Якщо API повернув помилку, але subscriber не знайдено
      if (!apiData.ok && apiData.error) {
        // Продовжуємо до fallback (вебхуки)
      }
      
      // Якщо API не повернув повідомлення, використовуємо БД (DirectMessage) або fallback на вебхуки
      const params = new URLSearchParams();
      if (client.id) params.set('clientId', client.id);
      if (instagramUsername) params.set('instagramUsername', instagramUsername);
      const response = await fetch(`/api/admin/direct/messages-history?${params.toString()}`);
      const data = await response.json();
      
      if (data.ok) {
        setMessages(data.messages || []);
        setError(null);
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MessagesHistoryModal.tsx:251',message:'Chat status history response received',data:{clientId:client.id,statusOk:sData?.ok,historyOk:hData?.ok,historyTotal:hData?.total,historyLogsCount:Array.isArray(hData?.logs)?hData.logs.length:0,historyError:hData?.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

      if (!sData?.ok) {
        setChatStatusError(sData?.error || 'Не вдалося завантажити статуси переписки');
        setChatStatuses([]);
      } else {
        setChatStatuses(Array.isArray(sData.statuses) ? sData.statuses : []);
      }

      if (!hData?.ok) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MessagesHistoryModal.tsx:262',message:'Chat history response not ok',data:{clientId:client.id,error:hData?.error,status:hData?.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        setChatHistory([]);
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MessagesHistoryModal.tsx:266',message:'Chat history set',data:{clientId:client.id,logsCount:Array.isArray(hData.logs)?hData.logs.length:0,firstLogId:Array.isArray(hData.logs)&&hData.logs.length>0?hData.logs[0].id:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        setChatHistory(Array.isArray(hData.logs) ? hData.logs : []);
      }
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MessagesHistoryModal.tsx:270',message:'Error loading chat panel',data:{clientId:client?.id,error:err instanceof Error ? err.message : String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
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
      if (name.length > NEW_STATUS_NAME_MAX_LEN) {
        setChatStatusError(`Занадто довга назва (макс. ${NEW_STATUS_NAME_MAX_LEN} символи)`);
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

  function startEditStatus(status: DirectChatStatus) {
    setCreateMode(false);
    setChatStatusError(null);
    setEditingStatusId(status.id);
    setEditStatusName((status.name || '').toString());
    setEditStatusBadgeKey(((status as any).badgeKey || 'badge_1').toString());
  }

  function cancelEditStatus() {
    setEditingStatusId(null);
    setEditStatusName('');
    setEditStatusBadgeKey('badge_1');
  }

  async function saveEditStatus() {
    if (!editingStatusId) return;
    try {
      const name = editStatusName.trim();
      if (!name) {
        setChatStatusError('Вкажіть назву статусу');
        return;
      }
      if (name.length > NEW_STATUS_NAME_MAX_LEN) {
        setChatStatusError(`Занадто довга назва (макс. ${NEW_STATUS_NAME_MAX_LEN} символи)`);
        return;
      }

      setChatStatusLoading(true);
      setChatStatusError(null);

      const res = await fetch(`/api/admin/direct/chat-statuses/${encodeURIComponent(editingStatusId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, badgeKey: editStatusBadgeKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        setChatStatusError(data?.error || 'Не вдалося зберегти зміни статусу');
        return;
      }

      cancelEditStatus();
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
      // Якщо статус реально змінився — API повертає client з anchor полями, оновимо локально,
      // щоб крапка зʼявилась одразу в чаті.
      const anchorId =
        data?.client?.chatStatusAnchorMessageId != null ? String(data.client.chatStatusAnchorMessageId) : null;
      const anchorSetAt =
        data?.client?.chatStatusAnchorSetAt != null ? String(data.client.chatStatusAnchorSetAt) : null;
      const anchorReceivedAt =
        data?.client?.chatStatusAnchorMessageReceivedAt != null
          ? String(data.client.chatStatusAnchorMessageReceivedAt)
          : null;
      if (data?.changed) {
        setStatusAnchorMessageId(anchorId);
        setStatusAnchorReceivedAt(anchorReceivedAt);
      }

      await loadChatPanel();
      const st = nextStatusId ? chatStatuses.find((s) => s.id === nextStatusId) : null;
      onChatStatusUpdated?.({
        clientId: client.id,
        chatStatusId: nextStatusId,
        chatStatusName: st?.name,
        chatStatusBadgeKey: (st as any)?.badgeKey,
        chatNeedsAttention: false,
        chatStatusAnchorMessageId: data?.changed ? anchorId : undefined,
        chatStatusAnchorMessageReceivedAt: data?.changed ? anchorReceivedAt : undefined,
        chatStatusAnchorSetAt: data?.changed ? anchorSetAt : undefined,
      });
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
            <div className="flex-1 min-w-0 overflow-y-auto pr-2 bg-white">
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
                <div className="p-2 sm:p-3 space-y-3">
                  {groupedMessages.map((g, gi) => {
                    const dayLabel = g.dayKey === 'unknown' ? '' : formatDayHeaderFromKey(g.dayKey);
                    return (
                      <div key={`${g.dayKey}-${gi}`} className="space-y-2">
                        {dayLabel ? (
                          <div className="flex justify-center py-1">
                            <span className="text-[12px] text-gray-500 bg-base-200 rounded-full px-3 py-1">
                              {dayLabel}
                            </span>
                          </div>
                        ) : null}
                        <div className="space-y-2">
                          {g.items.map((message, index) => {
                            const isOutgoing = message.direction === 'outgoing';
                            const timeHHMM = formatTimeHHMM(message.receivedAt);
                            const key = message.id || `${message.receivedAt}-${gi}-${index}`;
                            const isAnchor = Boolean(
                              statusAnchorMessageId &&
                                message.id &&
                                String(message.id) === String(statusAnchorMessageId)
                            );
                            const anchorMs = toMsSafe(statusAnchorReceivedAt);
                            const msgMs = toMsSafe(message.receivedAt);
                            const isAnchorByTime = Boolean(
                              !isAnchor && anchorMs != null && msgMs != null && Math.abs(msgMs - anchorMs) <= 2000
                            );
                            return (
                              <div key={key} className={`flex items-end gap-2 ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                                {!isOutgoing ? (
                                  <ChatAvatar40 username={client.instagramUsername || ''} />
                                ) : null}
                                <div
                                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                                    isOutgoing ? 'bg-blue-100 text-blue-900' : 'bg-gray-100 text-gray-900'
                                  } relative`}
                                  title={message.receivedAt ? formatDate(message.receivedAt) : ''}
                                >
                                  {isAnchor || isAnchorByTime ? (
                                    <span
                                      className="absolute -top-[4px] -right-[4px] w-[8px] h-[8px] rounded-full bg-red-600 border border-white"
                                      title="Статус встановлено на цьому повідомленні"
                                      aria-label="Статус встановлено на цьому повідомленні"
                                    />
                                  ) : null}
                                  <div>{message.text}</div>
                                  {timeHHMM ? (
                                    <div className="mt-1 flex justify-end">
                                      <span className="text-[10px] text-gray-500">{timeHHMM}</span>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
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
                    <span className="inline-block w-[8px] h-[8px] rounded-full bg-red-600 border border-white" />
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
                      maxLength={NEW_STATUS_NAME_MAX_LEN}
                      placeholder="Напр.: Консультація уточнити"
                    />
                    <div className="mt-1 text-[10px] text-gray-500">
                      Залишилось: {Math.max(0, NEW_STATUS_NAME_MAX_LEN - newStatusName.length)}
                    </div>
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
                    const isEditing = editingStatusId === s.id;
                    return (
                      <div key={s.id} className="flex items-stretch gap-1">
                        <button
                          className={`btn btn-xs justify-start flex-1 ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => void setClientChatStatus(s.id)}
                          disabled={chatStatusLoading || isEditing}
                          title={s.name}
                          type="button"
                        >
                          <ChatBadgeIcon badgeKey={(s as any).badgeKey} size={16} />
                          <span className="truncate">{s.name}</span>
                        </button>
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => startEditStatus(s)}
                          disabled={chatStatusLoading}
                          title="Редагувати статус"
                          type="button"
                        >
                          ✎
                        </button>
                      </div>
                    );
                  })}
                  {chatStatuses.length === 0 && !chatStatusLoading ? (
                    <div className="text-xs text-gray-400">Немає статусів (створіть перший)</div>
                  ) : null}
                </div>
              </div>

              {editingStatusId ? (
                <div className="mb-4 p-3 rounded border bg-base-100">
                  <div className="text-xs font-semibold mb-2">Редагування статусу</div>
                  <label className="form-control w-full mb-2">
                    <div className="label py-0">
                      <span className="label-text text-xs">Назва</span>
                    </div>
                    <input
                      className="input input-xs input-bordered w-full"
                      value={editStatusName}
                      onChange={(e) => setEditStatusName(e.target.value)}
                      maxLength={NEW_STATUS_NAME_MAX_LEN}
                      placeholder="Назва статусу"
                    />
                    <div className="mt-1 text-[10px] text-gray-500">
                      Залишилось: {Math.max(0, NEW_STATUS_NAME_MAX_LEN - editStatusName.length)}
                    </div>
                  </label>
                  <div className="mb-2">
                    <div className="text-xs mb-1">Бейдж</div>
                    <div className="grid grid-cols-5 gap-2">
                      {CHAT_BADGE_KEYS.map((k) => {
                        const isSelected = editStatusBadgeKey === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            className={`btn btn-xs ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setEditStatusBadgeKey(k)}
                            title={`Обрати ${k}`}
                          >
                            <ChatBadgeIcon badgeKey={k} size={16} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-xs btn-primary" onClick={saveEditStatus} disabled={chatStatusLoading}>
                      Зберегти
                    </button>
                    <button className="btn btn-xs" onClick={cancelEditStatus} disabled={chatStatusLoading}>
                      Скасувати
                    </button>
                  </div>
                </div>
              ) : null}

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
                            <span className="opacity-70">{toName}</span> → <span className="font-semibold">{fromName}</span>
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
