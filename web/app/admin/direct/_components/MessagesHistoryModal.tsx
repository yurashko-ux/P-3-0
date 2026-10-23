// web/app/admin/direct/_components/MessagesHistoryModal.tsx
// Модальне вікно для відображення історії повідомлень ManyChat для клієнта

'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { DirectChatStatus, DirectClient, DirectClientChatStatusLog } from '@/lib/direct-types';
import type { DirectChatChannel } from '@/lib/direct-channel-chat';
import { CHANNEL_CHAT_STATUS_FIELDS } from '@/lib/direct-channel-chat';
import { kyivDayFromISO } from '@/lib/altegio/records-grouping';
import { ChatBadgeIcon, CHAT_BADGE_KEYS } from './ChatBadgeIcon';
import { hasNormalInstagramUsername } from '@/lib/altegio/client-utils';
import { resolveDisplayInstagramUsername } from '@/lib/direct-message-handle';
import { ClientSpendLoyaltyBadge } from '@/app/admin/_components/ClientNameWithLoyalty';
import { resolveInstagramReactionEmoji } from '@/lib/instagram-webhook';
import { LeadBadgeIcon } from './DirectClientTableRowBadges';
import { getFullName } from './direct-client-table-formatters';

interface MessageMedia {
  id: string;
  kind: string;
  mime: string;
  byteSize: number;
}

interface Message {
  receivedAt: string;
  text: string;
  fullName?: string;
  username?: string;
  direction?: 'incoming' | 'outgoing';
  id?: string;
  /** Instagram mid (для привʼязки реакцій). */
  messageId?: string | null;
  type?: string;
  source?: string;
  rawData?: string | null;
  messageKind?: 'system' | 'manual';
  media?: MessageMedia[];
  /** Емодзі реакції на це повідомлення (після злиття з instagram_reaction). */
  reactionEmoji?: string | null;
}

interface MessagesHistoryModalProps {
  client: DirectClient | null;
  isOpen: boolean;
  onClose: () => void;
  /** Канал переписки: instagram (за замовч.) або telegram */
  channel?: DirectChatChannel;
  /** У Переписках: лід → синій кружечок, клієнт → бейдж витрат. */
  contactKind?: 'client' | 'lead';
  /** Після завантаження історії — щоб Переписки одразу підтягнули порядок (вихідні салону). */
  onHistoryLoaded?: (info: {
    clientId: string;
    lastMessageAt: string | null;
    newestDirection?: string | null;
  }) => void;
  onChatStatusUpdated?: (update: {
    clientId: string;
    chatStatusId: string | null;
    chatStatusName?: string;
    chatStatusBadgeKey?: string;
    chatNeedsAttention?: boolean;
    chatStatusAnchorMessageId?: string | null;
    chatStatusAnchorMessageReceivedAt?: string | null;
    chatStatusAnchorSetAt?: string | null;
    lastActivityAt?: string;
    lastActivityKeys?: string[];
  }) => void;
}

function parseReactionRaw(rawData: string | null | undefined): {
  kind?: string;
  action?: string;
  emoji?: string | null;
  reaction?: string | null;
  reactedMessageId?: string;
} | null {
  if (!rawData) return null;
  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      kind: typeof parsed.kind === 'string' ? parsed.kind : undefined,
      action: typeof parsed.action === 'string' ? parsed.action : undefined,
      emoji: typeof parsed.emoji === 'string' ? parsed.emoji : null,
      reaction: typeof parsed.reaction === 'string' ? parsed.reaction : null,
      reactedMessageId:
        typeof parsed.reactedMessageId === 'string' ? parsed.reactedMessageId : undefined,
    };
  } catch {
    return null;
  }
}

/** Реакції Meta мають mid повідомлення — чіпляємо емодзі до бульбашки, окремі рядки ховаємо. */
function mergeReactionsOntoMessages(list: Message[]): Message[] {
  const emojiByMid = new Map<string, string | null>();
  const chrono = [...list].sort(
    (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
  );
  for (const row of chrono) {
    const isReaction =
      String(row.source || '').toLowerCase() === 'instagram_reaction' ||
      parseReactionRaw(row.rawData)?.kind === 'reaction';
    if (!isReaction) continue;
    const raw = parseReactionRaw(row.rawData);
    const mid = (raw?.reactedMessageId || '').trim();
    if (!mid) continue;
    if (raw?.action === 'unreact') {
      emojiByMid.set(mid, null);
      continue;
    }
    emojiByMid.set(mid, resolveInstagramReactionEmoji(raw?.emoji, raw?.reaction));
  }

  return list
    .filter((row) => {
      const isReaction =
        String(row.source || '').toLowerCase() === 'instagram_reaction' ||
        parseReactionRaw(row.rawData)?.kind === 'reaction';
      return !isReaction;
    })
    .map((row) => {
      const mid = (row.messageId || '').trim();
      const emoji = mid ? emojiByMid.get(mid) : undefined;
      return {
        ...row,
        reactionEmoji: emoji || null,
      };
    });
}

function MessageMediaView({ files }: { files?: MessageMedia[] }) {
  if (!files?.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {files.map((file) => {
        const src = `/api/admin/direct/message-media?id=${encodeURIComponent(file.id)}`;
        if (file.kind === "image") {
          return (
            <a key={file.id} href={src} target="_blank" rel="noreferrer">
              <img src={src} alt="Фото з Direct" className="max-h-64 max-w-full rounded-lg object-contain" />
            </a>
          );
        }
        if (file.kind === "audio") {
          return <audio key={file.id} controls preload="metadata" src={src} className="w-full min-w-[220px]" />;
        }
        if (file.kind === "video") {
          return <video key={file.id} controls preload="metadata" src={src} className="max-h-64 max-w-full rounded-lg" />;
        }
        return (
          <a key={file.id} href={src} className="underline" target="_blank" rel="noreferrer">
            Відкрити файл
          </a>
        );
      })}
    </div>
  );
}

export function MessagesHistoryModal({
  client,
  isOpen,
  onClose,
  channel = 'instagram',
  contactKind = 'client',
  onHistoryLoaded,
  onChatStatusUpdated,
}: MessagesHistoryModalProps) {
  const statusFields = CHANNEL_CHAT_STATUS_FIELDS[channel];
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [telegramStats, setTelegramStats] = useState<{
    total: number;
    incoming: number;
    outgoing: number;
  } | null>(null);

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
  const editStatusFormRef = useRef<HTMLDivElement>(null);
  const historyLoadSeq = useRef(0);

  // Прокрутити до форми редагування статусу, щоб вона була видима після натискання олівця
  useEffect(() => {
    if (editingStatusId) {
      editStatusFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [editingStatusId]);

  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState<boolean>(false);
  const [statusAnchorMessageId, setStatusAnchorMessageId] = useState<string | null>(null);
  const [statusAnchorReceivedAt, setStatusAnchorReceivedAt] = useState<string | null>(null);
  /** Реальний IG з переписки / після recover (не __no_ig__) */
  const [displayIg, setDisplayIg] = useState<string | null>(null);

  const NEW_STATUS_NAME_MAX_LEN = 24;

  /** День групи — завжди Europe/Kyiv (не локаль браузера). */
  function dayKeyFromDateString(dateString: string): string {
    try {
      return kyivDayFromISO(dateString) || '';
    } catch {
      return '';
    }
  }

  function formatDayHeaderFromKey(dayKey: string): string {
    try {
      const [y, m, d] = dayKey.split('-').map((x) => Number(x));
      if (!y || !m || !d) return dayKey;
      // Полудень UTC, щоб Intl з timeZone=Kyiv не зсунув календарний день.
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const todayKyiv = kyivDayFromISO(new Date().toISOString());
      const sameYear = todayKyiv ? todayKyiv.slice(0, 4) === String(y) : true;
      return new Intl.DateTimeFormat('uk-UA', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Kyiv',
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
      return dt.toLocaleTimeString('uk-UA', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Kyiv',
      });
    } catch {
      return '';
    }
  }

  function messagesNewestFirst(list: Message[]): Message[] {
    return [...list].sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
  }

  const displayMessages = useMemo(
    () => mergeReactionsOntoMessages(Array.isArray(messages) ? messages : []),
    [messages],
  );

  const groupedMessages = useMemo(() => {
    const arr = displayMessages;
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
  }, [displayMessages]);

  function toMsSafe(dateString: string | null | undefined): number | null {
    try {
      if (!dateString) return null;
      const ms = new Date(String(dateString)).getTime();
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }

  function ChatAvatar40({ username, clientId }: { username: string; clientId?: string }) {
    const u = (username || '').toString().trim();
    const isNormalInstagram = hasNormalInstagramUsername(u);
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    if (isNormalInstagram) {
      params.set('username', u);
      params.set('fetch', '1');
    }
    // Без нормального IG не форсуємо findByName — інакше чужі аватарки по імені
    const avatarSrc =
      clientId || isNormalInstagram
        ? `/api/admin/direct/instagram-avatar?${params.toString()}`
        : null;

    return (
      <span className="w-10 h-10 rounded-full bg-base-200 overflow-hidden border border-base-300 shrink-0">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt=""
            className="w-10 h-10 object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
      </span>
    );
  }

  useEffect(() => {
    if (isOpen && client) {
      setDisplayIg(
        hasNormalInstagramUsername(client.instagramUsername) ? client.instagramUsername! : null,
      );
      void loadMessages();
      void loadChatPanel();
    } else if (!isOpen) {
      setTelegramStats(null);
      setMessages([]);
      setDisplayIg(null);
    }
  }, [isOpen, client?.id, channel]);

  useEffect(() => {
    if (!client) return;
    const c = client as Record<string, unknown>;
    setSelectedStatusId((c[statusFields.statusId] as string | null) || null);
    setNeedsAttention(
      Boolean(channel === 'telegram' ? (c as { telegramChatNeedsAttention?: boolean }).telegramChatNeedsAttention : (c as { chatNeedsAttention?: boolean }).chatNeedsAttention)
    );
    setStatusAnchorMessageId((c[statusFields.anchorMessageId] as string | null) || null);
    setStatusAnchorReceivedAt((c[statusFields.anchorMessageReceivedAt] as string | null) || null);
  }, [client?.id, channel, statusFields.statusId, statusFields.anchorMessageId, statusFields.anchorMessageReceivedAt]);

  async function loadMessages() {
    if (!client) return;
    const seq = ++historyLoadSeq.current;
    
    try {
      setLoading(true);
      setError(null);
      
      const storedIg = (client.instagramUsername || '').toString();
      let effectiveIg = hasNormalInstagramUsername(storedIg) ? storedIg : '';

      if (channel === 'telegram') {
        setMessages([]);
        setTelegramStats(null);
        const response = await fetch(
          `/api/admin/direct/clients/${encodeURIComponent(client.id)}/telegram-messages?limit=200&_=${Date.now()}`,
          { credentials: 'include', cache: 'no-store' }
        );
        const data = await response.json().catch(() => ({}));
        if (data.ok) {
          const list = Array.isArray(data.messages) ? data.messages : [];
          const normalized = list.map((m: Message) => ({
            ...m,
            direction:
              String(m.direction || '').toLowerCase() === 'outgoing' ? 'outgoing' : 'incoming',
          })) as Message[];
          setMessages(normalized);
          setTelegramStats({
            total: typeof data.total === 'number' ? data.total : normalized.length,
            incoming:
              typeof data.incomingCount === 'number'
                ? data.incomingCount
                : normalized.filter((m) => m.direction === 'incoming').length,
            outgoing:
              typeof data.outgoingCount === 'number'
                ? data.outgoingCount
                : normalized.filter((m) => m.direction === 'outgoing').length,
          });
          setError(null);
        } else {
          setError(data.error || `Помилка завантаження Telegram (HTTP ${response.status})`);
        }
        return;
      }

      // 1) Завжди спочатку БД по clientId — надійніше за ManyChat і працює з __no_ig__
      const dbParams = new URLSearchParams();
      dbParams.set('clientId', client.id);
      dbParams.set('channel', 'instagram');
      dbParams.set('_', String(Date.now()));
      const dbRes = await fetch(`/api/admin/direct/messages-history?${dbParams.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (seq !== historyLoadSeq.current) return;
      const dbData = await dbRes.json().catch(() => ({}));
      let dbMessages: Message[] = Array.isArray(dbData.messages) ? dbData.messages : [];
      if (!dbRes.ok || dbData.ok === false) {
        setError(typeof dbData.error === 'string' ? dbData.error : 'Не вдалося завантажити історію');
        return;
      }
      dbMessages = messagesNewestFirst(dbMessages);
      if (dbMessages.length > 0) {
        setMessages(dbMessages);
        setError(null);
        // Реакції теж піднімають картку і (якщо вихідні) закривають «очікує».
        onHistoryLoaded?.({
          clientId: client.id,
          lastMessageAt: dbMessages[0]?.receivedAt || null,
          newestDirection: dbMessages[0]?.direction || null,
        });
      }

      // 2) Recover реального IG (паралельно з відображенням історії)
      if (!effectiveIg && client.id) {
        try {
          const recoverRes = await fetch(
            `/api/admin/direct/clients/${encodeURIComponent(client.id)}?includeMessageInstagram=1&recoverInstagram=1`,
            { credentials: 'include', cache: 'no-store' },
          );
          const recoverJson = await recoverRes.json().catch(() => ({}));
          const recovered =
            (typeof recoverJson.displayInstagramUsername === 'string' &&
              recoverJson.displayInstagramUsername.trim()) ||
            (typeof recoverJson.instagramFromMessages === 'string' &&
              recoverJson.instagramFromMessages.trim()) ||
            (typeof recoverJson.client?.instagramUsername === 'string' &&
              recoverJson.client.instagramUsername.trim()) ||
            '';
          if (hasNormalInstagramUsername(recovered)) {
            effectiveIg = recovered;
            setDisplayIg(recovered);
            if (recoverJson.client?.instagramUsername) {
              client.instagramUsername = recoverJson.client.instagramUsername;
            }
          }
        } catch (recoverErr) {
          console.warn('[MessagesHistoryModal] recover Instagram:', recoverErr);
        }
      } else if (effectiveIg) {
        setDisplayIg(effectiveIg);
      }

      // 3) Якщо БД порожня — пробуємо ManyChat (лише з реальним ніком)
      if (dbMessages.length === 0 && hasNormalInstagramUsername(effectiveIg)) {
        const apiResponse = await fetch(
          `/api/admin/direct/manychat-conversation?instagramUsername=${encodeURIComponent(effectiveIg)}`,
        );
        const apiData = await apiResponse.json().catch(() => ({}));
        if (seq !== historyLoadSeq.current) return;
        if (apiData.diagnostics) setDiagnostics(apiData.diagnostics);
        if (apiData.ok && Array.isArray(apiData.messages) && apiData.messages.length > 0) {
          const convertedMessages: Message[] = messagesNewestFirst(apiData.messages.map((msg: any) => ({
            receivedAt: msg.timestamp || new Date().toISOString(),
            text: msg.text || '-',
            direction: msg.direction,
            id: msg.id,
            type: msg.type,
          })));
          setMessages(convertedMessages);
          setError(null);
          return;
        }
        // Ще раз БД з ніком (KV fallback)
        const params = new URLSearchParams();
        params.set('clientId', client.id);
        params.set('instagramUsername', effectiveIg);
        params.set('channel', 'instagram');
        params.set('_', String(Date.now()));
        const response = await fetch(`/api/admin/direct/messages-history?${params.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (seq !== historyLoadSeq.current) return;
        if (data.ok) {
          setMessages(messagesNewestFirst(data.messages || []));
          setError(null);
        } else if (dbMessages.length === 0) {
          setError(data.error || 'Помилка завантаження повідомлень');
        }
        return;
      }

      if (dbMessages.length === 0 && !dbData.ok) {
        setError(dbData.error || 'Помилка завантаження повідомлень');
      }
    } catch (err) {
      if (seq === historyLoadSeq.current) {
        setError(err instanceof Error ? err.message : 'Помилка завантаження повідомлень');
      }
    } finally {
      if (seq === historyLoadSeq.current) setLoading(false);
    }
  }

  async function loadChatPanel() {
    if (!client?.id) return;
    try {
      setChatStatusLoading(true);
      setChatStatusError(null);

      const [sRes, hRes] = await Promise.all([
        fetch('/api/admin/direct/chat-statuses', { credentials: 'include' }),
        fetch(
          `/api/admin/direct/clients/${encodeURIComponent(client.id)}/chat-status-history?limit=50&channel=${encodeURIComponent(channel)}`,
          { credentials: 'include' }
        ),
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
        credentials: 'include',
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
        credentials: 'include',
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
        body: JSON.stringify({ statusId: nextStatusId, channel }),
        credentials: 'include',
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
      const cl = data?.client as Record<string, unknown> | undefined;
      const anchorId =
        cl?.[statusFields.anchorMessageId] != null ? String(cl[statusFields.anchorMessageId]) : null;
      const anchorSetAt =
        cl?.[statusFields.anchorSetAt] != null ? String(cl[statusFields.anchorSetAt]) : null;
      const anchorReceivedAt =
        cl?.[statusFields.anchorMessageReceivedAt] != null
          ? String(cl[statusFields.anchorMessageReceivedAt])
          : null;
      if (data?.changed) {
        setStatusAnchorMessageId(anchorId);
        setStatusAnchorReceivedAt(anchorReceivedAt);
      }

      await loadChatPanel();
      const st = nextStatusId ? chatStatuses.find((s) => s.id === nextStatusId) : null;
      const updatedClient = data?.client;
      onChatStatusUpdated?.({
        clientId: client.id,
        chatStatusId: nextStatusId,
        chatStatusName: st?.name,
        chatStatusBadgeKey: (st as any)?.badgeKey,
        chatNeedsAttention: false,
        chatStatusAnchorMessageId: data?.changed ? anchorId : undefined,
        chatStatusAnchorMessageReceivedAt: data?.changed ? anchorReceivedAt : undefined,
        chatStatusAnchorSetAt: data?.changed ? anchorSetAt : undefined,
        ...(data?.changed && updatedClient && {
          lastActivityAt: updatedClient.lastActivityAt,
          lastActivityKeys: updatedClient.lastActivityKeys,
        }),
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

  const fullName = getFullName(client);
  const clientName =
    fullName && fullName !== '-'
      ? fullName
      : client.firstName || client.lastName || client.instagramUsername || 'Невідомий клієнт';

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
              <h3 className="font-bold text-lg">
                {channel === 'telegram' ? 'Telegram — історія' : 'Instagram — історія'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                {(() => {
                  const ig = resolveDisplayInstagramUsername(
                    displayIg || client.instagramUsername,
                    displayIg,
                  );
                  const igHandle = String(ig || '').replace(/^@/, '');
                  const igOk = hasNormalInstagramUsername(igHandle);
                  const badge =
                    contactKind === 'lead' ? (
                      <LeadBadgeIcon size={16} />
                    ) : (
                      <ClientSpendLoyaltyBadge spent={client.spent} size="sm" />
                    );
                  const badgeNode = igOk ? (
                    <a
                      href={`https://instagram.com/${encodeURIComponent(igHandle)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 hover:opacity-80"
                      title={`Відкрити @${igHandle} в Instagram`}
                    >
                      {badge}
                    </a>
                  ) : (
                    <span className="inline-flex shrink-0">{badge}</span>
                  );
                  return (
                    <span className="inline-flex items-center gap-1.5">
                      {badgeNode}
                      <span>
                        {clientName}
                        {contactKind === 'client' && client.visits != null ? (
                          <span className="opacity-80">{` (${client.visits})`}</span>
                        ) : null}
                        {igOk ? <span>{` (@${igHandle})`}</span> : null}
                      </span>
                    </span>
                  );
                })()}
              </p>
              {channel === 'telegram' && telegramStats ? (
                <p className="text-xs text-gray-500 mt-1">
                  У чаті: {telegramStats.total} (вхідні {telegramStats.incoming}, вихідні {telegramStats.outgoing}).
                  Лічильник у таблиці — лише відповіді клієнта після join кампанії.
                </p>
              ) : null}
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
              ) : displayMessages.length === 0 ? (
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
                    {channel === 'telegram'
                      ? `У базі для цього клієнта (id: ${client.id.slice(0, 8)}…) поки 0 записів Telegram. Якщо лічильник у таблиці > 0 — натисніть «Оновити»; якщо не допоможе, перевірте діагностику webhook.`
                      : 'Повідомлення зберігаються тільки коли клієнт пише в ManyChat'}
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
                            const isOutgoing =
                              String(message.direction || '').toLowerCase() === 'outgoing';
                            const isSystemOutgoing =
                              isOutgoing &&
                              (message.messageKind === 'system' || message.source === 'telegram_campaign');
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
                            const reactionEmoji = (message.reactionEmoji || '').trim();
                            return (
                              <div key={key} className={`flex items-end gap-2 ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                                {!isOutgoing ? (
                                  <ChatAvatar40
                                    username={displayIg || client.instagramUsername || ''}
                                    clientId={client.id}
                                  />
                                ) : null}
                                <div
                                  className={`relative max-w-[80%] mb-2 rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                                    isOutgoing
                                      ? isSystemOutgoing
                                        ? 'bg-sky-100 text-sky-900'
                                        : 'bg-lime-100 text-lime-900'
                                      : 'bg-gray-100 text-gray-900'
                                  }`}
                                  title={message.receivedAt ? formatDate(message.receivedAt) : ''}
                                >
                                  {isAnchor || isAnchorByTime ? (
                                    <span
                                      className="absolute -top-[4px] -right-[4px] w-[8px] h-[8px] rounded-full bg-red-600 border border-white"
                                      title="Статус встановлено на цьому повідомленні"
                                      aria-label="Статус встановлено на цьому повідомленні"
                                    />
                                  ) : null}
                                  {isOutgoing ? (
                                    <div
                                      className={`text-[10px] font-medium mb-0.5 ${
                                        isSystemOutgoing ? 'text-sky-700/80' : 'text-lime-700/80'
                                      }`}
                                    >
                                      {isSystemOutgoing ? 'Система' : 'Салон'}
                                    </div>
                                  ) : null}
                                  <div>{message.text}</div>
                                  <MessageMediaView files={message.media} />
                                  {timeHHMM ? (
                                    <div className="mt-1 flex justify-end">
                                      <span className="text-[10px] text-gray-500">{timeHHMM}</span>
                                    </div>
                                  ) : null}
                                  {reactionEmoji ? (
                                    <span
                                      className={`absolute -bottom-2 z-10 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border border-base-300 bg-base-100 px-1 text-[13px] leading-none shadow-sm ${
                                        isOutgoing ? 'left-1' : 'right-1'
                                      }`}
                                      title="Реакція Instagram"
                                      aria-label={`Реакція ${reactionEmoji}`}
                                    >
                                      {reactionEmoji}
                                    </span>
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
                <div ref={editStatusFormRef} className="mb-4 p-3 rounded border bg-base-100">
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
