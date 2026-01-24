// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect, useMemo } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import type { DirectClient, DirectStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";
import { StateHistoryModal } from "./StateHistoryModal";
import { MessagesHistoryModal } from "./MessagesHistoryModal";
import { ClientWebhooksModal } from "./ClientWebhooksModal";
import { RecordHistoryModal } from "./RecordHistoryModal";
import { MasterHistoryModal } from "./MasterHistoryModal";
import { getChatBadgeStyle } from "./ChatBadgeIcon";
import { useSearchParams } from "next/navigation";

type ChatStatusUiVariant = "v1" | "v2";

function normalizeChatStatusUiVariant(raw: string | null | undefined): ChatStatusUiVariant | null {
  const v = (raw || "").toString().trim().toLowerCase();
  if (v === "v2") return "v2";
  if (v === "v1") return "v1";
  return null;
}

function useChatStatusUiVariant(): ChatStatusUiVariant {
  const searchParams = useSearchParams();
  const urlRaw = searchParams?.get("chatStatusUi") || null;
  const urlVariant = normalizeChatStatusUiVariant(urlRaw);

  const [variant, setVariant] = useState<ChatStatusUiVariant>("v1");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "direct:chatStatusUi";

    if (urlVariant) {
      setVariant(urlVariant);
      try {
        window.localStorage.setItem(key, urlVariant);
      } catch {
        // ignore
      }
      return;
    }

    try {
      const saved = normalizeChatStatusUiVariant(window.localStorage.getItem(key));
      if (saved) setVariant(saved);
    } catch {
      // ignore
    }
  }, [urlVariant]);

  return variant;
}

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
  } else if (state === 'lead') {
    // Стан "lead" більше не використовується - замінюємо на "message" (зелена хмарка)
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  } else {
    // Для невідомих станів також показуємо зелену хмарку замість image-lead.png
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={iconStyle}>
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  }
}

function MissingRebookBadge({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Відсутній перезапис"
    >
      <circle cx="12" cy="12" r="11" fill="#FEE2E2" stroke="#EF4444" strokeWidth="1.5" />
      <path
        d="M7.5 12a4.5 4.5 0 0 1 7.7-3.2"
        stroke="#B91C1C"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.2 8.8l.1 3.1-3.1-.1"
        stroke="#B91C1C"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 16l8-8"
        stroke="#B91C1C"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ConsultDateMissingBadge({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Дата консультації не призначена"
    >
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#FFE4E6" stroke="#F43F5E" strokeWidth="1.5" />
      <path d="M7 2.8V6.2M17 2.8V6.2" stroke="#E11D48" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 8.5H21" stroke="#F43F5E" strokeWidth="1.5" />
      <path d="M9 13l6 6M15 13l-6 6" stroke="#BE123C" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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

function CornerRedDot({ title, className }: { title: string; className?: string }) {
  return (
    <span
      className={`absolute ${className || '-top-[4px] -right-[4px]'} w-[8px] h-[8px] rounded-full bg-red-600 border border-white`}
      title={title}
      aria-label={title}
    />
  );
}

function WithCornerRedDot({
  show,
  title,
  children,
  dotClassName,
}: {
  show: boolean;
  title: string;
  children: ReactNode;
  dotClassName?: string;
}) {
  return (
    <span className="relative inline-flex">
      {children}
      {show ? <CornerRedDot title={title} className={dotClassName} /> : null}
    </span>
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
  const chatStatusUiVariant = useChatStatusUiVariant();
  const searchParams = useSearchParams();
  const debugActivity = (searchParams?.get("debugActivity") || "").toString().trim() === "1";
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

  // Функція для отримання ОДНОГО найважливішого трігера з масиву ключів
  const getTriggerDescription = (activityKeys: string[]): string => {
    if (!activityKeys || activityKeys.length === 0) return '';
    
    const triggerMap: Record<string, string> = {
      message: 'Нове повідомлення',
      paidServiceDate: 'Запис на платну послугу',
      paidServiceAttended: 'Відвідування платної послуги',
      paidServiceCancelled: 'Скасування платної послуги',
      paidServiceTotalCost: 'Зміна вартості платної послуги',
      consultationBookingDate: 'Запис на консультацію',
      consultationAttended: 'Відвідування консультації',
      consultationCancelled: 'Скасування консультації',
    };
    
    // Пріоритети трігерів (вищий номер = вищий пріоритет)
    const priority: Record<string, number> = {
      message: 10, // Найважливіший
      paidServiceDate: 8,
      consultationBookingDate: 8,
      paidServiceAttended: 6,
      consultationAttended: 6,
      paidServiceCancelled: 5,
      consultationCancelled: 5,
      paidServiceTotalCost: 4,
    };
    
    // Фільтруємо тільки відомі ключі та знаходимо найважливіший
    const validKeys = activityKeys.filter(key => triggerMap[key]);
    if (validKeys.length === 0) return '';
    
    // Якщо один ключ - повертаємо його
    if (validKeys.length === 1) {
      return triggerMap[validKeys[0]];
    }
    
    // Якщо кілька ключів - повертаємо найважливіший за пріоритетом
    const sortedByPriority = validKeys.sort((a, b) => {
      const priorityA = priority[a] || 0;
      const priorityB = priority[b] || 0;
      return priorityB - priorityA; // Вищий пріоритет спочатку
    });
    
    return triggerMap[sortedByPriority[0]];
  };

  // Форматування дати та часу для lastActivityAt
  const formatActivityDate = (dateStr?: string): string => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = String(date.getFullYear()).slice(-2);
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${day}.${month}.${year} ${hours}:${minutes}`;
    } catch {
      return '';
    }
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
              ...(u.chatStatusAnchorMessageId !== undefined
                ? { chatStatusAnchorMessageId: u.chatStatusAnchorMessageId ?? undefined }
                : {}),
              ...(u.chatStatusAnchorMessageReceivedAt !== undefined
                ? { chatStatusAnchorMessageReceivedAt: u.chatStatusAnchorMessageReceivedAt ?? undefined }
                : {}),
              ...(u.chatStatusAnchorSetAt !== undefined
                ? { chatStatusAnchorSetAt: u.chatStatusAnchorSetAt ?? undefined }
                : {}),
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
              ...(u.chatStatusAnchorMessageId !== undefined
                ? { chatStatusAnchorMessageId: u.chatStatusAnchorMessageId ?? undefined }
                : {}),
              ...(u.chatStatusAnchorMessageReceivedAt !== undefined
                ? { chatStatusAnchorMessageReceivedAt: u.chatStatusAnchorMessageReceivedAt ?? undefined }
                : {}),
              ...(u.chatStatusAnchorSetAt !== undefined
                ? { chatStatusAnchorSetAt: u.chatStatusAnchorSetAt ?? undefined }
                : {}),
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
                {/* Продажі */}
                <col style={{ width: 92 }} />
                {/* Днів з останнього візиту */}
                <col style={{ width: 56 }} />
                {/* Переписка */}
                <col style={{ width: 120 }} />
                {/* Стан */}
                <col style={{ width: 96 }} />
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
                  <th
                    className="px-1 sm:px-1 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20 w-[56px] min-w-[56px] max-w-[56px] text-center"
                    title="Днів з останнього візиту (Altegio)"
                  >
                    Днів
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20 w-[120px] min-w-[120px]">
                    Переписка
                  </th>
                  <th className="px-1 sm:px-1 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20 text-right w-[96px] min-w-[96px]">
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
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">
                    Телефон
                  </th>
                  <th className="px-1 sm:px-2 py-2 text-xs font-semibold bg-base-200 sticky top-0 z-20">Дії</th>
                </tr>
              </thead>
              <tbody>
                {uniqueClients.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-center py-8 text-gray-500">
                      Немає клієнтів
                    </td>
                  </tr>
                ) : (
                  (() => {
                    // Визначаємо індекс першого сьогоднішнього клієнта (по хронології - найстаріший сьогодні)
                    const kyivDayFmtRow = new Intl.DateTimeFormat('en-CA', {
                      timeZone: 'Europe/Kyiv',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    });
                    const todayKyivDayRow = kyivDayFmtRow.format(new Date());
                    const dateField = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
                    let firstTodayIndex = -1;
                    let oldestTodayTime = Infinity;
                    
                    // Знаходимо найстаріший сьогоднішній клієнт (найменший час)
                    uniqueClients.forEach((client, idx) => {
                      const clientDate = client[dateField];
                      if (clientDate) {
                        const clientKyivDay = kyivDayFmtRow.format(new Date(clientDate));
                        if (clientKyivDay === todayKyivDayRow) {
                          const clientTime = new Date(clientDate).getTime();
                          if (clientTime < oldestTodayTime) {
                            oldestTodayTime = clientTime;
                            firstTodayIndex = idx;
                          }
                        }
                      }
                    });

                    return uniqueClients.map((client, index) => {
                    const activityKeys = client.lastActivityKeys ?? [];
                    const hasActivity = (k: string) => activityKeys.includes(k);
                    const hasPrefix = (p: string) => activityKeys.some((k) => k.startsWith(p));

                    const showMessageDot = hasActivity('message');
                    const showPaidDot = hasPrefix('paidService');
                    const showConsultDot = hasPrefix('consultation');
                    const showMasterDot = Boolean(
                      hasActivity('masterId') ||
                        hasPrefix('serviceMaster') ||
                        hasPrefix('consultationMaster')
                    );
                    const paidCostChanged = hasActivity('paidServiceTotalCost');
                    const paidAttendanceChanged = Boolean(hasActivity('paidServiceAttended') || hasActivity('paidServiceCancelled'));
                    const paidDateChanged = Boolean(hasActivity('paidServiceDate'));
                    const consultMasterChanged = hasPrefix('consultationMaster');
                    const consultAttendanceChanged = Boolean(
                      hasActivity('consultationAttended') || hasActivity('consultationCancelled')
                    );
                    const consultDateChanged = Boolean(hasActivity('consultationBookingDate'));
                    const kyivDayFmtRow = new Intl.DateTimeFormat('en-CA', {
                      timeZone: 'Europe/Kyiv',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    });
                    const todayKyivDayRow = kyivDayFmtRow.format(new Date());
                    const updatedKyivDayRow = client.updatedAt ? kyivDayFmtRow.format(new Date(client.updatedAt)) : '';

                    return (
                      <>
                        <tr key={client.id} className={index === firstTodayIndex ? "border-b-[3px] border-gray-300" : ""}>
                      <td className="px-1 sm:px-2 py-1 text-xs text-right">{index + 1}</td>
                      <td className="px-0 py-1 text-xs whitespace-nowrap">
                        <span className="flex flex-col leading-none">
                          <span
                            title={
                              (() => {
                                const keys = (client.lastActivityKeys ?? []).join(', ') || '-';
                                const at = (client.lastActivityAt || '').toString().trim() || '-';
                                if (!debugActivity) return `lastActivityAt: ${at}\nlastActivityKeys: ${keys}`;
                                return [
                                  `lastActivityAt: ${at}`,
                                  `lastActivityKeys: ${keys}`,
                                  `clientId: ${String(client.id).slice(0, 18)}`,
                                  `altegioClientId: ${client.altegioClientId ?? '-'}`,
                                  `state: ${client.state ?? '-'}`,
                                  `masterId: ${client.masterId ?? '-'}`,
                                ].join('\n');
                              })()
                            }
                          >
                            {client.updatedAt ? formatDateShortYear(client.updatedAt) : '-'}
                          </span>
                          {debugActivity ? (
                            <span className="mt-0.5 text-[10px] leading-none opacity-70 max-w-[120px] truncate">
                              keys: {(client.lastActivityKeys ?? []).join(', ') || '-'}
                            </span>
                          ) : null}
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
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
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
                            const typeBadgeTitleWithId = isClientType
                              ? `Altegio ID: ${client.altegioClientId}`
                              : typeBadgeTitle;
                            // debug logs removed
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
                              // Активний режим: sortBy === 'updatedAt' && sortOrder === 'desc'
                              const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
                              // Формуємо tooltip з інформацією про трігер (тільки для активного режиму)
                              let tooltipText = `${typeBadgeTitleWithId}\nВідкрити в Altegio (Клієнтська база)`;
                              if (isActiveMode) {
                                // Перевіряємо, чи є lastActivityKeys
                                if (client.lastActivityKeys && Array.isArray(client.lastActivityKeys) && client.lastActivityKeys.length > 0) {
                                  const triggerDesc = getTriggerDescription(client.lastActivityKeys);
                                  if (triggerDesc) {
                                    const activityDate = formatActivityDate(client.lastActivityAt);
                                    tooltipText += `\n\nТрігер: ${triggerDesc}`;
                                    if (activityDate) {
                                      tooltipText += `\nДата: ${activityDate}`;
                                    }
                                  }
                                  // Якщо getTriggerDescription повернув порожній рядок - нічого не показуємо
                                }
                                // Якщо lastActivityKeys відсутні або порожні - нічого не показуємо
                              }
                              const typeBadge = isClientType ? (
                                <a
                                  href={altegioUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 hover:opacity-80 transition-opacity"
                                  title={tooltipText}
                                  aria-label={`${typeBadgeTitleWithId}. Відкрити в Altegio`}
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
                            // Активний режим: sortBy === 'updatedAt' && sortOrder === 'desc'
                            const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
                            // Формуємо tooltip з інформацією про трігер (тільки для активного режиму)
                            let tooltipText = `${typeBadgeTitleWithId}\nВідкрити в Altegio (Клієнтська база)`;
                            if (isActiveMode) {
                              // Перевіряємо, чи є lastActivityKeys
                              if (client.lastActivityKeys && Array.isArray(client.lastActivityKeys) && client.lastActivityKeys.length > 0) {
                                const triggerDesc = getTriggerDescription(client.lastActivityKeys);
                                if (triggerDesc) {
                                  const activityDate = formatActivityDate(client.lastActivityAt);
                                  tooltipText += `\n\nТрігер: ${triggerDesc}`;
                                  if (activityDate) {
                                    tooltipText += `\nДата: ${activityDate}`;
                                  }
                                }
                                // Якщо getTriggerDescription повернув порожній рядок - нічого не показуємо
                              }
                              // Якщо lastActivityKeys відсутні або порожні - нічого не показуємо
                            }
                            const typeBadge = isClientType ? (
                              <a
                                href={altegioUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 hover:opacity-80 transition-opacity"
                                title={tooltipText}
                                aria-label={`${typeBadgeTitleWithId}. Відкрити в Altegio`}
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
                      {/* Днів з останнього візиту (після “Продажі”) */}
                      <td className="px-1 sm:px-1 py-1 text-xs whitespace-nowrap w-[56px] min-w-[56px] max-w-[56px] text-center tabular-nums">
                        {(() => {
                          const raw = (client as any).daysSinceLastVisit;
                          const hasDays = typeof raw === "number" && Number.isFinite(raw);
                          const days = hasDays ? (raw as number) : null;
                          const lastVisitAt = (client as any).lastVisitAt;

                          const cls = (() => {
                            if (!hasDays) return "bg-gray-200 text-gray-900";
                            if (days! <= 60) return "bg-gray-200 text-gray-900";
                            if (days! <= 90) return "bg-amber-200 text-amber-900";
                            return "bg-red-200 text-red-900";
                          })();

                          // Формуємо tooltip з датою останнього візиту
                          let tooltipText = "";
                          if (hasDays) {
                            tooltipText = `Днів з останнього візиту: ${days}`;
                            if (lastVisitAt) {
                              const formattedDate = formatDate(lastVisitAt);
                              tooltipText += `\nДата останнього візиту: ${formattedDate}`;
                            }
                          } else {
                            tooltipText = "Днів з останнього візиту: -";
                          }

                          return (
                            <span
                              className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums text-[12px] font-normal leading-none ${cls}`}
                              title={tooltipText}
                            >
                              {hasDays ? days : "-"}
                            </span>
                          );
                        })()}
                      </td>
                      {/* Переписка: число повідомлень (клік → історія) + текст-статус */}
                      <td
                        className={
                          chatStatusUiVariant === 'v2'
                            ? "px-1 sm:px-2 py-1 text-xs whitespace-normal w-[120px] min-w-[120px]"
                            : "px-1 sm:px-2 py-1 text-xs whitespace-nowrap w-[120px] min-w-[120px] overflow-hidden"
                        }
                      >
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

                          // debug logs removed
                            
                          // Фон лічильника НЕ залежить від статусу:
                          // - сірий завжди
                          // - голубий тільки якщо зʼявились нові
                          // НОВЕ ПРАВИЛО:
                          // - якщо кількість повідомлень = 0 → сірий фон
                          // - якщо статус НЕ встановлено → голубий
                          // - якщо статус встановлено і нових нема → сірий
                          // - якщо є нові → голубий (незалежно від статусу)
                          // Ідентичний “телеграмний” голубий (hex), щоб вигляд був як на скріні
                          const countClass =
                            total === 0
                              ? 'bg-gray-200 text-gray-900'
                              : needs || !hasStatus
                              ? 'bg-[#2AABEE] text-white'
                              : 'bg-gray-200 text-gray-900';

                              return (
                            <div className="flex items-center gap-2 min-w-0">
                                <button
                                className={`relative inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums hover:opacity-80 transition-opacity ${countClass} text-[12px] font-normal leading-none`}
                                onClick={() => setMessagesHistoryClient(client)}
                                title={needs ? 'Є нові повідомлення — відкрити історію' : 'Відкрити історію повідомлень'}
                                type="button"
                                >
                                {total}
                                {needs ? (
                                  <CornerRedDot title="Є нові вхідні повідомлення" />
                                ) : null}
                                </button>

                              {showStatus ? (
                                <span
                                  className={
                                    chatStatusUiVariant === 'v2'
                                      ? 'inline-flex min-w-0 max-w-[92px] items-start rounded-full px-2 py-0.5 text-[11px] font-normal leading-[1.05]'
                                      : 'inline-flex min-w-0 max-w-[78px] items-center rounded-full px-2 py-0.5 text-[11px] font-normal leading-none overflow-hidden'
                                  }
                                  title={statusNameRaw}
                                  style={{
                                    backgroundColor: badgeCfg.bg,
                                    color: badgeCfg.fg,
                                  }}
                                >
                                  {chatStatusUiVariant === 'v2' ? (
                                    <span
                                      className="min-w-0 break-words overflow-hidden"
                                      style={{
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                      }}
                                    >
                                      {statusNameRaw}
                                    </span>
                                  ) : (
                                    <span className="overflow-hidden whitespace-nowrap text-clip">
                                      {statusNameRaw}
                                    </span>
                                  )}
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-1 sm:px-1 py-1 text-xs whitespace-nowrap text-right w-[96px] min-w-[96px]">
                        {(() => {
                          const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
                            timeZone: 'Europe/Kyiv',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          });
                          const todayKyivDay = kyivDayFmt.format(new Date()); // YYYY-MM-DD

                          const parseMaybeIsoDate = (raw: any): Date | null => {
                            if (!raw) return null;
                            const dateValue = typeof raw === 'string' ? raw.trim() : String(raw);
                            const isoDateMatch = dateValue.match(
                              /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/
                            );
                            const d = new Date(isoDateMatch ? isoDateMatch[0] : dateValue);
                            return isNaN(d.getTime()) ? null : d;
                          };

                          // Консультація (календар) — привʼязуємо до consultationBookingDate
                          const consultDate = parseMaybeIsoDate(client.consultationBookingDate);
                          const consultKyivDay = consultDate ? kyivDayFmt.format(consultDate) : null;
                          const consultIsActive = Boolean(consultKyivDay && consultKyivDay >= todayKyivDay);

                          // Платна послуга (нарощування/інші) — привʼязуємо до paidServiceDate
                          const paidDate = client.paidServiceDate ? new Date(client.paidServiceDate) : null;
                          const paidKyivDay = paidDate && !isNaN(paidDate.getTime()) ? kyivDayFmt.format(paidDate) : null;
                          const paidIsActive = Boolean(paidKyivDay && paidKyivDay >= todayKyivDay);

                          // “Минуле/сьогодні” для послуги: якщо дата ≤ сьогодні (Kyiv) — замість іконки послуги показуємо
                          // або Перезапис (🔁), або відповідний статус (без залежності від ✅/❓/❌ і навіть якщо 🚫).
                          const consultPastOrToday = Boolean(consultKyivDay && consultKyivDay <= todayKyivDay);
                          const paidPastOrToday = Boolean(paidKyivDay && paidKyivDay <= todayKyivDay);

                          // “Перезапис” — використовуємо існуючу логіку з колонки дат
                          const hasPaidReschedule = Boolean((client as any).paidServiceIsRebooking);
                          const hasConsultReschedule =
                            (typeof client.consultationAttemptNumber === 'number' && client.consultationAttemptNumber >= 2) ||
                            (Array.isArray(client.last5States) &&
                              client.last5States.some((s: any) => (s?.state || '') === 'consultation-rescheduled'));
                              
                            
                          // 2) Нормальний режим: показуємо ТІЛЬКИ 1 значок у колонці “Стан”.
                          // Пріоритет: платний запис (якщо актуальний) → інакше консультація (якщо актуальна).
                          // Без 🆕/💸 — це створювало “NEW” і візуальний хаос.
                          // Спрощена логіка: якщо є платна послуга - показуємо її стан, якщо немає - показуємо стан консультації
                          
                          // Перевірка строго минулих дат (не включаючи сьогодні)
                          const isPaidPast = Boolean(paidKyivDay && paidKyivDay < todayKyivDay);
                          const isConsultPast = Boolean(consultKyivDay && consultKyivDay < todayKyivDay);

                          // Нова логіка відображення стану з пріоритетами:
                          
                          // 1. Червона дата запису (минула) + перезапис
                          if (client.paidServiceDate && isPaidPast) {
                            if ((client as any).paidServiceIsRebooking) {
                              return (
                                <div className="flex items-center justify-end">
                                  <span className="inline-flex items-center justify-center">
                                    <span 
                                      title="Є перезапис" 
                                      className="text-[24px] leading-none inline-flex items-center justify-center"
                                    >
                                      🔁
                                    </span>
                                  </span>
                                </div>
                              );
                            } else {
                              return (
                                <div className="flex items-center justify-end">
                                  <span className="inline-flex items-center justify-center">
                                    <span 
                                      title="Немає перезапису" 
                                      className="text-[24px] leading-none inline-flex items-center justify-center"
                                    >
                                      ⚠️
                                    </span>
                                  </span>
                                </div>
                              );
                            }
                          }

                          // 2. Успішна консультація без запису (Не продали)
                          if (client.consultationAttended === true && isConsultPast && (!client.paidServiceDate || !client.signedUpForPaidService)) {
                            return (
                              <div className="flex items-center justify-end">
                                <span className="inline-flex items-center justify-center">
                                  <span 
                                    title="Не продали" 
                                    className="text-[24px] leading-none inline-flex items-center justify-center"
                                  >
                                    💔
                                  </span>
                                </span>
                              </div>
                            );
                          }

                          // 3. Attendance = -1 для минулої дати (no-show)
                          if (client.paidServiceDate && isPaidPast && client.paidServiceAttended === false) {
                            return (
                              <div className="flex items-center justify-end">
                                <span className="inline-flex items-center justify-center">
                                  <span 
                                    title="Клієнтка не з'явилася на платну послугу" 
                                    className="text-[24px] leading-none inline-flex items-center justify-center"
                                  >
                                    ❌
                                  </span>
                                </span>
                              </div>
                            );
                          }

                          // 4. Attendance = -1 для майбутньої дати або скасовано
                          if (client.paidServiceDate && !isPaidPast && (client.paidServiceAttended === false || client.paidServiceCancelled)) {
                            return (
                              <div className="flex items-center justify-end">
                                <span className="inline-flex items-center justify-center">
                                  <span 
                                    title="Скасовано" 
                                    className="text-[24px] leading-none inline-flex items-center justify-center"
                                  >
                                    🚫
                                  </span>
                                </span>
                              </div>
                            );
                          }

                          // Якщо є платна послуга - показуємо її стан
                          if (client.paidServiceDate) {
                            const serviceState =
                              client.state === 'hair-extension' || client.state === 'other-services' ? client.state : null;
                            if (serviceState) {
                              return (
                                <div className="flex items-center justify-end">
                                  <span className="inline-flex items-center justify-center">
                                    <button
                                      type="button"
                                      className="hover:opacity-70 transition-opacity"
                                      title={serviceState === 'hair-extension' ? 'Нарощування волосся' : 'Інші послуги'}
                                      onClick={() => setStateHistoryClient(client)}
                                    >
                                      <StateIcon state={serviceState} size={28} />
                                    </button>
                                  </span>
                                </div>
                              );
                            }
                            // Платна послуга (тип невідомий)
                            return (
                              <div className="flex items-center justify-end">
                                <span className="inline-flex items-center justify-center">
                                  <span 
                                    title="Платна послуга (тип невідомий)" 
                                    className="text-[24px] leading-none inline-flex items-center justify-center"
                                    style={{ transform: 'rotate(180deg)' }}
                                  >
                                    ✂️
                                  </span>
                                </span>
                              </div>
                            );
                          }

                          // Якщо немає платної послуги, але є консультація - показуємо стан консультації
                          if (client.consultationBookingDate) {
                            return (
                              <div className="flex items-center justify-end">
                                <span className="inline-flex items-center justify-center">
                                  <button
                                    type="button"
                                    className="hover:opacity-70 transition-opacity"
                                    title="Консультація"
                                    onClick={() => setStateHistoryClient(client)}
                                  >
                                    <StateIcon state="consultation-booked" size={28} />
                                  </button>
                                </span>
                              </div>
                            );
                          }

                          // Якщо немає ні платної послуги, ні консультації - показуємо client.state
                          if (client.state) {
                            return (
                              <div className="flex items-center justify-end">
                                <span className="inline-flex items-center justify-center">
                                  <StateIcon state={client.state} size={28} />
                                </span>
                              </div>
                            );
                          }

                          return '';
                          })()}
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
                              const isToday = consultKyivDay === todayKyivDay;
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
                              // Правило:
                              // - ✅/❌/🚫 показуємо тільки для минулих дат (не для майбутніх!)
                              // - ⏳ показуємо у день консультації та для майбутніх, якщо attendance ще нема
                              // - ❓ показуємо лише з наступного дня (коли дата < сьогодні, Kyiv) і attendance ще нема
                              const attIconCls = "text-[14px] leading-none";
                              let attendanceIcon = null;
                              if (client.consultationCancelled) {
                                attendanceIcon = (
                                  <span className={`text-orange-600 ${attIconCls}`} title="Скасовано до дати консультації">
                                    🚫
                                  </span>
                                );
                              } else if (client.consultationAttended === true && isPast) {
                                // Зелена галочка тільки для минулих дат (клієнт не може прийти в майбутньому)
                                attendanceIcon = (
                                  <span className={`text-green-600 ${attIconCls}`} title="Клієнтка прийшла на консультацію">
                                    ✅
                                  </span>
                                );
                              } else if (client.consultationAttended === false && isPast) {
                                attendanceIcon = (
                                  <span className={`text-red-600 ${attIconCls}`} title="Клієнтка не з'явилася на консультацію">
                                    ❌
                                  </span>
                                );
                              } else if (isPast) {
                                attendanceIcon = (
                                  <span
                                    className={`text-gray-500 ${attIconCls}`}
                                    title="Немає підтвердження відвідування консультації (встановіть attendance в Altegio)"
                                  >
                                    ❓
                                  </span>
                                );
                              } else {
                                attendanceIcon = (
                                  <span className={`text-gray-700 ${attIconCls}`} title="Присутність: Очікується">
                                    ⏳
                                  </span>
                                );
                              }
                              
                              const baseTitle = isPast 
                                ? (isOnline ? "Минулий запис на онлайн-консультацію" : "Минулий запис на консультацію")
                                : (isOnline ? "Майбутній запис на онлайн-консультацію" : "Майбутній запис на консультацію");
                              const tooltipTitle = createdAtStr ? `${baseTitle}\nЗапис створено: ${createdAtStr}` : baseTitle;
                              
                              const consultMasterDotTitle = 'Тригер: змінився майстер консультації';
                              const consultAttendanceDotTitle = "Тригер: змінилась присутність консультації";
                              const consultDateDotTitle = 'Тригер: змінилась дата консультації';

                              const showDotOnConsultDate = Boolean(consultDateChanged && !attendanceIcon);
                          const consultHasAttendanceSignal = Boolean(
                            client.consultationCancelled ||
                              client.consultationAttended === true ||
                              client.consultationAttended === false
                          );
                          // Для ✅/❌/🚫: підсвічуємо тільки якщо змінилась присутність.
                          const showConsultAttendanceDotEffective = Boolean(
                            consultAttendanceChanged
                          );
                              // debug logs removed

                              return (
                                <span className="flex flex-col items-center">
                                  <span className="flex items-center gap-1">
                                    <button
                                      className={
                                        isToday
                                          ? "text-green-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                          : isPast
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
                                      <span className="inline-flex items-center">
                                        <span>
                                          {formattedDateStr} {isOnline ? "💻" : "📅"}
                                        </span>
                                        {showDotOnConsultDate ? (
                                          <span
                                            className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                            title={consultDateDotTitle}
                                          />
                                        ) : null}
                                      </span>
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
                                    {attendanceIcon ? (
                                      <WithCornerRedDot show={showConsultAttendanceDotEffective} title={consultAttendanceDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                        {attendanceIcon}
                                      </WithCornerRedDot>
                                    ) : null}
                                  </span>

                                  {(() => {
                                    const consultantFull = (client.consultationMasterName || '').toString().trim();
                                    const consultant = shortPersonName(consultantFull);
                                    if (!consultant) return (
                                      <span className="text-[10px] leading-none opacity-50 max-w-[220px] sm:max-w-[320px] truncate text-center">
                                        невідомо
                                      </span>
                                    );
                                    return (
                                      <span
                                        className="text-[10px] leading-none opacity-70 max-w-[220px] sm:max-w-[320px] truncate text-center"
                                        title={`Консультував: ${consultantFull}`}
                                      >
                                        <span className="inline-flex items-center">
                                          <span>{consultant}</span>
                                          {consultMasterChanged ? (
                                            <span
                                              className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                              title={consultMasterDotTitle}
                                            />
                                          ) : null}
                                        </span>
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
                            const isToday = paidKyivDay === todayKyivDay;
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
                            // Правило:
                            // - ✅/❌/🚫 показуємо тільки для минулих дат (не для майбутніх!)
                            // - ⏳ показуємо у день запису та для майбутніх, якщо attendance ще нема
                            // - ❓ показуємо лише з наступного дня (коли дата < сьогодні, Kyiv) і attendance ще нема
                            const attIconCls = "text-[14px] leading-none";
                            let attendanceIcon = null;
                            if (client.paidServiceCancelled) {
                              attendanceIcon = (
                                <span className={`text-orange-600 ${attIconCls}`} title="Скасовано до дати запису">
                                  🚫
                                </span>
                              );
                            } else if (client.paidServiceAttended === true && isPast) {
                              // Зелена галочка тільки для минулих дат (клієнт не може прийти в майбутньому)
                              attendanceIcon = (
                                <span className={`text-green-600 ${attIconCls}`} title="Клієнтка прийшла на платну послугу">
                                  ✅
                                </span>
                              );
                            } else if (client.paidServiceAttended === false && isPast) {
                              attendanceIcon = (
                                <span className={`text-red-600 ${attIconCls}`} title="Клієнтка не з'явилася на платну послугу">
                                  ❌
                                </span>
                              );
                            } else if (isPast) {
                              attendanceIcon = (
                                <span
                                  className={`text-gray-500 ${attIconCls}`}
                                  title="Немає підтвердження відвідування платної послуги (встановіть attendance в Altegio)"
                                >
                                  ❓
                                </span>
                              );
                            } else {
                              attendanceIcon = (
                                <span className={`text-gray-700 ${attIconCls}`} title="Присутність: Очікується">
                                  ⏳
                                </span>
                              );
                            }

                            // pendingIcon більше не потрібен, бо ⏳ входить в attendanceIcon (сьогодні/майбутнє при null)
                            const pendingIcon = null;
                            
                            const baseTitle = isPast ? "Минулий запис на платну послугу" : "Майбутній запис на платну послугу";
                            const tooltipTitle = createdAtStr ? `${baseTitle}\nЗапис створено: ${createdAtStr}` : baseTitle;
                            
                            const paidDotTitle = 'Тригер: змінився запис';
                            // ВАЖЛИВО: "сума запису" (paidServiceTotalCost) — це текст, крапочку ставимо біля суми.
                            // Для attendance-іконки крапочку ставимо лише коли змінилась присутність/скасування.
                            const showDotOnPaidAttendance = Boolean(attendanceIcon && paidAttendanceChanged);
                            const showDotOnPaidPending = Boolean(!attendanceIcon && pendingIcon && paidAttendanceChanged);
                            const showDotOnPaidRebook = Boolean(
                              showPaidDot && !attendanceIcon && !pendingIcon && client.paidServiceIsRebooking
                            );
                            const showDotOnPaidDate = Boolean(
                              paidDateChanged && !attendanceIcon && !pendingIcon && !client.paidServiceIsRebooking
                            );
                            const paidHasAttendanceSignal = Boolean(
                              client.paidServiceCancelled ||
                                client.paidServiceAttended === true ||
                                client.paidServiceAttended === false
                            );
                            const showPaidAttendanceDotEffective = Boolean(
                              paidAttendanceChanged
                            );
                            const showPaidCostDot = Boolean(paidCostChanged);

                            return (
                              <span className="flex flex-col items-center">
                                <span className="flex items-center gap-1">
                                <button
                                  className={
                                    isToday
                                      ? "text-green-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                      : isPast
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
                                  <span className="inline-flex items-center">
                                    <span>{dateStr}</span>
                                    {showDotOnPaidDate ? (
                                      <span
                                        className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                        title={paidDotTitle}
                                      />
                                    ) : null}
                                  </span>
                                </button>
                                {pendingIcon ? (
                                  <WithCornerRedDot show={showDotOnPaidPending} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                    {pendingIcon}
                                  </WithCornerRedDot>
                                ) : null}
                                {client.paidServiceIsRebooking ? (
                                  <WithCornerRedDot show={showDotOnPaidRebook} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                    <span
                                      className="text-purple-700 text-[14px] leading-none"
                                      title={`Перезапис 🔁\nСтворено в день: ${client.paidServiceRebookFromKyivDay || '-'}\nАтрибутовано: ${shortPersonName(client.paidServiceRebookFromMasterName) || '-'}`}
                                    >
                                      🔁
                                    </span>
                                  </WithCornerRedDot>
                                ) : null}
                                {attendanceIcon ? (
                                  <WithCornerRedDot show={showPaidAttendanceDotEffective} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                    {attendanceIcon}
                                  </WithCornerRedDot>
                                ) : null}
                                </span>

                                {typeof client.paidServiceTotalCost === 'number' && client.paidServiceTotalCost > 0 ? (
                                  <span
                                    className="text-[10px] leading-none opacity-70 max-w-[220px] sm:max-w-[320px] truncate text-center"
                                    title={`Сума запису: ${formatUAHExact(client.paidServiceTotalCost)}`}
                                  >
                                    <span className="inline-flex items-center">
                                      <span>{formatUAHThousands(client.paidServiceTotalCost)}</span>
                                      {showPaidCostDot ? (
                                        <span
                                          className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                          title={'Тригер: змінилась сума запису'}
                                        />
                                      ) : null}
                                    </span>
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
                          // Колонка "Майстер":
                          // - Якщо є платний запис — показуємо майстра з Altegio (serviceMasterName)
                          // - Якщо serviceMasterName відсутній — показуємо відповідального (masterId) як fallback,
                          //   щоб тригер masterId мав “місце в UI” для крапочки.
                          const full = (client.serviceMasterName || '').trim();
                          const paidMasterName = shortPersonName(full);
                          const responsibleRaw =
                            client.masterId ? (masters.find((m) => m.id === client.masterId)?.name || '') : '';
                          const responsibleName = shortPersonName(responsibleRaw);

                          const showPaidMaster = Boolean(client.paidServiceDate && paidMasterName);
                          const showResponsibleMaster = Boolean(!showPaidMaster && responsibleName);

                          if (!showPaidMaster && !showResponsibleMaster) return '';

                          const shouldHighlightMaster =
                            client.consultationAttended === true && Boolean(client.paidServiceDate);
                          const highlightClass = shouldHighlightMaster
                            ? 'rounded-full px-2 py-0.5 bg-[#2AABEE] text-white'
                            : '';

                          const secondary = shortPersonName((client as any).serviceSecondaryMasterName);

                          const name = showPaidMaster ? paidMasterName : responsibleName;
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

                          // debug logs removed

                          return (
                            <span className="flex flex-col items-start leading-none">
                              {showPaidMaster ? (
                                <button
                                  type="button"
                                  className="font-medium hover:underline text-left"
                                  title={`${historyTitle}\n\nНатисніть, щоб відкрити повну історію`}
                                  onClick={() => setMasterHistoryClient(client)}
                                >
                                  <span className={`inline-flex items-center ${highlightClass}`}>
                                    <span>{name}</span>
                                    {showMasterDot ? (
                                      <span
                                        className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                        title="Тригер: змінився майстер"
                                      />
                                    ) : null}
                                  </span>
                                </button>
                              ) : (
                                <span className="font-medium text-left" title={`Відповідальний: ${name}`}>
                                  <span className={`inline-flex items-center ${highlightClass}`}>
                                    <span>{name}</span>
                                    {showMasterDot ? (
                                      <span
                                        className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                        title="Тригер: змінився майстер"
                                      />
                                    ) : null}
                                  </span>
                                </span>
                              )}
                              {secondary ? (
                                <span className="text-[10px] leading-none opacity-70">
                                  ({secondary})
                                </span>
                              ) : null}
                            </span>
                          );
                        })()}
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
                      </>
                    );
                  });
                  })()
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
