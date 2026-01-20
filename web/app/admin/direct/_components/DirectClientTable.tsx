// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect, useMemo } from "react";
import type { SyntheticEvent } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";
import { StateHistoryModal } from "./StateHistoryModal";
import { MessagesHistoryModal } from "./MessagesHistoryModal";
import { ClientWebhooksModal } from "./ClientWebhooksModal";
import { RecordHistoryModal } from "./RecordHistoryModal";
import { MasterHistoryModal } from "./MasterHistoryModal";
import { getChatBadgeStyle } from "./ChatBadgeIcon";

// Компонент для відображення піктограми стану
function StateIcon({ state, size = 36 }: { state: string | null; size?: number }) {
  const iconStyle = { width: `${size}px`, height: `${size}px` };
  
  if (state === 'client') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
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
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#2563eb" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M12 18 L13.5 19.5 L16 17" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'message') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  } else if (state === 'consultation-booked') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#2563eb" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M12 18 L13.5 19.5 L16 17" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'consultation-no-show') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#ef4444" stroke="#dc2626" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#dc2626" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#dc2626" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M11 18 L17 18" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );
  } else if (state === 'consultation-rescheduled') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
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
        className="object-contain"
        style={iconStyle}
      />
    );
  } else if (state === 'other-services') {
    return (
      <span
        title="Інші послуги"
        className="inline-flex items-center justify-center"
        style={{
          ...iconStyle,
          fontSize: `${Math.round(size * 0.72)}px`,
          transform: 'rotate(180deg)', // леза вгору
        }}
      >
        ✂️
      </span>
    );
  } else if (state === 'all-good') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <circle cx="14" cy="14" r="12" fill="#10b981" stroke="#059669" strokeWidth="1.5"/>
        <path d="M8 14 L12 18 L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  } else if (state === 'too-expensive') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
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
        className="object-contain"
        style={iconStyle}
      />
    );
  }
}

// Компактні бейджі для типу контакту в колонці “Повне імʼя”
function LeadBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      {/* Лід = нейтральна “крапка” (синій як календарик у станах) */}
      <circle cx="10" cy="10" r="7.2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.2" />
    </svg>
  );
}

function ClientBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      {/* Клієнт = “профіль” */}
      <circle cx="10" cy="10" r="7.6" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.2" />
      <circle cx="10" cy="8.2" r="2.2" fill="#111827" opacity="0.85" />
      <path
        d="M5.9 14.85c1.22-2.1 2.84-3.05 4.1-3.05s2.88.95 4.1 3.05"
        stroke="#111827"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

function AvatarSlot({
  avatarSrc,
  onError,
  onLoad,
}: {
  avatarSrc: string | null;
  onError: (e: SyntheticEvent<HTMLImageElement, Event>) => void;
  onLoad?: () => void;
}) {
  // Завжди рендеримо однаковий слот, щоб рядки вирівнювались.
  // Якщо аватарки нема — лишається пустий кружок.
  return (
    <div className="w-10 h-10 rounded-full shrink-0 border border-slate-200 bg-slate-50 overflow-hidden">
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

type DirectClientTableProps = {
  clients: DirectClient[];
  statuses: DirectStatus[];
  filters: {
    statusId: string;
    masterId: string;
    source: string;
    search: string;
    hasAppointment: string;
  };
  onFiltersChange: (filters: DirectClientTableProps["filters"]) => void;
  onSearchClick?: () => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (by: string, order: "asc" | "desc") => void;
  onClientUpdate: (clientId: string, updates: Partial<DirectClient>) => Promise<void>;
  onRefresh: () => Promise<void>;
};

export function DirectClientTable({
  clients,
  statuses,
  filters,
  onFiltersChange,
  onSearchClick,
  sortBy,
  sortOrder,
  onSortChange,
  onClientUpdate,
  onRefresh,
}: DirectClientTableProps) {
  // #region agent log
  // DEBUG: діагностика аватарок через локальний ndjson ingest (пише у .cursor/debug.log)
  // Не логувати секрети/PII. Username не пишемо у логи — тільки хеш + технічні статуси.
  const __avatarDebugSentRef =
    (globalThis as any).__directAvatarDebugSentRef ||
    ((globalThis as any).__directAvatarDebugSentRef = new Set<string>());

  function __hashUsername(raw: string): string {
    const s = (raw || '').toString();
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return `u_${(h >>> 0).toString(16)}`;
  }

  function __redactAvatarSrc(raw: string): string {
    try {
      const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://p-3-0.vercel.app');
      if (u.searchParams.has('username')) u.searchParams.set('username', '<redacted>');
      return u.toString().slice(0, 220);
    } catch {
      return (raw || '').toString().slice(0, 220);
    }
  }

  function __pickAvatarDebugSummary(debugJson: any) {
    const d = debugJson && typeof debugJson === 'object' ? debugJson : null;
    const kv = d?.debug?.kv || d?.kv || null;
    const manychat = d?.debug?.manychat || d?.manychat || null;
    const subscriber = d?.debug?.subscriber || d?.subscriber || null;
    return {
      ok: d?.ok,
      error: typeof d?.error === 'string' ? d.error : undefined,
      // KV
      avatarHit: kv?.avatarHit ?? kv?.avatarHit === false ? kv.avatarHit : undefined,
      // subscriber resolution
      subscriberFromKvPresent: subscriber?.fromKv != null,
      subscriberFromLogsPresent: subscriber?.fromLogs != null,
      scannedLogs: typeof subscriber?.scannedLogs === 'number' ? subscriber.scannedLogs : undefined,
      // ManyChat call status (без PII)
      manychatGetInfoStatus: typeof manychat?.getInfo?.status === 'number' ? manychat.getInfo.status : undefined,
      manychatGetInfoOk: typeof manychat?.getInfo?.ok === 'boolean' ? manychat.getInfo.ok : undefined,
    };
  }

  async function __logAvatarDebug(args: { runId: string; username: string; avatarSrc: string }) {
    try {
      const { runId, username, avatarSrc } = args;
      const usernameHash = __hashUsername(username);
      const key = `${runId}:${usernameHash}`;
      if (__avatarDebugSentRef.has(key)) return;
      __avatarDebugSentRef.add(key);

      const hasAdminToken = typeof document !== 'undefined' ? document.cookie.includes('admin_token=') : false;

      let debugJson: any = null;
      let status: number | null = null;
      try {
        const res = await fetch(`${avatarSrc}&debug=1&scan=1000`, { method: 'GET', credentials: 'include' });
        status = res.status;
        debugJson = await res.json().catch(() => null);
      } catch (e) {
        debugJson = { fetchError: String(e) };
      }

      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId,
          hypothesisId: 'H1|H2|H3|H4',
          location: 'DirectClientTable.tsx:__logAvatarDebug',
          message: 'Avatar debug snapshot (sanitized)',
          data: {
            usernameHash,
            hasAdminToken,
            avatarSrc: __redactAvatarSrc(avatarSrc),
            status,
            debug: __pickAvatarDebugSummary(debugJson),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {
      // ignore
    }
  }
  // #endregion agent log

  const [editingClient, setEditingClient] = useState<DirectClient | null>(null);
  const [masters, setMasters] = useState<Array<{ id: string; name: string }>>([]);
  const [stateHistoryClient, setStateHistoryClient] = useState<DirectClient | null>(null);
  const [messagesHistoryClient, setMessagesHistoryClient] = useState<DirectClient | null>(null);
  const [webhooksClient, setWebhooksClient] = useState<DirectClient | null>(null);
  const [recordHistoryClient, setRecordHistoryClient] = useState<DirectClient | null>(null);
  const [recordHistoryType, setRecordHistoryType] = useState<'paid' | 'consultation'>('paid');
  const [masterHistoryClient, setMasterHistoryClient] = useState<DirectClient | null>(null);
  // Локальні оверрайди для UI переписки, щоб не перезавантажувати всю таблицю після зміни статусу
  const [chatUiOverrides, setChatUiOverrides] = useState<Record<string, Partial<DirectClient>>>({});
  const [searchInput, setSearchInput] = useState<string>(filters.search);
  const [isStatsExpanded, setIsStatsExpanded] = useState<boolean>(false);

  const altegioClientsBaseUrl =
    "https://app.alteg.io/clients/1169323/base/?fields%5B0%5D=name&fields%5B1%5D=phone&fields%5B2%5D=email&fields%5B3%5D=sold_amount&fields%5B4%5D=visits_count&fields%5B5%5D=discount&fields%5B6%5D=last_visit_date&fields%5B7%5D=first_visit_date&order_by=id&order_by_direction=desc&page=1&page_size=25&segment=&operation=AND&filters%5B0%5D%5Boperation%5D=OR&filters%5B0%5D%5Bfilters%5D%5B0%5D%5Boperation%5D=AND&filters%5B0%5D%5Bfilters%5D%5B0%5D%5Bfilters%5D%5B0%5D%5Boperation%5D=AND&filters%5B1%5D%5Btype%5D=quick_search&filters%5B1%5D%5Bstate%5D%5Bvalue%5D=";

  const buildAltegioClientsSearchUrl = (query: string) => {
    const q = (query || "").toString().trim();
    return `${altegioClientsBaseUrl}${encodeURIComponent(q)}`;
  };

  // Місячний фільтр KPI (calendar month, Europe/Kyiv): YYYY-MM
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    try {
      const kyivDay = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const m = kyivDay.slice(0, 7);
      // Мінімальний доступний місяць: 2026-01
      return m < '2026-01' ? '2026-01' : m;
    } catch {
      const m = new Date().toISOString().slice(0, 7);
      return m < '2026-01' ? '2026-01' : m;
    }
  });

  type MastersStatsRow = {
    masterId: string;
    masterName: string;
    role: string;
    clients: number;
    consultBooked: number;
    consultAttended: number;
    paidAttended: number;
    rebooksCreated: number;
    futureSum?: number;
    monthToEndSum?: number;
    nextMonthSum?: number;
    plus2MonthSum?: number;
  };
  const [mastersStats, setMastersStats] = useState<{
    loading: boolean;
    error: string | null;
    rows: MastersStatsRow[];
    totalClients: number;
  }>({ loading: false, error: null, rows: [], totalClients: 0 });

  const monthOptions = useMemo(() => {
    // Доступні місяці: від 2026-01 і далі (без 2024/2025).
    // Щоб можна було вибирати наперед (лютий, березень і т.д.), будуємо вперед на 24 місяці.
    const out: Array<{ value: string; label: string }> = [];
    const startYear = 2026;
    const startMonthIdx = 0; // Jan
    const start = new Date(startYear, startMonthIdx, 1);
    for (let i = 0; i < 24; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const value = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
      out.push({ value, label });
    }
    return out;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        setMastersStats((s) => ({ ...s, loading: true, error: null }));
        const params = new URLSearchParams();
        params.set('month', selectedMonth);
        // Підтримка майбутніх фільтрів (у таблиці вони вже існують)
        if (filters.statusId) params.set('statusId', filters.statusId);
        if (filters.masterId) params.set('masterId', filters.masterId);
        if (filters.source) params.set('source', filters.source);
        if (filters.search) params.set('search', filters.search);
        if (filters.hasAppointment) params.set('hasAppointment', filters.hasAppointment);

        const res = await fetch(`/api/admin/direct/masters-stats?${params.toString()}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || 'Не вдалося завантажити статистику');
        if (cancelled) return;

        const mastersRows: MastersStatsRow[] = Array.isArray(data.masters) ? data.masters : [];
        const unassignedRow: MastersStatsRow | null = data.unassigned && typeof data.unassigned === 'object' ? data.unassigned : null;
        const rows = unassignedRow ? [...mastersRows, unassignedRow] : mastersRows;

        setMastersStats({
          loading: false,
          error: null,
          rows,
          totalClients: typeof data.totalClients === 'number' ? data.totalClients : 0,
        });
      } catch (err) {
        if (cancelled) return;
        setMastersStats((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth, filters.statusId, filters.masterId, filters.source, filters.search, filters.hasAppointment]);

  // Синхронізуємо searchInput з filters.search коли filters змінюється ззовні (наприклад, при скиданні)
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  // Завантажуємо відповідальних (майстрів)
  useEffect(() => {
    fetch("/api/admin/direct/masters?forSelection=true")
      .then((res) => {
        if (!res.ok) {
          console.warn(`[DirectClientTable] Failed to load masters: ${res.status} ${res.statusText}`);
          // Fallback на старий endpoint
          return fetch("/api/photo-reports/masters");
        }
        return res;
      })
      .then((res) => {
        if (!res) return null;
        return res.json();
      })
      .then((data) => {
        if (data && data.ok && data.masters) {
          setMasters(data.masters);
        } else {
          // Якщо endpoint не існує, використовуємо порожній масив
          setMasters([]);
        }
      })
      .catch((err) => {
        console.warn("[DirectClientTable] Failed to load masters (non-critical):", err);
        setMasters([]);
      });
  }, []);

  // НЕ завантажуємо історію станів для всіх клієнтів одразу - це створює зайве навантаження
  // Історія завантажується тільки при відкритті модального вікна (StateHistoryModal)
  // В таблиці показуємо тільки поточний стан клієнта

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  // Короткий формат дати для економії місця в колонці “Оновлення / Створення”: 11.11.26
  const formatDateShortYear = (dateStr?: string) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" });
    } catch {
      return dateStr;
    }
  };

  const formatUAHExact = (amountUAH: number): string => {
    const n = Math.round(amountUAH);
    return `${n.toLocaleString('uk-UA')} грн`;
  };

  // Формат як у колонці “Продажі”: округляємо до тисяч і показуємо “тис.”
  const formatUAHThousands = (amountUAH: number): string => {
    const n = Math.round(amountUAH);
    return `${Math.round(n / 1000).toLocaleString('uk-UA')} тис.`;
  };

  // Відображаємо тільки імʼя (перше слово), щоб таблиця була компактною
  const shortPersonName = (raw?: string | null): string => {
    const s = (raw || '').toString().trim();
    if (!s) return '';
    // Якщо раптом прийде "Імʼя Прізвище, Імʼя2 Прізвище2" — беремо першу персону
    const firstPerson = s.split(',')[0]?.trim() || s;
    // Перше слово = імʼя
    const firstWord = firstPerson.split(/\s+/)[0]?.trim();
    return firstWord || firstPerson;
  };

  const getStatusColor = (statusId: string) => {
    const status = statuses.find((s) => s.id === statusId);
    return status?.color || "#6b7280";
  };

  const getFullName = (client: DirectClient) => {
    const isBadNamePart = (v?: string) => {
      if (!v) return true;
      const t = v.trim();
      if (!t) return true;
      // Не показуємо плейсхолдери типу {{full_name}}
      if (t.includes("{{") || t.includes("}}")) return true;
      if (t.toLowerCase() === "not found") return true;
      return false;
    };
    const parts = [client.firstName, client.lastName].filter((p) => !isBadNamePart(p));
    return parts.length ? parts.join(" ") : "-";
  };

  const handleStatusChange = async (client: DirectClient, newStatusId: string) => {
    await onClientUpdate(client.id, { statusId: newStatusId });
  };

  const handleFieldUpdate = async (client: DirectClient, field: keyof DirectClient, value: any) => {
    await onClientUpdate(client.id, { [field]: value });
  };

  const clientsWithChatOverrides = useMemo(() => {
    if (!chatUiOverrides || Object.keys(chatUiOverrides).length === 0) return clients;
    return clients.map((c) => {
      const o = chatUiOverrides[c.id];
      return o ? ({ ...c, ...o } as DirectClient) : c;
    });
  }, [clients, chatUiOverrides]);

  // Унікалізуємо клієнтів за instagramUsername, щоб не було дублів
  // ПРИМІТКА: Об'єднання за altegioClientId відбувається на рівні бази даних через endpoint merge-duplicates-by-name
  const uniqueClients = useMemo(() => {
    const map = new Map<string, DirectClient>();

    const normalize = (username: string) => username.trim().toLowerCase();

    for (const client of clientsWithChatOverrides) {
      const key = normalize(client.instagramUsername);
      if (!map.has(key)) {
        map.set(key, client);
      }
    }

    return Array.from(map.values());
  }, [clientsWithChatOverrides]);

  // KPI-таблиця: робимо максимально компактно — ховаємо рядки, де всі значення = 0
  const compactStatsRows = useMemo(() => {
    const rows = mastersStats.rows || [];
    const nonZero = (r: MastersStatsRow) =>
      (r.clients || 0) > 0 ||
      (r.consultBooked || 0) > 0 ||
      (r.consultAttended || 0) > 0 ||
      (r.paidAttended || 0) > 0 ||
      (r.rebooksCreated || 0) > 0 ||
      (r.futureSum || 0) > 0 ||
      (r.monthToEndSum || 0) > 0 ||
      (r.nextMonthSum || 0) > 0 ||
      (r.plus2MonthSum || 0) > 0;
    const filtered = rows.filter((r) => nonZero(r) || r.masterId === 'unassigned');
    // Якщо все нуль — показуємо як є (щоб не було порожньо)
    return filtered.length ? filtered : rows;
  }, [mastersStats.rows]);

  const statsTotals = useMemo(() => {
    const rows = mastersStats.rows || [];
    // Підсумки по всіх рядках (включно "Без майстра"), щоб цифри сходились з загальним.
    return rows.reduce(
      (acc, r) => {
        acc.clients += r.clients || 0;
        acc.consultBooked += r.consultBooked || 0;
        acc.consultAttended += r.consultAttended || 0;
        acc.paidAttended += r.paidAttended || 0;
        acc.rebooksCreated += r.rebooksCreated || 0;
        acc.futureSum += r.futureSum || 0;
        acc.monthToEndSum += r.monthToEndSum || 0;
        acc.nextMonthSum += r.nextMonthSum || 0;
        acc.plus2MonthSum += r.plus2MonthSum || 0;
        return acc;
      },
      {
        clients: 0,
        consultBooked: 0,
        consultAttended: 0,
        paidAttended: 0,
        rebooksCreated: 0,
        futureSum: 0,
        monthToEndSum: 0,
        nextMonthSum: 0,
        plus2MonthSum: 0,
      }
    );
  }, [mastersStats.rows]);

  return (
    <div className="space-y-4">
      {/* Верхня панель KPI по майстрах (майстри/адмін/direct-менеджер) */}
      <div className="card bg-base-100 shadow-sm inline-block w-max max-w-full">
        <div className="card-body p-2 sm:p-3">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="inline-flex items-center gap-3 text-left w-max max-w-full flex-wrap"
              onClick={() => setIsStatsExpanded((v) => !v)}
              title="Натисніть, щоб згорнути/розгорнути статистику"
            >
              <div className="text-sm font-semibold whitespace-nowrap">
                Статистика <span className="ml-1 opacity-60">{isStatsExpanded ? "▲" : "▼"}</span>
              </div>

              <div className="text-[11px] opacity-70 whitespace-nowrap">
                {selectedMonth} • клієнтів: {mastersStats.totalClients}
              </div>

              {/* Місячний фільтр переносимо сюди (в центр/порожній простір) */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] opacity-70">Місяць</span>
                <select
                  className="select select-bordered select-xs"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </button>

            {mastersStats.loading ? (
              <div className="text-[11px] opacity-70">Завантаження...</div>
            ) : mastersStats.error ? (
              <div className="alert alert-warning">
                <span className="text-sm">Помилка статистики: {mastersStats.error}</span>
              </div>
            ) : !isStatsExpanded ? null : (
              <div className="overflow-x-auto max-w-full">
                {/* shrink-to-fit wrapper: щоб таблиця не виглядала розтягнутою на всю ширину */}
                <div className="inline-block w-max">
                  <table
                    className="table table-compact table-xs w-auto leading-tight border-collapse"
                    style={{ tableLayout: "auto" }}
                  >
                  <thead>
                    <tr>
                      <th className="text-[10px] py-0.5 px-1 whitespace-nowrap w-[120px] max-w-[120px] text-base-content">
                        Майстер
                      </th>
                      <th className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.clients}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>Кл</span>
                          <span className="text-[9px] opacity-60">{statsTotals.clients}</span>
                        </div>
                      </th>
                      <th className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[58px] text-base-content" title={`${statsTotals.consultBooked}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>Конс</span>
                          <span className="text-[9px] opacity-60">{statsTotals.consultBooked}</span>
                        </div>
                      </th>
                      <th className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.consultAttended}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>✅К</span>
                          <span className="text-[9px] opacity-60">{statsTotals.consultAttended}</span>
                        </div>
                      </th>
                      <th className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.paidAttended}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>✅З</span>
                          <span className="text-[9px] opacity-60">{statsTotals.paidAttended}</span>
                        </div>
                      </th>
                      <th className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[66px] text-base-content" title={`${statsTotals.rebooksCreated}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>🔁</span>
                          <span className="text-[9px] opacity-60">{statsTotals.rebooksCreated}</span>
                        </div>
                      </th>
                      <th
                        className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.futureSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Майб</span>
                          <span className="text-[9px] opacity-60">{statsTotals.futureSum > 0 ? formatUAHThousands(statsTotals.futureSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.monthToEndSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>До кін</span>
                          <span className="text-[9px] opacity-60">{statsTotals.monthToEndSum > 0 ? formatUAHThousands(statsTotals.monthToEndSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.nextMonthSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Наст</span>
                          <span className="text-[9px] opacity-60">{statsTotals.nextMonthSum > 0 ? formatUAHThousands(statsTotals.nextMonthSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.plus2MonthSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>+2</span>
                          <span className="text-[9px] opacity-60">{statsTotals.plus2MonthSum > 0 ? formatUAHThousands(statsTotals.plus2MonthSum) : '0 тис.'}</span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {compactStatsRows.map((r) => (
                      <tr key={r.masterId}>
                        <td className="text-[10px] whitespace-nowrap py-0.5 px-1 w-[120px] max-w-[120px] text-base-content">
                          <span className="font-medium block truncate" title={r.masterName}>
                            {r.masterName}
                          </span>
                        </td>
                        <td className="text-[10px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.clients}</td>
                        <td className="text-[10px] text-right py-0.5 px-1 w-[58px] text-base-content tabular-nums">{r.consultBooked}</td>
                        <td className="text-[10px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.consultAttended}</td>
                        <td className="text-[10px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.paidAttended}</td>
                        <td
                          className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[66px] text-base-content tabular-nums"
                          title={
                            r.paidAttended > 0
                              ? `${r.rebooksCreated} / ${r.paidAttended} = ${Math.round((r.rebooksCreated / r.paidAttended) * 1000) / 10}%`
                              : ''
                          }
                        >
                          {r.rebooksCreated}
                          {r.paidAttended > 0 ? (
                            <span className="ml-1 text-[10px] opacity-60">({Math.round((r.rebooksCreated / r.paidAttended) * 1000) / 10}%)</span>
                          ) : null}
                        </td>
                        <td
                          className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.futureSum === 'number' ? formatUAHExact(r.futureSum) : ''}
                        >
                          {typeof r.futureSum === 'number' && r.futureSum > 0 ? formatUAHThousands(r.futureSum) : '-'}
                        </td>
                        <td
                          className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.monthToEndSum === 'number' ? formatUAHExact(r.monthToEndSum) : ''}
                        >
                          {typeof r.monthToEndSum === 'number' && r.monthToEndSum > 0 ? formatUAHThousands(r.monthToEndSum) : '-'}
                        </td>
                        <td
                          className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.nextMonthSum === 'number' ? formatUAHExact(r.nextMonthSum) : ''}
                        >
                          {typeof r.nextMonthSum === 'number' && r.nextMonthSum > 0 ? formatUAHThousands(r.nextMonthSum) : '-'}
                        </td>
                        <td
                          className="text-[10px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.plus2MonthSum === 'number' ? formatUAHExact(r.plus2MonthSum) : ''}
                        >
                          {typeof r.plus2MonthSum === 'number' && r.plus2MonthSum > 0 ? formatUAHThousands(r.plus2MonthSum) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Фільтри та пошук */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="min-w-[500px]">
              <label className="label label-text text-xs">Пошук</label>
              <div className="flex gap-1 items-center">
                <div className="relative flex-1">
              <input
                type="text"
                    placeholder="Instagram або ім'я..."
                    className="input input-bordered input-sm w-full pr-8"
                    value={searchInput}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setSearchInput(newValue);
                      // Автоматично оновлюємо фільтр при введенні
                      onFiltersChange({ ...filters, search: newValue });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // При натисканні Enter також оновлюємо фільтр
                        onFiltersChange({ ...filters, search: searchInput });
                        onSearchClick?.();
                      }
                    }}
                  />
                  {searchInput && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
                      onClick={() => {
                        setSearchInput("");
                        onFiltersChange({ ...filters, search: "" });
                        // При очищенні розблоковуємо пошук, щоб показати всіх клієнтів
                        // onSearchClick?.() тут не потрібен, бо onFiltersChange вже розблоковує при зміні search
                      }}
                      title="Очистити"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    // При натисканні кнопки "Знайти" явно зафіксовуємо пошук
                    onFiltersChange({ ...filters, search: searchInput });
                    // Викликаємо callback для блокування автоматичного оновлення
                    onSearchClick?.();
                  }}
                >
                  Знайти
                </button>
              </div>
            </div>
            <div className="min-w-[150px]">
              <label className="label label-text text-xs">Статус</label>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.statusId}
                onChange={(e) => onFiltersChange({ ...filters, statusId: e.target.value })}
              >
                <option value="">Всі статуси</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="label label-text text-xs">Джерело</label>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.source}
                onChange={(e) => onFiltersChange({ ...filters, source: e.target.value })}
              >
                <option value="">Всі джерела</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="other">Інше</option>
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="label label-text text-xs">Майстер</label>
              <select
                className="select select-bordered select-sm w-full"
                value={filters.masterId}
                onChange={(e) => onFiltersChange({ ...filters, masterId: e.target.value })}
              >
                <option value="">Всі майстри</option>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-control">
              <label className="label cursor-pointer gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={filters.hasAppointment === "true"}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      hasAppointment: e.target.checked ? "true" : "",
                    })
                  }
                />
                <span className="label-text text-xs">Запис</span>
              </label>
            </div>
            <div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setSearchInput("");
                  onFiltersChange({ statusId: "", masterId: "", source: "", search: "", hasAppointment: "" });
                }}
              >
                Скинути
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Кнопка додати клієнта */}
      <div className="flex justify-end">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setEditingClient({} as DirectClient)}
        >
          + Додати клієнта
        </button>
      </div>

      {/* Форма редагування */}
      {editingClient && (
        <ClientForm
          client={editingClient}
          statuses={statuses}
          masters={masters}
          onSave={async (clientData) => {
            if (editingClient.id) {
              await onClientUpdate(editingClient.id, clientData);
            } else {
              // Створення нового клієнта
              try {
                const res = await fetch(`/api/admin/direct/clients`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(clientData),
                });
                const data = await res.json();
                if (data.ok) {
                  await onRefresh();
                  setEditingClient(null);
                } else {
                  alert(data.error || "Failed to create client");
                }
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err));
              }
            }
            setEditingClient(null);
          }}
          onCancel={() => setEditingClient(null)}
        />
      )}

      {/* Модальне вікно історії станів */}
      <StateHistoryModal
        client={stateHistoryClient}
        isOpen={!!stateHistoryClient}
        onClose={() => setStateHistoryClient(null)}
      />

      {/* Модальне вікно історії повідомлень */}
      <MessagesHistoryModal
        client={messagesHistoryClient}
        isOpen={!!messagesHistoryClient}
        onClose={() => setMessagesHistoryClient(null)}
        onChatStatusUpdated={(u) => {
          const clientId = (u?.clientId || '').toString().trim();
          if (!clientId) return;
          setChatUiOverrides((prev) => ({
            ...prev,
            [clientId]: {
              chatStatusId: u.chatStatusId || undefined,
              chatStatusName: u.chatStatusName,
              chatStatusBadgeKey: u.chatStatusBadgeKey,
              chatNeedsAttention: u.chatNeedsAttention,
            } as any,
          }));
          // Якщо модалка відкрита саме для цього клієнта — оновлюємо також обʼєкт в модалці
          setMessagesHistoryClient((prev) => {
            if (!prev || prev.id !== clientId) return prev;
            return {
              ...prev,
              chatStatusId: u.chatStatusId || undefined,
              chatStatusName: u.chatStatusName,
              chatStatusBadgeKey: u.chatStatusBadgeKey,
              chatNeedsAttention: u.chatNeedsAttention,
            } as any;
          });
        }}
      />

      {/* Модальне вікно вебхуків клієнта */}
      {webhooksClient && (
        <ClientWebhooksModal
          isOpen={!!webhooksClient}
          onClose={() => setWebhooksClient(null)}
          clientName={[webhooksClient.firstName, webhooksClient.lastName].filter(Boolean).join(' ') || webhooksClient.instagramUsername}
          altegioClientId={webhooksClient.altegioClientId}
        />
      )}

      {/* Модальне вікно історії записів/консультацій (Altegio) */}
      {recordHistoryClient && (
        <RecordHistoryModal
          isOpen={!!recordHistoryClient}
          onClose={() => setRecordHistoryClient(null)}
          clientName={[recordHistoryClient.firstName, recordHistoryClient.lastName].filter(Boolean).join(' ') || recordHistoryClient.instagramUsername}
          altegioClientId={recordHistoryClient.altegioClientId}
          type={recordHistoryType}
        />
      )}

      {/* Модальне вікно історії майстрів */}
      {masterHistoryClient && (
        <MasterHistoryModal
          isOpen={!!masterHistoryClient}
          onClose={() => setMasterHistoryClient(null)}
          clientName={[masterHistoryClient.firstName, masterHistoryClient.lastName].filter(Boolean).join(' ') || masterHistoryClient.instagramUsername}
          currentMasterName={masterHistoryClient.serviceMasterName}
          historyJson={masterHistoryClient.serviceMasterHistory}
        />
      )}

      {/* Таблиця */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-2 sm:p-4">
          <div className="overflow-x-auto" style={{ maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
            <table className="table table-xs sm:table-sm w-full border-collapse table-fixed">
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: 60 }} />
                <col style={{ width: 44 }} />
                {/* Повне імʼя (суттєво ширше, щоб менше обрізалось) */}
                <col style={{ width: 160 }} />
              </colgroup>
              <thead>
                <tr className="bg-base-200">
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20 w-[36px] min-w-[36px] max-w-[36px]">№</th>
                  <th className="px-0 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20 w-[60px] min-w-[60px] max-w-[60px]">
                    <div className="flex flex-col items-start leading-none" title="Оновлення / Створення">
                      <button
                        className="hover:underline cursor-pointer text-left"
                        onClick={() =>
                          onSortChange(
                            "updatedAt",
                            sortBy === "updatedAt" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                        title="Оновлення"
                      >
                        Оновл. {sortBy === "updatedAt" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <button
                        className="hover:underline cursor-pointer text-left mt-0.5"
                        onClick={() =>
                          onSortChange(
                            "createdAt",
                            sortBy === "createdAt" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                        title="Створення"
                      >
                        Створ. {sortBy === "createdAt" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                    </div>
                  </th>
                  {/* Слот під аватар (порожній заголовок), щоб вирівняти рядки і зсунути “Повне імʼя” вліво */}
                  <th className="px-0.5 py-2 bg-base-200 sticky top-0 z-20 w-[44px] min-w-[44px] max-w-[44px]" />
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <div className="flex flex-col items-start leading-none">
                      <button
                        className="hover:underline cursor-pointer text-left"
                        onClick={() =>
                          onSortChange(
                            "visits",
                            sortBy === "visits" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                        title="Сортувати по кількості відвідувань"
                      >
                        Повне імʼя {sortBy === "visits" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <button
                        className="hover:underline cursor-pointer text-left mt-0.5"
                        onClick={() =>
                          onSortChange(
                            "instagramUsername",
                            sortBy === "instagramUsername" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Instagram {sortBy === "instagramUsername" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                    </div>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <div className="flex flex-col items-start leading-none">
                      <button
                        className="hover:underline cursor-pointer text-left mt-0.5"
                        onClick={() =>
                          onSortChange(
                            "spent",
                            sortBy === "spent" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Продажі {sortBy === "spent" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                    </div>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20 w-[120px] min-w-[120px]">
                    Переписка
                  </th>
                  <th className="px-1 sm:px-1 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20 text-center w-[176px] min-w-[176px]">
                    <button
                      className="hover:underline cursor-pointer w-full text-center"
                      onClick={() =>
                        onSortChange(
                          "state",
                          sortBy === "state" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Стан {sortBy === "state" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "consultationBookingDate",
                          sortBy === "consultationBookingDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Запис на консультацію {sortBy === "consultationBookingDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "paidServiceDate",
                          sortBy === "paidServiceDate" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Запис {sortBy === "paidServiceDate" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "masterId",
                          sortBy === "masterId" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Майстер {sortBy === "masterId" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold min-w-[180px]">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "statusId",
                          sortBy === "statusId" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Статус {sortBy === "statusId" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold min-w-[200px]">
                    <button
                      className="hover:underline cursor-pointer"
                      onClick={() =>
                        onSortChange(
                          "comment",
                          sortBy === "comment" && sortOrder === "desc" ? "asc" : "desc"
                        )
                      }
                    >
                      Коментар {sortBy === "comment" && (sortOrder === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    Телефон
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">Дії</th>
                </tr>
              </thead>
              <tbody>
                {uniqueClients.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="text-center py-8 text-gray-500">
                      Немає клієнтів
                    </td>
                  </tr>
                ) : (
                  uniqueClients.map((client, index) => (
                    <tr
                      key={client.id}
                    >
                      <td className="px-1 sm:px-2 py-1 text-xs text-right">{index + 1}</td>
                      <td className="px-0 py-1 text-xs whitespace-nowrap">
                        <span className="flex flex-col leading-none">
                          <span>{client.updatedAt ? formatDateShortYear(client.updatedAt) : '-'}</span>
                          <span className="opacity-70">{client.createdAt ? formatDateShortYear(client.createdAt) : '-'}</span>
                        </span>
                      </td>
                      {/* Фіксований кружок-слот, максимально близько до колонки дат */}
                      <td className="px-0.5 py-1 w-[44px] min-w-[44px] max-w-[44px]">
                        {(() => {
                          const username = (client.instagramUsername || "").toString();
                          const isNoInstagram =
                            username === "NO INSTAGRAM" || username.startsWith("no_instagram_");
                          const isMissingInstagram = username.startsWith("missing_instagram_");
                          const isNormalInstagram = Boolean(username) && !isNoInstagram && !isMissingInstagram;
                          const avatarSrc = isNormalInstagram
                            ? `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`
                            : null;

                          return (
                            <AvatarSlot
                              avatarSrc={avatarSrc}
                              onLoad={() => {
                                // #region agent log
                                fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    sessionId: 'debug-session',
                                    runId: 'avatar-load-1',
                                    hypothesisId: 'H3',
                                    location: 'DirectClientTable.tsx:AvatarSlot_onLoad',
                                    message: 'Avatar loaded',
                                    data: { hasAvatarSrc: Boolean(avatarSrc) },
                                    timestamp: Date.now(),
                                  }),
                                }).catch(() => {});
                                // #endregion agent log
                              }}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                                // #region agent log
                                __logAvatarDebug({ runId: 'avatar-fail-1', username, avatarSrc }).catch(() => {});
                                // #endregion agent log
                              }}
                            />
                          );
                        })()}
                      </td>
                      <td className="px-0 py-1 text-xs whitespace-nowrap">
                        <span className="flex flex-col leading-none">
                          {(() => {
                            const first = (client.firstName || "").toString().trim();
                            const last = (client.lastName || "").toString().trim();
                            const hasName = Boolean(first || last);
                            const fullName = getFullName(client);

                            const username = (client.instagramUsername || "").toString();
                            const isNoInstagram =
                              username === "NO INSTAGRAM" || username.startsWith("no_instagram_");
                            const isMissingInstagram = username.startsWith("missing_instagram_");
                            const isNormalInstagram = Boolean(username) && !isNoInstagram && !isMissingInstagram;

                            const invalidIgLabel = isNoInstagram
                              ? "NO"
                              : isMissingInstagram
                                ? "missing"
                                : null;

                            // Бейдж “Лід/Клієнт” має змінюватись автоматично, коли зʼявляється Altegio ID
                            const isClientType = Boolean(client.altegioClientId);
                            const typeBadgeTitle = isClientType
                              ? "Клієнт (є Altegio ID)"
                              : "Лід (ще без Altegio ID)";

                            if (!hasName) {
                              const visitsValue =
                                client.visits !== null && client.visits !== undefined ? client.visits : null;
                              const visitsSuffix = visitsValue !== null ? `(${visitsValue})` : "";
                              const instagramUrl = `https://instagram.com/${username}`;
                              const phoneQuery = (client.phone || "").toString().trim();
                              const fallbackNameQuery = (fullName && fullName !== "-" ? fullName : "").toString().trim();
                              const fallbackIgQuery = isNormalInstagram ? username : "";
                              const altegioSearchQuery = isClientType
                                ? (phoneQuery || fallbackNameQuery || fallbackIgQuery)
                                : (fallbackNameQuery || fallbackIgQuery);
                              const altegioUrl = buildAltegioClientsSearchUrl(altegioSearchQuery);
                              const typeBadge = isClientType ? (
                                <a
                                  href={altegioUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 hover:opacity-80 transition-opacity"
                                  title={`${typeBadgeTitle}\nВідкрити в Altegio (Клієнтська база)`}
                                  aria-label={`${typeBadgeTitle}. Відкрити в Altegio`}
                                >
                                  <ClientBadgeIcon />
                                </a>
                              ) : (
                                <a
                                  href={instagramUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 hover:opacity-80 transition-opacity"
                                  title="Відкрити Instagram"
                                  aria-label="Відкрити Instagram"
                                >
                                  <LeadBadgeIcon />
                                </a>
                              );

                              return (
                                <>
                                  <div className="flex items-center gap-1 min-w-0">
                                    {typeBadge}
                                    {isNormalInstagram ? (
                                      <a
                                        href={`https://instagram.com/${username}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="link link-primary flex items-center gap-1 min-w-0"
                                        title={`https://instagram.com/${username}`}
                                      >
                                        <span className="truncate min-w-0">{username}</span>
                                        {visitsSuffix ? (
                                          <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                                        ) : null}
                                      </a>
                                    ) : (
                                      <span className="text-gray-400 flex items-center gap-1 min-w-0" title={username || ""}>
                                        <span className="truncate min-w-0">—</span>
                                        {visitsSuffix ? (
                                          <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                                        ) : null}
                                      </span>
                                    )}
                                  </div>
                                  {invalidIgLabel && (
                                    <span className="mt-0.5 text-[10px] text-red-600 font-semibold leading-none">
                                      {invalidIgLabel}
                                    </span>
                                  )}
                                </>
                              );
                            }

                            const nameOneLine = [first, last].filter(Boolean).join(" ").trim() || fullName;
                            const visitsValue =
                              client.visits !== null && client.visits !== undefined ? client.visits : null;
                            const visitsSuffix = visitsValue !== null ? `(${visitsValue})` : "";
                            const instagramUrl = `https://instagram.com/${username}`;
                            const phoneQuery = (client.phone || "").toString().trim();
                            const fallbackNameQuery = (nameOneLine && nameOneLine !== "-" ? nameOneLine : "").toString().trim();
                            const fallbackIgQuery = isNormalInstagram ? username : "";
                            const altegioSearchQuery = isClientType
                              ? (phoneQuery || fallbackNameQuery || fallbackIgQuery)
                              : (fallbackNameQuery || fallbackIgQuery);
                            const altegioUrl = buildAltegioClientsSearchUrl(altegioSearchQuery);
                            const typeBadge = isClientType ? (
                              <a
                                href={altegioUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 hover:opacity-80 transition-opacity"
                                title={`${typeBadgeTitle}\nВідкрити в Altegio (Клієнтська база)`}
                                aria-label={`${typeBadgeTitle}. Відкрити в Altegio`}
                              >
                                <ClientBadgeIcon />
                              </a>
                            ) : (
                              <a
                                href={instagramUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 hover:opacity-80 transition-opacity"
                                title="Відкрити Instagram"
                                aria-label="Відкрити Instagram"
                              >
                                <LeadBadgeIcon />
                              </a>
                            );

                            return (
                              <>
                                <div className="flex items-center gap-1 min-w-0">
                                  {typeBadge}
                                  {isNormalInstagram ? (
                                    <a
                                      href={`https://instagram.com/${username}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="link link-primary flex items-center gap-1 min-w-0"
                                      title={`https://instagram.com/${username}`}
                                    >
                                      <span className="truncate min-w-0">{nameOneLine}</span>
                                      {visitsSuffix ? (
                                        <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                                      ) : null}
                                    </a>
                                  ) : (
                                    <span className="flex items-center gap-1 min-w-0" title={nameOneLine}>
                                      <span className="truncate min-w-0">{nameOneLine}</span>
                                      {visitsSuffix ? (
                                        <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                                      ) : null}
                                    </span>
                                  )}
                                </div>
                                {invalidIgLabel && (
                                  <span className="mt-0.5 text-[10px] text-red-600 font-semibold leading-none">
                                    {invalidIgLabel}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </span>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        <span className="flex flex-col items-center leading-none">
                          <span className="text-center">
                            {client.spent !== null && client.spent !== undefined
                              ? `${Math.round(client.spent / 1000).toLocaleString('uk-UA')} тис.`
                              : '-'}
                          </span>
                        </span>
                      </td>
                      {/* Переписка (після “Продажі”): число повідомлень (клік → історія) + текст-статус */}
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap w-[120px] min-w-[120px]">
                        {(() => {
                          const total =
                            typeof (client as any).messagesTotal === 'number' ? (client as any).messagesTotal : 0;
                          const needs = Boolean((client as any).chatNeedsAttention);
                          const statusId = (client.chatStatusId || '').toString().trim();
                          const hasStatus = Boolean(statusId);
                          const statusNameRaw = ((client as any).chatStatusName || '').toString().trim();
                          const showStatus = Boolean(statusNameRaw) && hasStatus;
                          const badgeKey = ((client as any).chatStatusBadgeKey || '').toString().trim();
                          const badgeCfg = getChatBadgeStyle(badgeKey);

                          // Фон лічильника НЕ залежить від статусу:
                          // - сірий завжди
                          // - голубий тільки якщо зʼявились нові
                          // НОВЕ ПРАВИЛО:
                          // - якщо статус НЕ встановлено → голубий
                          // - якщо статус встановлено і нових нема → сірий
                          // - якщо є нові → голубий (незалежно від статусу)
                          // Ідентичний “телеграмний” голубий (hex), щоб вигляд був як на скріні
                          const countClass =
                            needs || !hasStatus ? 'bg-[#2AABEE] text-white' : 'bg-gray-200 text-gray-900';

                          return (
                            <div className="flex items-center gap-2">
                              <button
                                className={`relative inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums hover:opacity-80 transition-opacity ${countClass} text-[12px] font-normal leading-none`}
                                onClick={() => setMessagesHistoryClient(client)}
                                title={needs ? 'Є нові повідомлення — відкрити історію' : 'Відкрити історію повідомлень'}
                                type="button"
                              >
                                {total}
                                {needs ? (
                                  <span
                                    className="absolute -top-[2px] -right-[2px] w-[8px] h-[8px] rounded-full bg-red-600"
                                    title="Є нові вхідні повідомлення"
                                  />
                                ) : null}
                              </button>

                              {showStatus ? (
                                <span
                                  className="inline-flex max-w-[120px] items-center rounded-full px-2 py-0.5 text-[11px] font-normal leading-none"
                                  title={statusNameRaw}
                                  style={{
                                    backgroundColor: badgeCfg.bg,
                                    color: badgeCfg.fg,
                                  }}
                                >
                                  <span className="truncate">{statusNameRaw}</span>
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-1 sm:px-1 py-1 text-xs whitespace-nowrap text-right w-[176px] min-w-[176px]">
                        <div className="flex w-full items-center justify-end gap-1">
                          {/* Відображаємо останні 5 станів (або менше, якщо їх немає) */}
                          {(() => {
                            const states = client.last5States || [];
                            const currentState = client.state || 'lead';
                            
                            // РАДИКАЛЬНЕ ПРАВИЛО: "Лід" тільки для клієнтів з Manychat (БЕЗ altegioClientId)
                            const isManychatClient = !client.altegioClientId;
                            
                            // Якщо немає історії, показуємо поточний стан
                            if (states.length === 0) {
                              // Стан "lead" видалено: трактуємо як "message"
                              let stateToShow: any = currentState === 'lead' ? 'message' : currentState;
                              // Якщо стан порожній, але є lastMessageAt — показуємо "Розмова"
                              if (!stateToShow && client.lastMessageAt) stateToShow = 'message';
                              // У колонці “Стан” більше не показуємо `client` — тип (лід/клієнт) тепер видно в “Повне імʼя”
                              if (stateToShow === 'client') return null;
                              // Переписку тепер показуємо в окремій колонці “Переписка”
                              if (stateToShow === 'message') return null;
                              return (
                                <button
                                  onClick={() => setStateHistoryClient(client)}
                                  className="hover:opacity-70 transition-opacity cursor-pointer"
                                  title="Натисніть, щоб переглянути історію станів"
                                >
                                  <div className="tooltip" data-tip={new Date(client.createdAt).toLocaleDateString('uk-UA')}>
                                    <StateIcon state={stateToShow} size={32} />
                                  </div>
                                </button>
                              );
                            }
                            
                            // Спочатку сортуємо від старіших до новіших для правильної фільтрації
                            const sortedStates = [...states].sort((a, b) => 
                              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                            );
                            
                            // ФІЛЬТРУЄМО: для Altegio клієнтів - видаляємо ВСІ "lead"
                            // для Manychat клієнтів - залишаємо тільки найстаріший "lead", але тільки якщо він дійсно найстаріший
                            // для ВСІХ клієнтів - залишаємо тільки найстаріший "client" (стан "client" має бути тільки один раз)
                            // ВИДАЛЯЄМО ВСІ "no-instagram" (це були червоні квадрати, які потім стали чорними лійками)
                            // НОВЕ ПРАВИЛО: Якщо найстаріший стан - "message", відображаємо його як "Лід"
                            const filteredStates: typeof sortedStates = [];
                            const leadLogs: typeof sortedStates = [];
                            const messageLogs: typeof sortedStates = [];
                            const clientLogs: typeof sortedStates = [];
                            const consultationBookedLogs: typeof sortedStates = [];
                            const consultationNoShowLogs: typeof sortedStates = [];
                            const consultationRescheduledLogs: typeof sortedStates = [];
                            const otherLogs: typeof sortedStates = [];
                            
                            for (let i = 0; i < sortedStates.length; i++) {
                              const log = sortedStates[i];
                              
                              // ВИДАЛЯЄМО "no-instagram" (це були червоні квадрати)
                              if (log.state === 'no-instagram') {
                                continue; // Пропускаємо всі "no-instagram"
                              }

                              // Якщо історичний баг записав state=null, але клієнт має lastMessageAt,
                              // трактуємо це як "Розмова", щоб не втрачати іконку.
                              if ((!log.state || String(log.state).trim() === '') && client.lastMessageAt) {
                                messageLogs.push({ ...(log as any), state: 'message' } as any);
                                continue;
                              }
                              
                              if (log.state === 'lead') {
                                // Для Altegio клієнтів - ПРИХОВУЄМО ВСІ "lead"
                                if (!isManychatClient) {
                                  continue; // Пропускаємо всі "lead" для Altegio клієнтів
                                }
                                // Для Manychat клієнтів - збираємо "lead" окремо
                                leadLogs.push(log);
                              } else if (log.state === 'message') {
                                // Збираємо "message" окремо для перевірки, чи це перше повідомлення
                                messageLogs.push(log);
                              } else if (log.state === 'client') {
                                // Збираємо "client" окремо для фільтрації дублікатів
                                clientLogs.push(log);
                              } else if (log.state === 'consultation-booked') {
                                consultationBookedLogs.push(log);
                              } else if (log.state === 'consultation-no-show') {
                                consultationNoShowLogs.push(log);
                              } else if (log.state === 'consultation-rescheduled') {
                                consultationRescheduledLogs.push(log);
                              } else {
                                // Всі інші стани збираємо окремо
                                otherLogs.push(log);
                              }
                            }

                            // `client` у колонці “Стан” більше не показуємо (тип контакту тепер видно біля імені),
                            // тому синтетичний `client` тут не додаємо.
                            
                            // Якщо є дата консультації (показуємо її в таблиці), але state-log ще не встиг записати `consultation-booked`,
                            // додаємо derived-стан `consultation-booked`, щоб у колонці "Стан" був синій календарик.
                            // ВАЖЛИВО: не додаємо, якщо консультації ігноруються (visits >= 2) — це правило вже узгоджене раніше.
                            try {
                              const shouldIgnoreConsult = (client.visits ?? 0) >= 2;
                              const hasConsultDate = Boolean(client.consultationBookingDate);
                              const hasConsultInLogs = consultationBookedLogs.length > 0;
                              const hasConsultAsCurrent =
                                currentState === 'consultation-booked' || currentState === 'consultation';

                              if (!shouldIgnoreConsult && hasConsultDate && !hasConsultInLogs && !hasConsultAsCurrent) {
                                const syntheticConsult: any = {
                                  id: 'synthetic-consultation-booked',
                                  clientId: client.id,
                                  state: 'consultation-booked',
                                  previousState: null,
                                  reason: 'derived-consultation-booking-date',
                                  createdAt: String(client.consultationBookingDate),
                                };
                                consultationBookedLogs.unshift(syntheticConsult);
                              }
                            } catch {}

                            // Стан "lead" видалено: не конвертуємо message -> lead
                            const oldestMessageAsLead: typeof sortedStates[0] | null = null;
                            
                            // lead видалено: для Manychat-клієнтів не показуємо "lead" взагалі
                            if (isManychatClient && leadLogs.length > 0) {
                              // Для Manychat клієнтів: залишаємо тільки найстаріший "lead", але тільки якщо він дійсно найстаріший
                              const oldestLead = leadLogs[0]; // Найстаріший "lead" (вже відсортовано)
                              
                              // Перевіряємо, чи є стани старіші за "lead" (враховуючи всі стани, включно з message)
                              const allOtherStates = [...clientLogs, ...messageLogs, ...consultationBookedLogs, ...consultationNoShowLogs, ...consultationRescheduledLogs, ...otherLogs];
                              const olderThanLead = allOtherStates.filter(log => 
                                new Date(log.createdAt).getTime() < new Date(oldestLead.createdAt).getTime()
                              );
                              
                              // Якщо "lead" найстаріший - залишаємо його (він початковий стан)
                              // Якщо є стани старіші - не показуємо "lead" (він не є початковим станом)
                              if (olderThanLead.length === 0) {
                                // "lead" найстаріший - додаємо його першим
                                // state="lead" більше не використовуємо — показуємо як "message"
                                filteredStates.push({ ...oldestLead, state: 'message' } as any);
                              }
                              // Якщо є стани старіші - не додаємо "lead"
                            }
                            
                            // `client` у колонці “Стан” не показуємо — не додаємо його в `filteredStates`.
                            
                            // Для consultation-related станів - залишаємо тільки найстаріший (якщо є)
                            // Стан `consultation` більше не показуємо в UI (факт приходу дивимось по ✅ у даті консультації).
                            if (consultationBookedLogs.length > 0) {
                              filteredStates.push(consultationBookedLogs[0]); // Тільки найстаріший "consultation-booked"
                            }
                            if (consultationNoShowLogs.length > 0) {
                              filteredStates.push(consultationNoShowLogs[0]); // Тільки найстаріший "consultation-no-show"
                            }
                            if (consultationRescheduledLogs.length > 0) {
                              filteredStates.push(consultationRescheduledLogs[0]); // Тільки найстаріший "consultation-rescheduled"
                            }
                            
                            // Додаємо всі message-логи (потім все одно лишиться 1 через дедуп по іконці)
                            const remainingMessageLogs = messageLogs;
                            filteredStates.push(...remainingMessageLogs);
                            
                            // Додаємо всі інші стани
                            filteredStates.push(...otherLogs);
                            
                            // Сортуємо від старіших до новіших для подальшої обробки
                            filteredStates.sort((a, b) => 
                              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                            );
                            
                            // Останній стан з історії
                            const lastHistoryState = filteredStates[filteredStates.length - 1]?.state || null;
                            
                            // Додаємо поточний стан, якщо він відрізняється
                            const statesToShow = [...filteredStates];
                            
                            if (currentState !== lastHistoryState) {
                              // Для Altegio клієнтів - НЕ додаємо поточний стан, якщо він "lead"
                              if (!isManychatClient && currentState === 'lead') {
                                // Не додаємо "lead" для Altegio клієнтів
                              } else if (currentState !== 'client') {
                                // Для всіх інших станів - завжди додаємо
                              statesToShow.push({
                                id: 'current',
                                clientId: client.id,
                                state: currentState === 'lead' ? 'message' : currentState,
                                previousState: lastHistoryState,
                                reason: 'current-state',
                                createdAt: new Date().toISOString(),
                              });
                            }
                            }
                            
                            // Фінальна перевірка: видаляємо всі "lead" для Altegio клієнтів та "no-instagram" для всіх
                            // Також приховуємо невідомі стани, які можуть показуватись як чорні лійки (image-lead.png)
                            const finalStatesToShow = statesToShow.filter(log => {
                              // Видаляємо "no-instagram"
                              if (log.state === 'no-instagram') return false;
                              
                              // `client` більше не відображаємо в колонці “Стан”
                              if (log.state === 'client') return false;
                              
                              // lead більше не використовуємо
                              if (log.state === 'lead') return false;

                              // Переписку (message) відображаємо в окремій колонці “Переписка”
                              if (log.state === 'message') return false;
                              
                              // Приховуємо null/undefined стани (вони показуються як "lead")
                              if (!log.state || log.state.trim() === '') return false;
                              
                              return true;
                            });

                            // Дедуплікація для колонки “Стан”:
                            // важливо: деякі різні state можуть виглядати однаково (наприклад `consultation` та `consultation-booked`).
                            // Тому дедуп робимо по ключу іконки (iconKey), а не по raw state.
                            const iconKeyForState = (st: any): string => {
                              const s = (st || '').toString();
                              if (!s) return '';
                              // `consultation` більше не використовуємо як окремий стан, у UI він = `consultation-booked`
                              if (s === 'consultation') return 'consultation-booked';
                              return s;
                            };

                            const dedupedStatesToShow = (() => {
                              const out: typeof finalStatesToShow = [];
                              const seen = new Set<string>();
                              for (let i = finalStatesToShow.length - 1; i >= 0; i--) {
                                const stRaw = finalStatesToShow[i]?.state;
                                const key = iconKeyForState(stRaw);
                                if (!key) continue;
                                if (seen.has(key)) continue;
                                seen.add(key);
                                out.push(finalStatesToShow[i]);
                              }
                              return out.reverse();
                            })();
                            
                            return (
                              <>
                                {dedupedStatesToShow.slice(-5).map((stateLog, idx) => {
                                  const stateDate = new Date(stateLog.createdAt);
                                  const formattedDate = stateDate.toLocaleDateString('uk-UA', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  });
                                  
                                  // Гарантуємо, що state не є "no-instagram" або "lead" для Altegio клієнтів
                                  const stateToShow = stateLog.state === 'no-instagram' || stateLog.state === 'lead'
                                    ? null
                                    : (stateLog.state || null);
                                  
                                  // Якщо state null після фільтрації, не показуємо іконку
                                  if (!stateToShow) return null;
                                  
                                  const onClickHandler = () => setStateHistoryClient(client);
                                  const tooltipText = `${formattedDate}\nНатисніть, щоб переглянути історію станів`;
                                  
                                  return (
                                    <button
                                      key={stateLog.id || `state-${idx}`}
                                      onClick={onClickHandler}
                                      className="hover:opacity-70 transition-opacity cursor-pointer"
                                      title={tooltipText}
                                    >
                                      <div className="tooltip tooltip-top" data-tip={formattedDate}>
                                        <StateIcon state={stateToShow} size={28} />
                                      </div>
                                    </button>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.consultationBookingDate ? (
                          (() => {
                            try {
                              // Перевіряємо, чи це не масив або кілька дат
                              const dateValue = typeof client.consultationBookingDate === 'string' 
                                ? client.consultationBookingDate.trim() 
                                : client.consultationBookingDate;
                              
                              // Витягуємо тільки дату (ISO формат: YYYY-MM-DDTHH:mm:ss.sssZ або подібний)
                              // Відкидаємо все, що не схоже на дату
                              let dateStr = typeof dateValue === 'string' ? dateValue : String(dateValue);
                              
                              // Шукаємо ISO дату в рядку (YYYY-MM-DD або YYYY-MM-DDTHH:mm:ss)
                              const isoDateMatch = dateStr.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/);
                              if (!isoDateMatch) {
                                // Якщо не знайшли ISO формат, спробуємо інші формати
                                const parts = dateStr.split(/\s+/);
                                for (const part of parts) {
                                  const testDate = new Date(part);
                                  if (!isNaN(testDate.getTime()) && part.match(/^\d/)) {
                                    dateStr = part;
                                    break;
                                  }
                                }
                              } else {
                                dateStr = isoDateMatch[0];
                              }
                              
                              const appointmentDate = new Date(dateStr);
                              if (isNaN(appointmentDate.getTime())) {
                                console.warn('[DirectClientTable] Invalid consultationBookingDate:', client.consultationBookingDate);
                                return "";
                              }
                              
                              // Порівнюємо по дню в Europe/Kyiv (як і для платних записів),
                              // щоб “сьогодні” рахувалось як минуле/сьогоднішнє, а не майбутнє.
                              const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
                                timeZone: 'Europe/Kyiv',
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                              });
                              const todayKyivDay = kyivDayFmt.format(new Date()); // YYYY-MM-DD
                              const consultKyivDay = kyivDayFmt.format(appointmentDate); // YYYY-MM-DD
                              const isPast = consultKyivDay < todayKyivDay;
                              const isPastOrToday = consultKyivDay <= todayKyivDay;
                              const formattedDateStr = formatDate(dateStr);
                              const isOnline = client.isOnlineConsultation || false;
                              
                              // Форматуємо дату створення запису для tooltip (коли створено запис в Altegio)
                              const createdAtDate = client.consultationRecordCreatedAt
                                ? new Date(client.consultationRecordCreatedAt)
                                : null;
                              const createdAtStr = createdAtDate && !isNaN(createdAtDate.getTime())
                                ? createdAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                                : null;
                              
                              // Діагностика для "Юлія Кобра" та "Топоріна Олена"
                              const isDebugClient = client.instagramUsername === 'kobra_best' || 
                                                   client.instagramUsername === 'olena_toporina' ||
                                                   (client.firstName === 'Юлія' && client.lastName === 'Кобра') ||
                                                   (client.firstName === 'Топоріна' && client.lastName === 'Олена');
                              
                              if (isDebugClient) {
                                console.log(`[DirectClientTable] 🔍 Діагностика для ${client.instagramUsername || 'unknown'}:`, {
                                  clientId: client.id,
                                  instagramUsername: client.instagramUsername,
                                  firstName: client.firstName,
                                  lastName: client.lastName,
                                  consultationBookingDate: client.consultationBookingDate,
                                  consultationBookingDateType: typeof client.consultationBookingDate,
                                  isOnlineConsultation: client.isOnlineConsultation,
                                  isOnlineConsultationType: typeof client.isOnlineConsultation,
                                  isOnline: isOnline,
                                  dateStr: formattedDateStr,
                                  extractedDateStr: dateStr,
                                  dateValue,
                                  paidServiceDate: client.paidServiceDate,
                                  signedUpForPaidService: client.signedUpForPaidService,
                                  fullClient: client,
                                });
                              }
                              
                              // Визначаємо значок attendance
                              let attendanceIcon = null;
                              if (client.consultationCancelled) {
                                attendanceIcon = <span className="text-orange-600 text-lg" title="Скасовано до дати консультації">🚫</span>;
                              } else
                              if (isPastOrToday) {
                                if (client.consultationAttended === true) {
                                  attendanceIcon = <span className="text-green-600 text-lg" title="Клієнтка прийшла на консультацію">✅</span>;
                                } else if (client.consultationAttended === false) {
                                  attendanceIcon = <span className="text-red-600 text-lg" title="Клієнтка не з'явилася на консультацію">❌</span>;
                                } else {
                                  attendanceIcon = <span className="text-gray-500 text-lg" title="Немає підтвердження відвідування консультації (встановіть attendance в Altegio)">❓</span>;
                                }
                              } else {
                                // Майбутня консультація без attendance — очікується
                                if (client.consultationAttended == null) {
                                  attendanceIcon = <span className="text-gray-700 text-lg" title="Присутність: Очікується">⏳</span>;
                                }
                              }
                              
                              const baseTitle = isPast 
                                ? (isOnline ? "Минулий запис на онлайн-консультацію" : "Минулий запис на консультацію")
                                : (isOnline ? "Майбутній запис на онлайн-консультацію" : "Майбутній запис на консультацію");
                              const tooltipTitle = createdAtStr ? `${baseTitle}\nЗапис створено: ${createdAtStr}` : baseTitle;
                              
                              return (
                                <span className="flex flex-col items-center">
                                  <span className="flex items-center gap-1">
                                    <button
                                      className={
                                        isPast
                                          ? "text-amber-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                          : "text-blue-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                      }
                                      title={`${tooltipTitle}\nНатисніть, щоб переглянути історію консультацій`}
                                      onClick={() => {
                                        if (!client.altegioClientId) return;
                                        setRecordHistoryType('consultation');
                                        setRecordHistoryClient(client);
                                      }}
                                      disabled={!client.altegioClientId}
                                    >
                                      {formattedDateStr} {isOnline ? "💻" : "📅"}
                                    </button>
                                    {typeof client.consultationAttemptNumber === 'number' &&
                                    client.consultationAttemptNumber >= 2 ? (
                                      <span
                                        className="inline-flex items-center justify-center rounded-full bg-white border border-blue-300 text-blue-600 font-bold text-[12px] w-[20px] h-[20px]"
                                        title={`Повторна спроба консультації №${client.consultationAttemptNumber}`}
                                      >
                                        {client.consultationAttemptNumber}
                                      </span>
                                    ) : null}
                                    {attendanceIcon}
                                  </span>

                                  {(() => {
                                    const consultant = shortPersonName(client.consultationMasterName);
                                    if (!consultant) return (
                                      <span className="text-[10px] leading-none opacity-50 max-w-[220px] sm:max-w-[320px] truncate text-center">
                                        невідомо
                                      </span>
                                    );
                                    return (
                                      <span
                                        className="text-[10px] leading-none opacity-70 max-w-[220px] sm:max-w-[320px] truncate text-center"
                                        title={`Консультував: ${consultant}`}
                                      >
                                        {consultant}
                                      </span>
                                    );
                                  })()}
                                </span>
                              );
                            } catch (err) {
                              console.error('[DirectClientTable] Error formatting consultationBookingDate:', err, client.consultationBookingDate);
                              return "";
                            }
                          })()
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.signedUpForPaidService && client.paidServiceDate ? (
                          (() => {
                            const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
                              timeZone: 'Europe/Kyiv',
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                            });
                            const todayKyivDay = kyivDayFmt.format(new Date()); // YYYY-MM-DD
                            const paidKyivDay = kyivDayFmt.format(new Date(client.paidServiceDate)); // YYYY-MM-DD
                            const isPast = paidKyivDay < todayKyivDay;
                            const isPastOrToday = paidKyivDay <= todayKyivDay;
                            const dateStr = formatDate(client.paidServiceDate);
                            
                            // Форматуємо дату створення запису для tooltip (коли створено запис в Altegio)
                            const createdAtDate = client.paidServiceRecordCreatedAt
                              ? new Date(client.paidServiceRecordCreatedAt)
                              : null;
                            const createdAtStr = createdAtDate && !isNaN(createdAtDate.getTime())
                              ? createdAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                              : null;
                            
                            // Визначаємо значок attendance
                            let attendanceIcon = null;
                            if (client.paidServiceCancelled) {
                              attendanceIcon = <span className="text-orange-600 text-lg" title="Скасовано до дати запису">🚫</span>;
                            } else
                            if (isPastOrToday) {
                              if (client.paidServiceAttended === true) {
                                attendanceIcon = <span className="text-green-600 text-lg" title="Клієнтка прийшла на платну послугу">✅</span>;
                              } else if (client.paidServiceAttended === false) {
                                attendanceIcon = <span className="text-red-600 text-lg" title="Клієнтка не з'явилася на платну послугу">❌</span>;
                              } else {
                                attendanceIcon = <span className="text-gray-500 text-lg" title="Немає підтвердження відвідування платної послуги (встановіть attendance в Altegio)">❓</span>;
                              }
                            }

                            const isPendingAttendance = client.paidServiceAttended == null;
                            const pendingIcon =
                              !client.paidServiceCancelled && !isPastOrToday && isPendingAttendance
                                ? (
                                  <span className="text-gray-700 text-lg" title="Присутність: Очікується">⏳</span>
                                )
                                : null;
                            
                            const baseTitle = isPast ? "Минулий запис на платну послугу" : "Майбутній запис на платну послугу";
                            const tooltipTitle = createdAtStr ? `${baseTitle}\nЗапис створено: ${createdAtStr}` : baseTitle;
                            
                            return (
                              <span className="flex flex-col items-center">
                                <span className="flex items-center gap-1">
                                <button
                                  className={
                                    isPast
                                      ? "text-amber-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                      : "text-blue-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                  }
                                  title={`${tooltipTitle}\nНатисніть, щоб переглянути історію записів`}
                                  onClick={() => {
                                    if (!client.altegioClientId) return;
                                    setRecordHistoryType('paid');
                                    setRecordHistoryClient(client);
                                  }}
                                  disabled={!client.altegioClientId}
                                >
                                  {dateStr}
                                </button>
                                {pendingIcon}
                                {client.paidServiceIsRebooking ? (
                                  <span
                                    className="text-purple-700 text-lg"
                                    title={`Перезапис 🔁\nСтворено в день: ${client.paidServiceRebookFromKyivDay || '-'}\nАтрибутовано: ${shortPersonName(client.paidServiceRebookFromMasterName) || '-'}`}
                                  >
                                    🔁
                                  </span>
                                ) : null}
                                {attendanceIcon}
                                </span>

                                {typeof client.paidServiceTotalCost === 'number' && client.paidServiceTotalCost > 0 ? (
                                  <span
                                    className="text-[10px] leading-none opacity-70 max-w-[220px] sm:max-w-[320px] truncate text-center"
                                    title={`Сума запису: ${formatUAHExact(client.paidServiceTotalCost)}`}
                                  >
                                    {formatUAHThousands(client.paidServiceTotalCost)}
                                  </span>
                                ) : (
                                  <span className="text-[10px] leading-none opacity-50 max-w-[220px] sm:max-w-[320px] truncate text-center">
                                    невідомо
                                  </span>
                                )}
                              </span>
                            );
                          })()
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {(() => {
                          // Колонка "Майстер" — ТІЛЬКИ для платних записів.
                          if (!client.paidServiceDate) return '';
                          const full = (client.serviceMasterName || '').trim();
                          const name = shortPersonName(full);
                          if (!name) return '';
                          const secondary = shortPersonName((client as any).serviceSecondaryMasterName);

                          let historyTitle = name;
                          try {
                            const raw = client.serviceMasterHistory ? JSON.parse(client.serviceMasterHistory) : null;
                            if (Array.isArray(raw) && raw.length) {
                              const last5 = raw.slice(-5);
                              historyTitle =
                                `${name}\n\nІсторія змін (останні 5):\n` +
                                last5
                                  .map((h: any) => `${h.kyivDay || '-'} — ${shortPersonName(h.masterName) || '-'}`)
                                  .join('\n');
                            }
                          } catch {
                            // ignore
                          }
                          return (
                            <span className="flex flex-col items-start leading-none">
                              <button
                                type="button"
                                className="font-medium hover:underline text-left"
                                title={`${historyTitle}\n\nНатисніть, щоб відкрити повну історію`}
                                onClick={() => setMasterHistoryClient(client)}
                              >
                                {name}
                              </button>
                              {secondary ? (
                                <span className="text-[10px] leading-none opacity-70">
                                  ({secondary})
                                </span>
                              ) : null}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs min-w-[180px]">
                        <select
                          className="select select-xs select-bordered w-full min-w-[160px]"
                          value={client.statusId}
                          onChange={(e) => handleStatusChange(client, e.target.value)}
                          style={{ 
                            borderColor: getStatusColor(client.statusId),
                            backgroundColor: getStatusColor(client.statusId) + "20"
                          }}
                        >
                          {statuses.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs min-w-[200px]">
                        <input
                          type="text"
                          className="input input-xs input-bordered w-full min-w-[180px]"
                          placeholder="Коментар..."
                          value={client.comment || ""}
                          onChange={(e) => handleFieldUpdate(client, "comment", e.target.value || undefined)}
                          title={client.comment || "Коментар..."}
                        />
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap">
                        {client.phone ? (
                          <span className="font-mono">{client.phone}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs">
                        <div className="flex gap-1">
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => setEditingClient(client)}
                            title="Редагувати"
                          >
                            ✏️
                          </button>
                          {client.altegioClientId && (
                            <button
                              className="btn btn-xs btn-ghost text-info"
                              onClick={() => {
                                setWebhooksClient(client);
                              }}
                              title="Переглянути вебхуки клієнта"
                            >
                              🔗
                            </button>
                          )}
                          <button
                            className="btn btn-xs btn-ghost text-info"
                            onClick={async () => {
                              try {
                                const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ');
                                const res = await fetch('/api/admin/direct/diagnose-client', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    instagramUsername: client.instagramUsername,
                                    fullName: fullName || undefined,
                                    altegioClientId: client.altegioClientId || undefined,
                                  }),
                                });
                                const data = await res.json();
                                if (data.ok) {
                                  const diagnosis = data.diagnosis;
                                  let message = `🔍 Діагностика клієнтки: ${fullName || client.instagramUsername}\n\n`;
                                  
                                  if (diagnosis.directClient) {
                                    message += `✅ Клієнтка знайдена в Direct Manager\n`;
                                    message += `   ID: ${diagnosis.directClient.id}\n`;
                                    message += `   Instagram: ${diagnosis.directClient.instagramUsername}\n`;
                                    message += `   Стан: ${diagnosis.directClient.state || 'не встановлено'}\n`;
                                    message += `   Altegio ID: ${diagnosis.directClient.altegioClientId || 'немає'}\n\n`;
                                  } else {
                                    message += `❌ Клієнтка не знайдена в Direct Manager\n\n`;
                                  }
                                  
                                  if (diagnosis.issues && diagnosis.issues.length > 0) {
                                    message += `Проблеми:\n${diagnosis.issues.map((i: string) => `  ${i}`).join('\n')}\n\n`;
                                  }
                                  
                                  if (diagnosis.recommendations && diagnosis.recommendations.length > 0) {
                                    message += `Рекомендації:\n${diagnosis.recommendations.map((r: string) => `  ${r}`).join('\n')}\n\n`;
                                  }
                                  
                                  if (diagnosis.records) {
                                    message += `Записи в Altegio:\n`;
                                    message += `  Всього: ${diagnosis.records.total}\n`;
                                    message += `  З "Консультація": ${diagnosis.records.withConsultation}\n`;
                                    message += `  З "Нарощування волосся": ${diagnosis.records.withHairExtension}\n\n`;
                                  }
                                  
                                  if (diagnosis.webhooks) {
                                    message += `Вебхуки:\n`;
                                    message += `  Всього: ${diagnosis.webhooks.total}\n`;
                                    message += `  Записи: ${diagnosis.webhooks.records}\n`;
                                    message += `  Клієнти: ${diagnosis.webhooks.clients}\n\n`;
                                  }
                                  
                                  message += `Повна відповідь:\n${JSON.stringify(data, null, 2)}`;
                                  
                                  // Використовуємо alert з можливістю копіювання
                                  alert(message);
                                  // Також виводимо в консоль для детального аналізу
                                  console.log('Client Diagnosis:', data);
                                } else {
                                  alert(`Помилка діагностики: ${data.error || 'Невідома помилка'}`);
                                }
                              } catch (err) {
                                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
                              }
                            }}
                            title="Діагностика"
                          >
                            🔍
                          </button>
                          <button
                            className="btn btn-xs btn-ghost text-error"
                            onClick={async () => {
                              if (!confirm(`Видалити клієнта @${client.instagramUsername}?\n\nЦю дію неможливо скасувати.`)) {
                                return;
                              }
                              try {
                                const res = await fetch(`/api/admin/direct/clients/${client.id}`, {
                                  method: 'DELETE',
                                });
                                const data = await res.json();
                                if (data.ok) {
                                  await onRefresh();
                                } else {
                                  alert(`Помилка видалення: ${data.error || 'Невідома помилка'}`);
                                }
                              } catch (err) {
                                alert(`Помилка: ${err instanceof Error ? err.message : String(err)}`);
                              }
                            }}
                            title="Видалити"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
