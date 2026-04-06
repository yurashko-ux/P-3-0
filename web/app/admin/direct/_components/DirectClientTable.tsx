// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { createPortal } from "react-dom";
import type { DirectClient, DirectStatus, DirectChatStatus, DirectCallStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";
import { StateHistoryModal } from "./StateHistoryModal";
import { MessagesHistoryModal } from "./MessagesHistoryModal";
import { BinotelCallHistoryModal } from "./BinotelCallHistoryModal";
import { BinotelCallsFilterDropdown } from "./BinotelCallsFilterDropdown";
import { InlineCallRecordingPlayer } from "./InlineCallRecordingPlayer";
import { ClientWebhooksModal } from "./ClientWebhooksModal";
import { RecordHistoryModal } from "./RecordHistoryModal";
import { MasterHistoryModal } from "./MasterHistoryModal";
import { useSearchParams } from "next/navigation";
import { ColumnFilterDropdown, type ClientTypeFilter } from "./ColumnFilterDropdown";
import { ActFilterDropdown } from "./ActFilterDropdown";
import { DaysFilterDropdown } from "./DaysFilterDropdown";
import { InstFilterDropdown } from "./InstFilterDropdown";
import { StateFilterDropdown } from "./StateFilterDropdown";
import { StatusFilterDropdown } from "./StatusFilterDropdown";
import { ConsultationFilterDropdown } from "./ConsultationFilterDropdown";
import { RecordFilterDropdown } from "./RecordFilterDropdown";
import { MasterFilterDropdown } from "./MasterFilterDropdown";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { isKyivCalendarDayEqualToReference } from "@/lib/direct-kyiv-today";
import { getColumnStyle, getStickyColumnStyle } from "./direct-client-table-column-layout";
import {
  formatDate,
  formatDateShortYear,
  formatDateDDMMYY,
  formatDateDDMMYYHHMM,
} from "./direct-client-table-formatters";
import { DirectClientTableRow } from "./DirectClientTableRow";
import {
  DirectClientTableRowProvider,
  type DirectClientTableRowContextValue,
} from "./direct-client-table-row-context";

/** Після цього порогу tbody віртуалізується (менше DOM при довгому списку). */
const VIRTUAL_TABLE_ROW_THRESHOLD = 32;

type ChatStatusUiVariant = "v1" | "v2";

type ColumnWidthMode = 'fixed' | 'min';

type ColumnWidthConfig = {
  number: { width: number; mode: ColumnWidthMode };
  act: { width: number; mode: ColumnWidthMode };
  avatar: { width: number; mode: ColumnWidthMode };
  name: { width: number; mode: ColumnWidthMode };
  sales: { width: number; mode: ColumnWidthMode };
  days: { width: number; mode: ColumnWidthMode };
  communication: { width: number; mode: ColumnWidthMode };
  inst: { width: number; mode: ColumnWidthMode };
  calls: { width: number; mode: ColumnWidthMode };
  callStatus: { width: number; mode: ColumnWidthMode };
  state: { width: number; mode: ColumnWidthMode };
  consultation: { width: number; mode: ColumnWidthMode };
  record: { width: number; mode: ColumnWidthMode };
  master: { width: number; mode: ColumnWidthMode };
  phone: { width: number; mode: ColumnWidthMode };
  actions: { width: number; mode: ColumnWidthMode };
};

/** Мінімум ширини колонки «Комунікація» (colgroup): заголовок не наїжджає на «Статус» */
const COMMUNICATION_COLUMN_MIN_WIDTH_PX = 100;
/** Мінімум для Inst / Дзвінки: бейдж + лічильник + дата / іконки Binotel + ▶ (colgroup table-layout:fixed) */
const INST_COLUMN_MIN_WIDTH_PX = 96;
const CALLS_COLUMN_MIN_WIDTH_PX = 96;
/** Мінімальна висота комірки до завантаження communication-meta — менший стрибок рядка */
const INST_CALLS_CELL_MIN_HEIGHT = '2.75rem';

const DEFAULT_COLUMN_CONFIG: ColumnWidthConfig = {
  number: { width: 16, mode: 'min' },
  act: { width: 40, mode: 'min' },
  avatar: { width: 44, mode: 'min' },
  name: { width: 100, mode: 'min' },
  sales: { width: 50, mode: 'min' },
  days: { width: 40, mode: 'min' },
  /** Було 52px — заголовок «Комунікація» наїжджав на «Статус» (виглядало як «Комунікаціяst») */
  communication: { width: 104, mode: 'min' },
  inst: { width: INST_COLUMN_MIN_WIDTH_PX, mode: 'min' },
  calls: { width: CALLS_COLUMN_MIN_WIDTH_PX, mode: 'min' },
  callStatus: { width: 200, mode: 'min' },
  state: { width: 30, mode: 'min' },
  consultation: { width: 110, mode: 'min' },
  record: { width: 100, mode: 'min' },
  master: { width: 60, mode: 'min' },
  phone: { width: 80, mode: 'min' },
  actions: { width: 44, mode: 'min' },
};

/** Порядок колонок: для вимірювання з body, header colgroup і розширення в майбутньому */
const COLUMN_KEYS = [
  'number', 'act', 'avatar', 'name', 'sales', 'days', 'communication', 'inst', 'calls', 'callStatus', 'state',
  'consultation', 'record', 'master', 'phone', 'actions',
] as const;
type ColumnKey = typeof COLUMN_KEYS[number];

// Старий тип для міграції
type OldColumnWidths = {
  number?: number;
  act?: number;
  avatar?: number;
  name?: number;
  sales?: number;
  days?: number;
  communication?: number;
  inst?: number;
  calls?: number;
  callStatus?: number;
  state?: number;
  consultation?: number;
  record?: number;
  master?: number;
  phone?: number;
  actions?: number;
};

// Функція для синхронного завантаження конфігурації з localStorage (використовується в useState ініціалізації)
function loadColumnWidthConfigFromStorage(): ColumnWidthConfig | null {
  if (typeof window === "undefined") return null;
  const key = "direct:tableColumnWidths";
  try {
    const saved = window.localStorage.getItem(key);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    
    // Міграція: якщо старий формат (просто числа), конвертуємо в новий
    if (parsed && typeof parsed.number === 'number') {
      const oldWidths = parsed as OldColumnWidths;
      const migrated: ColumnWidthConfig = {
        number: { width: Math.max(10, Math.min(500, oldWidths.number || DEFAULT_COLUMN_CONFIG.number.width)), mode: 'min' },
        act: { width: Math.max(10, Math.min(500, oldWidths.act || DEFAULT_COLUMN_CONFIG.act.width)), mode: 'min' },
        avatar: { width: Math.max(10, Math.min(500, oldWidths.avatar || DEFAULT_COLUMN_CONFIG.avatar.width)), mode: 'min' },
        name: { width: Math.max(10, Math.min(500, oldWidths.name || DEFAULT_COLUMN_CONFIG.name.width)), mode: 'min' },
        sales: { width: Math.max(10, Math.min(500, oldWidths.sales || DEFAULT_COLUMN_CONFIG.sales.width)), mode: 'min' },
        days: { width: Math.max(10, Math.min(500, oldWidths.days || DEFAULT_COLUMN_CONFIG.days.width)), mode: 'min' },
        communication: {
          width: Math.max(
            COMMUNICATION_COLUMN_MIN_WIDTH_PX,
            Math.min(500, oldWidths.communication ?? DEFAULT_COLUMN_CONFIG.communication.width)
          ),
          mode: 'min',
        },
        inst: {
          width: Math.max(
            INST_COLUMN_MIN_WIDTH_PX,
            Math.min(500, oldWidths.inst ?? DEFAULT_COLUMN_CONFIG.inst.width)
          ),
          mode: 'min',
        },
        calls: {
          width: Math.max(
            CALLS_COLUMN_MIN_WIDTH_PX,
            Math.min(500, oldWidths.calls ?? DEFAULT_COLUMN_CONFIG.calls.width)
          ),
          mode: 'min',
        },
        callStatus: { width: Math.max(10, Math.min(500, oldWidths.callStatus ?? DEFAULT_COLUMN_CONFIG.callStatus.width)), mode: 'min' },
        state: { width: Math.max(10, Math.min(500, oldWidths.state || DEFAULT_COLUMN_CONFIG.state.width)), mode: 'min' },
        consultation: { width: Math.max(10, Math.min(500, oldWidths.consultation || DEFAULT_COLUMN_CONFIG.consultation.width)), mode: 'min' },
        record: { width: Math.max(10, Math.min(500, oldWidths.record || DEFAULT_COLUMN_CONFIG.record.width)), mode: 'min' },
        master: { width: Math.max(10, Math.min(500, oldWidths.master || DEFAULT_COLUMN_CONFIG.master.width)), mode: 'min' },
        phone: { width: Math.max(10, Math.min(500, oldWidths.phone || DEFAULT_COLUMN_CONFIG.phone.width)), mode: 'min' },
        actions: { width: Math.max(10, Math.min(500, oldWidths.actions || DEFAULT_COLUMN_CONFIG.actions.width)), mode: 'min' },
      };
      // Зберігаємо мігровані дані
      window.localStorage.setItem(key, JSON.stringify(migrated));
      return migrated;
    } else if (parsed && parsed.number && typeof parsed.number === 'object') {
      // Новий формат
      const validated: ColumnWidthConfig = {
        number: {
          width: Math.max(10, Math.min(500, parsed.number?.width || DEFAULT_COLUMN_CONFIG.number.width)),
          mode: parsed.number?.mode === 'fixed' ? 'fixed' : 'min'
        },
        act: {
          width: Math.max(10, Math.min(500, parsed.act?.width || DEFAULT_COLUMN_CONFIG.act.width)),
          mode: parsed.act?.mode === 'fixed' ? 'fixed' : 'min'
        },
        avatar: {
          width: Math.max(10, Math.min(500, parsed.avatar?.width || DEFAULT_COLUMN_CONFIG.avatar.width)),
          mode: parsed.avatar?.mode === 'fixed' ? 'fixed' : 'min'
        },
        name: {
          width: Math.max(10, Math.min(500, parsed.name?.width || DEFAULT_COLUMN_CONFIG.name.width)),
          mode: parsed.name?.mode === 'fixed' ? 'fixed' : 'min'
        },
        sales: {
          width: Math.max(10, Math.min(500, parsed.sales?.width || DEFAULT_COLUMN_CONFIG.sales.width)),
          mode: parsed.sales?.mode === 'fixed' ? 'fixed' : 'min'
        },
        days: {
          width: Math.max(10, Math.min(500, parsed.days?.width || DEFAULT_COLUMN_CONFIG.days.width)),
          mode: parsed.days?.mode === 'fixed' ? 'fixed' : 'min'
        },
        communication: {
          width: Math.max(
            COMMUNICATION_COLUMN_MIN_WIDTH_PX,
            Math.min(500, parsed.communication?.width ?? DEFAULT_COLUMN_CONFIG.communication.width)
          ),
          mode: parsed.communication?.mode === 'fixed' ? 'fixed' : 'min'
        },
        inst: {
          width: Math.max(
            INST_COLUMN_MIN_WIDTH_PX,
            Math.min(500, parsed.inst?.width ?? DEFAULT_COLUMN_CONFIG.inst.width)
          ),
          mode: parsed.inst?.mode === 'fixed' ? 'fixed' : 'min',
        },
        calls: {
          width: Math.max(
            CALLS_COLUMN_MIN_WIDTH_PX,
            Math.min(500, parsed.calls?.width ?? DEFAULT_COLUMN_CONFIG.calls.width)
          ),
          mode: parsed.calls?.mode === 'fixed' ? 'fixed' : 'min',
        },
        callStatus: {
          width: Math.max(10, Math.min(500, parsed.callStatus?.width ?? DEFAULT_COLUMN_CONFIG.callStatus.width)),
          mode: parsed.callStatus?.mode === 'fixed' ? 'fixed' : 'min'
        },
        state: {
          width: Math.max(10, Math.min(500, parsed.state?.width || DEFAULT_COLUMN_CONFIG.state.width)),
          mode: parsed.state?.mode === 'fixed' ? 'fixed' : 'min'
        },
        consultation: {
          width: Math.max(10, Math.min(500, parsed.consultation?.width || DEFAULT_COLUMN_CONFIG.consultation.width)),
          mode: parsed.consultation?.mode === 'fixed' ? 'fixed' : 'min'
        },
        record: {
          width: Math.max(10, Math.min(500, parsed.record?.width || DEFAULT_COLUMN_CONFIG.record.width)),
          mode: parsed.record?.mode === 'fixed' ? 'fixed' : 'min'
        },
        master: {
          width: Math.max(10, Math.min(500, parsed.master?.width || DEFAULT_COLUMN_CONFIG.master.width)),
          mode: parsed.master?.mode === 'fixed' ? 'fixed' : 'min'
        },
        phone: {
          width: Math.max(10, Math.min(500, parsed.phone?.width || DEFAULT_COLUMN_CONFIG.phone.width)),
          mode: parsed.phone?.mode === 'fixed' ? 'fixed' : 'min'
        },
        actions: {
          width: Math.max(10, Math.min(500, parsed.actions?.width || DEFAULT_COLUMN_CONFIG.actions.width)),
          mode: parsed.actions?.mode === 'fixed' ? 'fixed' : 'min'
        },
      };
      if (
        (parsed.inst?.width ?? 0) < INST_COLUMN_MIN_WIDTH_PX ||
        (parsed.calls?.width ?? 0) < CALLS_COLUMN_MIN_WIDTH_PX
      ) {
        try {
          window.localStorage.setItem(key, JSON.stringify(validated));
        } catch {
          /* ignore */
        }
      }
      return validated;
    }
  } catch {
    // ignore
  }
  return null;
}

function useColumnWidthConfig(): [ColumnWidthConfig, (config: ColumnWidthConfig) => void] {
  // Використовуємо функцію ініціалізації для синхронного завантаження з localStorage
  // Це вирішує проблему hydration mismatch - конфігурація завантажується одразу на клієнті
  const [config, setConfig] = useState<ColumnWidthConfig>(() => {
    const loaded = loadColumnWidthConfigFromStorage();
    return loaded || DEFAULT_COLUMN_CONFIG;
  });

  // useEffect для завантаження конфігурації після монтування (на випадок, якщо під час SSR вона не завантажилася)
  // Використовуємо useLayoutEffect для синхронного завантаження перед рендерингом
  useEffect(() => {
    if (typeof window === "undefined") return;
    const loaded = loadColumnWidthConfigFromStorage();
    if (loaded) {
      // Завжди завантажуємо конфігурацію з localStorage після монтування
      // Це гарантує, що після hydration конфігурація буде правильною
      setConfig(loaded);
    }
  }, []); // Виконується тільки один раз після монтування

  // useEffect для синхронізації при зміні localStorage з іншого табу/вікна
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "direct:tableColumnWidths";
    
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        const loaded = loadColumnWidthConfigFromStorage();
        if (loaded) {
          setConfig(loaded);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const saveConfig = (newConfig: ColumnWidthConfig) => {
    setConfig(newConfig);
    if (typeof window === "undefined") return;
    const key = "direct:tableColumnWidths";
    try {
      window.localStorage.setItem(key, JSON.stringify(newConfig));
    } catch {
      // ignore
    }
  };

  return [config, saveConfig];
}

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

export type DirectFilters = {
  statusId: string;
  statusIds: string[];
  masterId: string;
  source: string;
  search: string;
  hasAppointment: string;
  clientType: string[];
  act: { mode: 'current_month' | 'year_month' | null; year?: string; month?: string };
  days: 'none' | 'growing' | 'grown' | 'overgrown' | null;
  inst: string[];
  state: string[];
  consultation: {
    hasConsultation: boolean | null;
    created: { mode: 'current_month' | 'year_month' | null; year?: string; month?: string };
    createdPreset: 'past' | 'today' | 'future' | null;
    appointed: { mode: 'current_month' | 'year_month' | null; year?: string; month?: string };
    appointedPreset: 'past' | 'today' | 'future' | null;
    attendance: 'attended' | 'no_show' | 'cancelled' | null;
    type: 'consultation' | 'online' | null;
    masterIds: string[];
  };
  record: {
    hasRecord: boolean | null;
    newClient: boolean | null;
    created: { mode: 'current_month' | 'year_month' | null; year?: string; month?: string };
    createdPreset: 'past' | 'today' | 'future' | null;
    appointed: { mode: 'current_month' | 'year_month' | null; year?: string; month?: string };
    appointedPreset: 'past' | 'today' | 'future' | null;
    client: 'attended' | 'no_show' | 'cancelled' | 'pending' | 'rebook' | 'unknown' | null;
    sum: 'lt_10k' | 'gt_10k' | null;
  };
  master: { hands: 2 | 4 | 6 | null; primaryMasterIds: string[]; secondaryMasterIds: string[] };
  /** Фільтр дзвінків Binotel: direction + outcome + onlyNew доповнюють один одного (AND) */
  binotelCalls?: { direction: ('incoming' | 'outgoing')[]; outcome: ('success' | 'fail')[]; onlyNew?: boolean };
  /** Режим об'єднання фільтрів колонок (Консультація, Запис, Майстер): 'or' — об'єднання (будь-який), 'and' — взаємообмежуючі (всі) */
  columnFilterMode: 'or' | 'and';
};

type DirectClientTableProps = {
  clients: DirectClient[];
  totalClientsCount?: number;
  statuses: DirectStatus[];
  /** Кількість по статусах з усієї бази (для фільтра) */
  statusCounts?: Record<string, number>;
  /** Кількість по днях з усієї бази (для фільтра Днів) */
  daysCounts?: { none: number; growing: number; grown: number; overgrown: number };
  /** Кількість по станах (Букінгдата в минулому, Продано, тощо) з усієї бази */
  stateCounts?: Record<string, number>;
  /** Кількість по Inst-статусах з усієї бази */
  instCounts?: Record<string, number>;
  /** Кількість по типах клієнтів (leads, clients, consulted, good, stars) з усієї бази */
  clientTypeCounts?: { leads: number; clients: number; consulted: number; good: number; stars: number };
  /** Кількість по консультаціях (hasConsultation, createdCur, appointedCur, тощо) з усієї бази */
  consultationCounts?: Record<string, number>;
  /** Кількість по записах (hasRecord, newClient, тощо) з усієї бази */
  recordCounts?: Record<string, number>;
  /** Кількість по дзвінках Binotel (incoming, outgoing, success, fail) з усієї бази */
  binotelCallsFilterCounts?: { incoming: number; outgoing: number; success: number; fail: number };
  chatStatuses?: DirectChatStatus[];
  callStatuses?: DirectCallStatus[];
  onCallStatusCreated?: (status: DirectCallStatus) => void;
  masters?: { id: string; name: string }[];
  filters: DirectFilters;
  onFiltersChange: (filters: DirectFilters) => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (by: string, order: "asc" | "desc") => void;
  onClientUpdate: (clientId: string, updates: Partial<DirectClient>) => Promise<void>;
  onRefresh: () => Promise<void>;
  /** Оновити одного клієнта локально без перезавантаження (після sync API,KV) */
  onClientSynced?: (client: DirectClient) => void;
  /** Prefetch клієнта при відкритті меню статусів (warm-up перед PATCH) */
  onStatusMenuOpen?: (clientId: string) => void;
  shouldOpenAddClient?: boolean;
  onOpenAddClientChange?: (open: boolean) => void;
  isEditingColumnWidths?: boolean;
  setIsEditingColumnWidths?: (value: boolean) => void;
  /** Ref слоту в fixed-хедері — якщо задано, thead рендериться туди через portal */
  headerPortalRef?: React.RefObject<HTMLDivElement | null>;
  /** Слот змонтовано — portal тільки тоді, щоб уникнути помилки "Target container is not a DOM element" */
  headerSlotReady?: boolean;
  /** scrollLeft body-таблиці для синхрону горизонтального скролу заголовків */
  bodyScrollLeft?: number;
  /** Infinite scroll: контейнер з overflow для IntersectionObserver */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  /** Викликати при прокрутці до кінця таблиці */
  onLoadMore?: () => void;
  /** Є ще записи для завантаження */
  hasMore?: boolean;
  /** Іде завантаження (блокувати дублікати викликів) */
  isLoadingMore?: boolean;
  /** Приховати колонку «Продажі» (право salesColumn = none) */
  hideSalesColumn?: boolean;
  /** Приховати колонку «Дії» (право actionsColumn = none) */
  hideActionsColumn?: boolean;
  /** Приховати фінанси: сума запису в колонці Запис, цифри в дужках у колонці Майстри (право finances = none) */
  hideFinances?: boolean;
  /** Дозвіл прослуховування записів дзвінків (право callsListen). false = кнопка ▶ не відкриває плеєр, тултип «Прослуховування не доступне» */
  canListenCalls?: boolean;
};

export function DirectClientTable({
  clients,
  totalClientsCount,
  statuses,
  statusCounts,
  daysCounts,
  stateCounts,
  instCounts,
  clientTypeCounts,
  consultationCounts,
  recordCounts,
  binotelCallsFilterCounts,
  chatStatuses = [],
  callStatuses = [],
  onCallStatusCreated,
  masters = [],
  filters,
  onFiltersChange,
  sortBy,
  sortOrder,
  onSortChange,
  onClientUpdate,
  onRefresh,
  onClientSynced,
  onStatusMenuOpen,
  shouldOpenAddClient,
  onOpenAddClientChange,
  isEditingColumnWidths = false,
  setIsEditingColumnWidths,
  headerPortalRef,
  headerSlotReady = false,
  bodyScrollLeft = 0,
  scrollContainerRef,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  hideSalesColumn = false,
  hideActionsColumn = false,
  hideFinances = false,
  canListenCalls = true,
}: DirectClientTableProps) {
  const chatStatusUiVariant = useChatStatusUiVariant();
  const searchParams = useSearchParams();
  const debugActivity = (searchParams?.get("debugActivity") || "").toString().trim() === "1";
  const [editingClient, setEditingClient] = useState<DirectClient | null>(null);
  const [columnWidths, setColumnWidths] = useColumnWidthConfig();
  const [editingConfig, setEditingConfig] = useState<ColumnWidthConfig>(columnWidths);
  const bodyTableRef = useRef<HTMLTableElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLTableRowElement | null>(null);
  const [measuredWidths, setMeasuredWidths] = useState<number[]>([]);

  // Infinite scroll: IntersectionObserver + callback ref для надійної підписки при монтуванні
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreSentinelCallbackRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      (loadMoreSentinelRef as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node || !onLoadMore || !hasMore || isLoadingMore) return;
      const root = scrollContainerRef?.current ?? null;
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && onLoadMore) onLoadMore();
        },
        { root, rootMargin: '200px', threshold: 0 }
      );
      observerRef.current = obs;
      obs.observe(node);
    },
    [onLoadMore, hasMore, isLoadingMore, scrollContainerRef]
  );

  // Ширини для header: з body (виміряні) або fallback з columnWidths
  // Мінімум для "Стан": щоб "Стан" + фільтр + відступи не залазили на "Консультація"
  const STATE_MIN_WIDTH = 96;
  // Мінімум для "Консультація": текст + стрілка сортування + іконка фільтра не перекривались
  const CONSULTATION_MIN_WIDTH = 110;
  const effectiveWidths = COLUMN_KEYS.map((k, i) => {
    // 0 з вимірювання не замінюється через ?? — тоді колонки стають 0px і таблиця «ламається».
    const raw = measuredWidths[i];
    const configW = (columnWidths as Record<ColumnKey, { width: number }>)[k].width;
    const w = raw != null && raw > 0 ? raw : configW;
    if (k === 'communication') return Math.max(w, COMMUNICATION_COLUMN_MIN_WIDTH_PX);
    if (k === 'inst') return Math.max(w, INST_COLUMN_MIN_WIDTH_PX);
    if (k === 'calls') return Math.max(w, CALLS_COLUMN_MIN_WIDTH_PX);
    if (k === 'state') return Math.max(w, STATE_MIN_WIDTH);
    if (k === 'consultation') return Math.max(w, CONSULTATION_MIN_WIDTH);
    return w;
  });

  const visibleColumnIndices = useMemo(
    () =>
      COLUMN_KEYS.map((_, i) => i).filter(
        (i) => !(hideSalesColumn && COLUMN_KEYS[i] === 'sales') && !(hideActionsColumn && COLUMN_KEYS[i] === 'actions')
      ),
    [hideSalesColumn, hideActionsColumn]
  );

  const totalTableWidth = visibleColumnIndices.reduce((s, i) => s + (effectiveWidths[i] ?? 0), 0);

  // Colgroup для header і body — однакові ширини, щоб верхні/нижні колонки збігались
  const headerColgroup = (
    <colgroup>
      {visibleColumnIndices.map((i) => (
        <col key={i} style={{ width: `${effectiveWidths[i]}px` }} />
      ))}
    </colgroup>
  );

  const tableWidthStyle = { tableLayout: 'fixed' as const, width: `${totalTableWidth}px`, margin: 0 };

  // Обчислюємо left для sticky (перші 4: №, Act, Avatar, Name)
  const getStickyLeft = useCallback((columnIndex: number): number => {
    let left = 0;
    for (let i = 0; i < columnIndex && i < 4; i++) left += effectiveWidths[i] ?? 0;
    return left;
  }, [effectiveWidths]);
  
  // Синхронізуємо editingConfig з columnWidths коли відкривається режим редагування
  useEffect(() => {
    if (isEditingColumnWidths) {
      setEditingConfig(columnWidths);
    }
  }, [isEditingColumnWidths, columnWidths]);

  const handleSaveColumnWidths = () => {
    // Валідація значень
    const validated: ColumnWidthConfig = {
      number: {
        width: Math.max(10, Math.min(500, editingConfig.number.width)),
        mode: editingConfig.number.mode
      },
      act: {
        width: Math.max(10, Math.min(500, editingConfig.act.width)),
        mode: editingConfig.act.mode
      },
      avatar: {
        width: Math.max(10, Math.min(500, editingConfig.avatar.width)),
        mode: editingConfig.avatar.mode
      },
      name: {
        width: Math.max(10, Math.min(500, editingConfig.name.width)),
        mode: editingConfig.name.mode
      },
      sales: {
        width: Math.max(10, Math.min(500, editingConfig.sales.width)),
        mode: editingConfig.sales.mode
      },
      days: {
        width: Math.max(10, Math.min(500, editingConfig.days.width)),
        mode: editingConfig.days.mode
      },
      communication: {
        width: Math.max(
          COMMUNICATION_COLUMN_MIN_WIDTH_PX,
          Math.min(500, editingConfig.communication.width)
        ),
        mode: editingConfig.communication.mode
      },
      inst: {
        width: Math.max(INST_COLUMN_MIN_WIDTH_PX, Math.min(500, editingConfig.inst.width)),
        mode: editingConfig.inst.mode,
      },
      calls: {
        width: Math.max(CALLS_COLUMN_MIN_WIDTH_PX, Math.min(500, editingConfig.calls.width)),
        mode: editingConfig.calls.mode,
      },
      callStatus: {
        width: Math.max(10, Math.min(500, editingConfig.callStatus.width)),
        mode: editingConfig.callStatus.mode
      },
      state: {
        width: Math.max(10, Math.min(500, editingConfig.state.width)),
        mode: editingConfig.state.mode
      },
      consultation: {
        width: Math.max(10, Math.min(500, editingConfig.consultation.width)),
        mode: editingConfig.consultation.mode
      },
      record: {
        width: Math.max(10, Math.min(500, editingConfig.record.width)),
        mode: editingConfig.record.mode
      },
      master: {
        width: Math.max(10, Math.min(500, editingConfig.master.width)),
        mode: editingConfig.master.mode
      },
      phone: {
        width: Math.max(10, Math.min(500, editingConfig.phone.width)),
        mode: editingConfig.phone.mode
      },
      actions: {
        width: Math.max(10, Math.min(500, editingConfig.actions.width)),
        mode: editingConfig.actions.mode
      },
    };
    setColumnWidths(validated);
    setIsEditingColumnWidths?.(false);
  };
  
  // Відкриваємо форму додавання клієнта, якщо shouldOpenAddClient змінився на true
  useEffect(() => {
    if (shouldOpenAddClient) {
      setEditingClient({} as DirectClient);
      onOpenAddClientChange?.(false);
    }
  }, [shouldOpenAddClient, onOpenAddClientChange]);
  const [stateHistoryClient, setStateHistoryClient] = useState<DirectClient | null>(null);
  const [messagesHistoryClient, setMessagesHistoryClient] = useState<DirectClient | null>(null);
  const [binotelHistoryClient, setBinotelHistoryClient] = useState<DirectClient | null>(null);
  const [inlineRecordingUrl, setInlineRecordingUrl] = useState<string | null>(null);
  const [webhooksClient, setWebhooksClient] = useState<DirectClient | null>(null);
  const [recordHistoryClient, setRecordHistoryClient] = useState<DirectClient | null>(null);
  const [recordHistoryType, setRecordHistoryType] = useState<'paid' | 'consultation'>('paid');
  const [masterHistoryClient, setMasterHistoryClient] = useState<DirectClient | null>(null);
  // Локальні оверрайди для UI переписки, щоб не перезавантажувати всю таблицю після зміни статусу
  const [chatUiOverrides, setChatUiOverrides] = useState<Record<string, Partial<DirectClient>>>({});
  const [fullscreenAvatar, setFullscreenAvatar] = useState<{ src: string; username: string } | null>(null);
  const [pullingClientId, setPullingClientId] = useState<string | null>(null);

  // Майстрів передаємо з page (masters prop). НЕ завантажуємо історію станів для всіх клієнтів одразу - це створює зайве навантаження
  // Історія завантажується тільки при відкритті модального вікна (StateHistoryModal)
  // В таблиці показуємо тільки поточний стан клієнта

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

  // Фільтрація за clientType (AND логіка: клієнт має відповідати ВСІМ вибраним фільтрам)
  const filteredByClientType = useMemo(() => {
    if (!filters.clientType || filters.clientType.length === 0) {
      return uniqueClients;
    }

    return uniqueClients.filter((client) => {
      const matches: boolean[] = [];

      for (const filterType of filters.clientType) {
        if (filterType === "leads") {
          matches.push(!client.altegioClientId);
        } else if (filterType === "clients") {
          matches.push(!!client.altegioClientId);
        } else if (filterType === "consulted") {
          matches.push(!!client.altegioClientId && (client.spent ?? 0) === 0);
        } else if (filterType === "good") {
          const spent = client.spent ?? 0;
          matches.push(spent > 0 && spent < 100000);
        } else if (filterType === "stars") {
          matches.push((client.spent ?? 0) >= 100000);
        }
      }

      return matches.length === filters.clientType.length && matches.every((m) => m === true);
    });
  }, [uniqueClients, filters.clientType]);

  // Фільтр дзвінків Binotel виконується на сервері (API); клієнти вже відфільтровані
  const filteredClients = filteredByClientType;

  // У активному режимі: спочатку рядки з тригером (updatedAt/createdAt сьогодні, повідомлення, консультація/запис сьогодні, статус), потім за ефективним часом.
  // Та сама перевірка календарного дня, що й для товстої лінії (isKyivCalendarDayEqualToReference).
  const clientsForTable = useMemo(() => {
    const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
    if (!isActiveMode) return filteredClients;

    const todayKyivDay = kyivDayFromISO(new Date().toISOString());
    const dateField: 'updatedAt' | 'createdAt' = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';

    const hasTrigger = (c: DirectClient): boolean => {
      const mainDate = c[dateField];
      if (mainDate && isKyivCalendarDayEqualToReference(String(mainDate), todayKyivDay)) return true;
      if (c.lastMessageAt && isKyivCalendarDayEqualToReference(String(c.lastMessageAt), todayKyivDay)) return true;
      if (isKyivCalendarDayEqualToReference(c.consultationBookingDate ?? undefined, todayKyivDay)) return true;
      if (isKyivCalendarDayEqualToReference(c.paidServiceDate ?? undefined, todayKyivDay)) return true;
      if (isKyivCalendarDayEqualToReference(c.statusSetAt ?? undefined, todayKyivDay)) return true;
      return false;
    };

    const getEffectiveTime = (c: DirectClient) => {
      const u = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
      const s = c.statusSetAt ? new Date(c.statusSetAt).getTime() : 0;
      const m = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
      return Math.max(u, s, m);
    };
    return [...filteredClients].sort((a, b) => {
      const aT = hasTrigger(a);
      const bT = hasTrigger(b);
      if (aT !== bT) return aT ? -1 : 1;
      return getEffectiveTime(b) - getEffectiveTime(a);
    });
  }, [filteredClients, sortBy, sortOrder]);

  const todayBlockRowIndices = useMemo(() => {
    const todayKyivDayRow = kyivDayFromISO(new Date().toISOString());
    const dateField: "updatedAt" | "createdAt" = sortBy === "updatedAt" ? "updatedAt" : "createdAt";
    let firstTodayIndex = -1;
    let firstCreatedTodayIndex = -1;

    clientsForTable.forEach((client, idx) => {
      const belongsToToday = (() => {
        const mainDate = client[dateField];
        if (mainDate && isKyivCalendarDayEqualToReference(String(mainDate), todayKyivDayRow)) return true;
        if (isKyivCalendarDayEqualToReference(client.lastMessageAt ?? undefined, todayKyivDayRow)) return true;
        if (isKyivCalendarDayEqualToReference(client.consultationBookingDate, todayKyivDayRow)) return true;
        if (isKyivCalendarDayEqualToReference(client.paidServiceDate, todayKyivDayRow)) return true;
        if (isKyivCalendarDayEqualToReference(client.statusSetAt, todayKyivDayRow)) return true;
        return false;
      })();
      if (belongsToToday && idx > firstTodayIndex) {
        firstTodayIndex = idx;
      }
      const createdAtKyiv = client.createdAt ? kyivDayFromISO(String(client.createdAt)) : null;
      if (createdAtKyiv && createdAtKyiv === todayKyivDayRow) {
        firstCreatedTodayIndex = idx;
      }
    });

    return { firstTodayIndex, firstCreatedTodayIndex };
  }, [clientsForTable, sortBy]);

  const rowContextValue = useMemo((): DirectClientTableRowContextValue => {
    return {
      columnWidths: columnWidths as DirectClientTableRowContextValue["columnWidths"],
      getStickyLeft,
      getColumnStyle,
      getStickyColumnStyle,
      debugActivity,
      sortBy,
      sortOrder,
      todayBlockRowIndices,
      statuses,
      masters,
      onClientUpdate,
      onStatusMenuOpen,
      hideFinances,
      hideActionsColumn,
      hideSalesColumn,
      canListenCalls,
      chatStatusUiVariant,
      instCallsCellMinHeight: INST_CALLS_CELL_MIN_HEIGHT,
      setFullscreenAvatar,
      setMessagesHistoryClient,
      setBinotelHistoryClient,
      setInlineRecordingUrl,
      setStateHistoryClient,
      setRecordHistoryClient,
      setRecordHistoryType,
      setMasterHistoryClient,
      setEditingClient,
    };
  }, [
    columnWidths,
    getStickyLeft,
    debugActivity,
    sortBy,
    sortOrder,
    todayBlockRowIndices,
    statuses,
    masters,
    onClientUpdate,
    onStatusMenuOpen,
    hideFinances,
    hideActionsColumn,
    hideSalesColumn,
    canListenCalls,
    chatStatusUiVariant,
    setFullscreenAvatar,
    setMessagesHistoryClient,
    setBinotelHistoryClient,
    setInlineRecordingUrl,
    setStateHistoryClient,
    setRecordHistoryClient,
    setRecordHistoryType,
    setMasterHistoryClient,
    setEditingClient,
  ]);

  const useBodyVirtualization =
    Boolean(scrollContainerRef) &&
    clientsForTable.length >= VIRTUAL_TABLE_ROW_THRESHOLD &&
    !isEditingColumnWidths;

  const rowVirtualizer = useVirtualizer({
    count: clientsForTable.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    estimateSize: () => 68,
    overscan: 12,
    enabled: useBodyVirtualization,
  });

  /** Порожній tbody: не плутати «0 у базі» з фільтром типу клієнта (AND) або збоєм відповіді */
  const emptyTableMessage = useMemo(() => {
    const total = totalClientsCount ?? 0;
    if (clients.length === 0) {
      if (total > 0) {
        return `За цим запитом отримано 0 рядків, у той час як у базі ≈ ${total} клієнтів. Спробуйте «Оновити» або змініть фільтри колонок / пошук.`;
      }
      return 'Немає клієнтів';
    }
    if ((filters.clientType?.length ?? 0) > 0) {
      return 'Немає рядків: для типу клієнта обрано кілька міток одночасно (логіка AND — мають виконуватись усі). Зніміть зайві мітки у фільтрі типу.';
    }
    return 'Немає клієнтів для відображення';
  }, [clients.length, totalClientsCount, filters.clientType]);

  // Завжди colgroup при наявності рядків: при віртуалізації tbody display:block і tr position:absolute
  // не формують ширину таблиці — без colgroup + width таблиця згортається (лише «смужка» зліва).
  // effectiveWidths уже безпечні (конфіг + виміри > 0).
  const useColgroupOnBody = filteredClients.length > 0;

  // Вимірюємо фактичні ширини колонок з body-таблиці; header colgroup використовує їх
  useLayoutEffect(() => {
    const table = bodyTableRef.current;
    if (!table) return;
    const vci = visibleColumnIndices;
    const nc = vci.length;
    const measure = () => {
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody?.querySelectorAll('tr') ?? []);
      const dataRows = rows.filter((r) => r.cells.length === nc);
      if (dataRows.length === 0) {
        setMeasuredWidths((prev) => (prev.length ? [] : prev));
        return;
      }
      const maxWidths = new Array<number>(COLUMN_KEYS.length).fill(0);
      for (const row of dataRows) {
        const cells = Array.from(row.cells);
        for (let i = 0; i < nc && i < cells.length; i++) {
          const colIdx = vci[i];
          const w = Math.round(cells[i].getBoundingClientRect().width);
          if (w > maxWidths[colIdx]) maxWidths[colIdx] = w;
        }
      }
      // Усі 0 — типовий артефакт layout до готовності контейнера; не фіксуємо, щоб не ламати colgroup.
      const hasPositiveForVisible = vci.some((colIdx) => maxWidths[colIdx] > 0);
      if (!hasPositiveForVisible) {
        setMeasuredWidths((prev) => (prev.length ? [] : prev));
        return;
      }
      setMeasuredWidths(maxWidths);
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(table);
    return () => ro.disconnect();
  }, [filteredClients.length, filteredClients, visibleColumnIndices]);

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* Модальне вікно форми редагування */}
      {editingClient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={() => setEditingClient(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">
                  {editingClient.id ? "Редагувати клієнта" : "Додати нового клієнта"}
                </h3>
                <div className="flex items-center gap-1">
                  {editingClient.id && (
                    <>
                      {editingClient.altegioClientId && (
                        <>
                          <button
                            className="btn btn-sm btn-ghost text-info"
                            title="підтягування даних з API,KV"
                            onClick={async () => {
                              if (!editingClient.altegioClientId || pullingClientId) return;
                              setPullingClientId(editingClient.id);
                              try {
                                const res = await fetch('/api/admin/direct/sync-consultation-for-client', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ altegioClientId: editingClient.altegioClientId }),
                                });
                                const data = await res.json();
                                if (data?.ok) {
                                  if (data.client && onClientSynced) {
                                    onClientSynced(data.client);
                                    setEditingClient((prev) =>
                                      prev && prev.id === data.client.id
                                        ? { ...prev, ...data.client }
                                        : prev
                                    );
                                  } else if (onRefresh) {
                                    await onRefresh();
                                  }
                                } else if (!data?.ok) {
                                  console.warn('[DirectClientTable] sync-consultation-for-client:', data?.error || data);
                                }
                              } catch (err) {
                                console.warn('[DirectClientTable] sync-consultation-for-client error:', err);
                              } finally {
                                setPullingClientId(null);
                              }
                            }}
                            disabled={!!pullingClientId}
                          >
                            {pullingClientId === editingClient.id ? (
                              <span className="loading loading-spinner loading-xs" />
                            ) : (
                              'API,KV'
                            )}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost text-info"
                            onClick={() => setWebhooksClient(editingClient)}
                            title="Переглянути вебхуки клієнта"
                          >
                            🔗
                          </button>
                        </>
                      )}
                      <button
                        className="btn btn-sm btn-ghost text-info"
                        onClick={async () => {
                          try {
                            const fullName = [editingClient.firstName, editingClient.lastName].filter(Boolean).join(' ');
                            const res = await fetch('/api/admin/direct/diagnose-client', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                instagramUsername: editingClient.instagramUsername,
                                fullName: fullName || undefined,
                                altegioClientId: editingClient.altegioClientId || undefined,
                              }),
                            });
                            const data = await res.json();
                            if (data.ok) {
                              const diagnosis = data.diagnosis;
                              let message = `🔍 Діагностика клієнтки: ${fullName || editingClient.instagramUsername}\n\n`;
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
                              alert(message);
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
                        className="btn btn-sm btn-ghost text-error"
                        onClick={async () => {
                          if (!confirm(`Видалити клієнта @${editingClient.instagramUsername}?\n\nЦю дію неможливо скасувати.`)) {
                            return;
                          }
                          try {
                            const res = await fetch(`/api/admin/direct/clients/${editingClient.id}`, {
                              method: 'DELETE',
                            });
                            const data = await res.json();
                            if (data.ok) {
                              setEditingClient(null);
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
                    </>
                  )}
                  <button
                    className="btn btn-sm btn-circle btn-ghost"
                    onClick={() => setEditingClient(null)}
                  >
                    ✕
                  </button>
                </div>
              </div>
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
            </div>
          </div>
        </div>
      )}

      {/* Модальне вікно історії станів */}
      <StateHistoryModal
        client={stateHistoryClient}
        isOpen={!!stateHistoryClient}
        onClose={() => setStateHistoryClient(null)}
      />

      {/* Модальне вікно історії повідомлень */}
      <BinotelCallHistoryModal
        client={binotelHistoryClient}
        isOpen={!!binotelHistoryClient}
        onClose={() => setBinotelHistoryClient(null)}
        onPlayRequest={(url) => setInlineRecordingUrl(url)}
        canListenCalls={canListenCalls}
      />
      {inlineRecordingUrl && (
        <InlineCallRecordingPlayer
          url={inlineRecordingUrl}
          onClose={() => setInlineRecordingUrl(null)}
        />
      )}
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
              ...('lastActivityAt' in u && u.lastActivityAt !== undefined ? { lastActivityAt: String(u.lastActivityAt) } : {}),
              ...('lastActivityKeys' in u && Array.isArray(u.lastActivityKeys) ? { lastActivityKeys: u.lastActivityKeys } : {}),
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
              ...('lastActivityAt' in u && u.lastActivityAt !== undefined ? { lastActivityAt: String(u.lastActivityAt) } : {}),
              ...('lastActivityKeys' in u && Array.isArray(u.lastActivityKeys) ? { lastActivityKeys: u.lastActivityKeys } : {}),
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
          onSynced={async () => {
            if (onRefresh) await onRefresh();
          }}
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

      {/* Модальне вікно повноекранного перегляду аватарки */}
      {fullscreenAvatar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setFullscreenAvatar(null)}
        >
          <img
            src={fullscreenAvatar.src}
            alt={fullscreenAvatar.username}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 min-w-0">
        <div className="min-h-0 flex flex-col">
          <div>
            {(() => {
              const headerTable = (
                <table className="table table-xs border-collapse" style={tableWidthStyle}>
                  {headerColgroup}
                  <thead>
                    <tr className="leading-tight">
                      <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getStickyColumnStyle(columnWidths.number, getStickyLeft(0), true)}>№</th>
                  <th className="px-0 py-0 text-[10px] font-semibold text-left" style={getStickyColumnStyle(columnWidths.act, getStickyLeft(1), true)}>
                    <div className="flex items-center gap-0.5">
                      <button
                        className={`hover:underline cursor-pointer text-left whitespace-nowrap ${
                          sortBy === "updatedAt" && sortOrder === "desc" 
                            ? "text-blue-600 font-bold" 
                            : "text-gray-600"
                        }`}
                        onClick={() => {
                          const isActiveMode = sortBy === "updatedAt" && sortOrder === "desc";
                          if (isActiveMode) {
                            onSortChange("firstContactDate", "desc");
                          } else {
                            onSortChange("updatedAt", "desc");
                          }
                        }}
                        title={
                          sortBy === "updatedAt" && sortOrder === "desc"
                            ? "Активний режим: сортування по активних оновленнях. Натисніть для пасивного режиму"
                            : "Пасивний режим. Натисніть для активного режиму (сортування по активних оновленнях)"
                        }
                      >
                        Act {sortBy === "updatedAt" && sortOrder === "desc" ? "↓" : ""}
                      </button>
                      <ActFilterDropdown
                        clients={clients}
                        totalClientsCount={totalClientsCount}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Act"
                      />
                    </div>
                  </th>
                  {/* Слот під аватар (порожній заголовок), щоб вирівняти рядки і зсунути “Повне імʼя” вліво */}
                  <th className="px-0 py-0 text-left" style={getStickyColumnStyle(columnWidths.avatar, getStickyLeft(2), true)} />
                  <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getStickyColumnStyle(columnWidths.name, getStickyLeft(3), true)}>
                    <div className="flex flex-col items-start leading-none">
                      <div className="flex items-center gap-0.5">
                        <button
                          className={`hover:underline cursor-pointer text-left ${sortBy === "spent" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                          onClick={() =>
                            onSortChange(
                              "spent",
                              sortBy === "spent" && sortOrder === "desc" ? "asc" : "desc"
                            )
                          }
                          title="Сортувати по продажам"
                        >
                          Ім'я {sortBy === "spent" && (sortOrder === "asc" ? "↑" : "↓")}
                        </button>
                        <ColumnFilterDropdown
                          clients={clients}
                          totalClientsCount={totalClientsCount}
                          selectedFilters={(filters.clientType || []) as ClientTypeFilter[]}
                          onFiltersChange={(newFilters) =>
                            onFiltersChange({ ...filters, clientType: newFilters })
                          }
                          columnLabel="Ім'я"
                        />
                      </div>
                      <button
                        className={`hover:underline cursor-pointer text-left mt-0.5 ${sortBy === "instagramUsername" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                        onClick={() =>
                          onSortChange(
                            "instagramUsername",
                            sortBy === "instagramUsername" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        {sortBy === "instagramUsername" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                    </div>
                  </th>
                  {!hideSalesColumn && (
                    <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.sales, true)}>
                      <div className="flex flex-col items-start leading-none">
                        <button
                          className={`hover:underline cursor-pointer text-left mt-0.5 ${sortBy === "spent" ? "text-blue-600 font-bold" : "text-gray-600"}`}
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
                  )}
                  <th
                    className="px-1 sm:px-1 py-0 text-[10px] font-semibold text-left"
                    style={getColumnStyle(columnWidths.days, true)}
                    title="Днів з останнього візиту (Altegio). Сортувати."
                  >
                    <div className="flex items-center gap-1">
                      <button
                        className={`hover:underline cursor-pointer text-left ${sortBy === "daysSinceLastVisit" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                        onClick={() =>
                          onSortChange(
                            "daysSinceLastVisit",
                            sortBy === "daysSinceLastVisit" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Днів {sortBy === "daysSinceLastVisit" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <DaysFilterDropdown
                        clients={clients}
                        totalClientsCount={totalClientsCount}
                        daysCounts={daysCounts}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Днів"
                      />
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 py-0 text-[10px] font-semibold text-left whitespace-nowrap overflow-hidden text-ellipsis"
                    style={getColumnStyle(columnWidths.communication, true)}
                    title="Канал комунікації з клієнтом"
                  >
                    Комунікація
                  </th>
                  <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.inst, true)}>
                    <div className="flex items-center gap-1">
                      <button
                        className={`hover:underline cursor-pointer text-left ${sortBy === "messagesTotal" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                        onClick={() =>
                          onSortChange(
                            "messagesTotal",
                            sortBy === "messagesTotal" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Inst {sortBy === "messagesTotal" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <InstFilterDropdown
                        clients={clients}
                        chatStatuses={chatStatuses}
                        totalClientsCount={totalClientsCount}
                        instCounts={instCounts}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Inst"
                      />
                    </div>
                  </th>
                  <th className="px-2 sm:px-3 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.calls, true)}>
                    <div className="flex items-center gap-1">
                      <span>Дзвінки</span>
                      <BinotelCallsFilterDropdown
                        clients={clients}
                        totalClientsCount={totalClientsCount}
                        binotelCallsFilterCounts={binotelCallsFilterCounts}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Дзвінки"
                      />
                    </div>
                  </th>
                  <th className="px-2 sm:px-3 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.callStatus, true)}>
                    <div className="flex items-center justify-start gap-1">
                      <span>Статус</span>
                      <StatusFilterDropdown
                        clients={clients}
                        statuses={statuses}
                        totalClientsCount={totalClientsCount}
                        statusCounts={statusCounts}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Статус"
                      />
                    </div>
                  </th>
                  <th className="px-3 sm:px-4 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.state, true)}>
                    <div className="flex items-center justify-start gap-1">
                      <button
                        className={`hover:underline cursor-pointer text-left ${sortBy === "state" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                        onClick={() =>
                          onSortChange(
                            "state",
                            sortBy === "state" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Стан {sortBy === "state" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <StateFilterDropdown
                        clients={clients}
                        totalClientsCount={totalClientsCount}
                        stateCounts={stateCounts}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Стан"
                      />
                    </div>
                  </th>
                  <th className="pl-2 sm:pl-2 pr-1 sm:pr-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.consultation, true)}>
                    <div className="flex items-center gap-1">
                      <button
                        className={`hover:underline cursor-pointer text-left ${sortBy === "consultationBookingDate" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                        onClick={() =>
                          onSortChange(
                            "consultationBookingDate",
                            sortBy === "consultationBookingDate" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Консультація {sortBy === "consultationBookingDate" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <ConsultationFilterDropdown
                        clients={clients}
                        masters={masters}
                        totalClientsCount={totalClientsCount}
                        consultationCounts={consultationCounts}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Консультація"
                      />
                    </div>
                  </th>
                  <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.record, true)}>
                    <div className="flex items-center gap-1">
                      <button
                        className={`hover:underline cursor-pointer text-left ${sortBy === "paidServiceDate" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                        onClick={() =>
                          onSortChange(
                            "paidServiceDate",
                            sortBy === "paidServiceDate" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Запис {sortBy === "paidServiceDate" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <RecordFilterDropdown
                        clients={clients}
                        totalClientsCount={totalClientsCount}
                        recordCounts={recordCounts}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Запис"
                        hideFinances={hideFinances}
                      />
                    </div>
                  </th>
                  <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.master, true)}>
                    <div className="flex items-center gap-1">
                      <button
                        className={`hover:underline cursor-pointer text-left ${sortBy === "masterId" ? "text-blue-600 font-bold" : "text-gray-600"}`}
                        onClick={() =>
                          onSortChange(
                            "masterId",
                            sortBy === "masterId" && sortOrder === "desc" ? "asc" : "desc"
                          )
                        }
                      >
                        Майстер {sortBy === "masterId" && (sortOrder === "asc" ? "↑" : "↓")}
                      </button>
                      <MasterFilterDropdown
                        clients={clients}
                        masters={masters}
                        totalClientsCount={totalClientsCount}
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Майстер"
                      />
                    </div>
                  </th>
                  <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.phone, true)}>
                    Телефон
                  </th>
                  {!hideActionsColumn && (
                    <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.actions, true)}>Дії</th>
                  )}
                </tr>
                {/* Рядок редагування розмірів */}
                {isEditingColumnWidths && (
                  <tr className="bg-yellow-50">
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.number.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, number: { ...editingConfig.number, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.number.width}px`}
                        />
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded">
                          <input
                            type="checkbox"
                            checked={editingConfig.number.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, number: { ...editingConfig.number, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-sm"
                          />
                          <span className="whitespace-nowrap">Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.act.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, act: { ...editingConfig.act, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.act.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.act.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, act: { ...editingConfig.act, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.avatar.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, avatar: { ...editingConfig.avatar, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.avatar.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.avatar.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, avatar: { ...editingConfig.avatar, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.name.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, name: { ...editingConfig.name, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.name.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.name.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, name: { ...editingConfig.name, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.sales.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, sales: { ...editingConfig.sales, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.sales.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.sales.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, sales: { ...editingConfig.sales, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.days.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, days: { ...editingConfig.days, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.days.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.days.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, days: { ...editingConfig.days, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.communication.width}
                          onChange={(e) =>
                            setEditingConfig({
                              ...editingConfig,
                              communication: {
                                ...editingConfig.communication,
                                width: parseInt(e.target.value) || 10,
                              },
                            })
                          }
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.communication.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.communication.mode === 'fixed'}
                            onChange={(e) =>
                              setEditingConfig({
                                ...editingConfig,
                                communication: {
                                  ...editingConfig.communication,
                                  mode: e.target.checked ? 'fixed' : 'min',
                                },
                              })
                            }
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min={INST_COLUMN_MIN_WIDTH_PX}
                          max="500"
                          value={editingConfig.inst.width}
                          onChange={(e) =>
                            setEditingConfig({
                              ...editingConfig,
                              inst: {
                                ...editingConfig.inst,
                                width: Math.max(
                                  INST_COLUMN_MIN_WIDTH_PX,
                                  parseInt(e.target.value, 10) || INST_COLUMN_MIN_WIDTH_PX
                                ),
                              },
                            })
                          }
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.inst.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.inst.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, inst: { ...editingConfig.inst, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min={CALLS_COLUMN_MIN_WIDTH_PX}
                          max="500"
                          value={editingConfig.calls.width}
                          onChange={(e) =>
                            setEditingConfig({
                              ...editingConfig,
                              calls: {
                                ...editingConfig.calls,
                                width: Math.max(
                                  CALLS_COLUMN_MIN_WIDTH_PX,
                                  parseInt(e.target.value, 10) || CALLS_COLUMN_MIN_WIDTH_PX
                                ),
                              },
                            })
                          }
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.calls.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.calls.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, calls: { ...editingConfig.calls, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.callStatus.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, callStatus: { ...editingConfig.callStatus, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.callStatus.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.callStatus.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, callStatus: { ...editingConfig.callStatus, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.state.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, state: { ...editingConfig.state, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.state.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.state.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, state: { ...editingConfig.state, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.consultation.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, consultation: { ...editingConfig.consultation, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.consultation.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.consultation.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, consultation: { ...editingConfig.consultation, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.record.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, record: { ...editingConfig.record, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.record.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.record.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, record: { ...editingConfig.record, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.master.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, master: { ...editingConfig.master, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.master.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.master.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, master: { ...editingConfig.master, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min="10"
                          max="500"
                          value={editingConfig.phone.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, phone: { ...editingConfig.phone, width: parseInt(e.target.value) || 10 } })}
                          className="input input-xs w-full"
                          placeholder={`${columnWidths.phone.width}px`}
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={editingConfig.phone.mode === 'fixed'}
                            onChange={(e) => setEditingConfig({ ...editingConfig, phone: { ...editingConfig.phone, mode: e.target.checked ? 'fixed' : 'min' } })}
                            className="checkbox checkbox-xs"
                          />
                          <span>Фіксована</span>
                        </label>
                        {hideActionsColumn && (
                          <button
                            onClick={handleSaveColumnWidths}
                            className="btn btn-primary btn-xs mt-1"
                          >
                            Зберегти
                          </button>
                        )}
                      </div>
                    </td>
                    {!hideActionsColumn && (
                      <td className="px-1 py-1">
                        <button
                          onClick={handleSaveColumnWidths}
                          className="btn btn-primary btn-xs w-full"
                        >
                          Зберегти
                        </button>
                      </td>
                    )}
                  </tr>
                )}
                  </thead>
                </table>
              );
              const target = headerPortalRef?.current;
              const canPortal = headerSlotReady && typeof document !== "undefined" && target instanceof HTMLElement;
              return (
                <>
                  {canPortal && createPortal(headerTable, target)}
                  {!headerPortalRef && (
                    <div className="sticky top-0 z-20">{headerTable}</div>
                  )}
                </>
              );
            })()}
            <table
              ref={bodyTableRef}
              className="table table-xs sm:table-sm border-collapse"
              style={useColgroupOnBody ? tableWidthStyle : { tableLayout: 'auto', width: 'max-content', margin: 0 }}
            >
              {useColgroupOnBody && headerColgroup}
              <tbody
                style={
                  useBodyVirtualization
                    ? {
                        display: "block",
                        position: "relative",
                        height: `${rowVirtualizer.getTotalSize() + (hasMore && onLoadMore ? 56 : 0)}px`,
                      }
                    : undefined
                }
              >
                {clientsForTable.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnIndices.length} className="py-8 px-4">
                      <div className="text-center text-gray-500 text-sm max-w-2xl mx-auto whitespace-normal">
                        {emptyTableMessage}
                      </div>
                    </td>
                  </tr>
                ) : (
                    <>
                    <DirectClientTableRowProvider value={rowContextValue}>
                    {(useBodyVirtualization
                      ? rowVirtualizer.getVirtualItems().map((vr) => ({
                          vr,
                          index: vr.index,
                          client: clientsForTable[vr.index],
                        }))
                      : clientsForTable.map((client, index) => ({
                          vr: null as VirtualItem | null,
                          index,
                          client,
                        }))
                    ).map(({ vr, index, client }) => {
                      if (!client) return null;
                      return (
                        <DirectClientTableRow
                          key={client.id}
                          client={client}
                          index={index}
                          virtualRow={vr}
                          measureElement={vr ? rowVirtualizer.measureElement : undefined}
                        />
                      );
                    })}
                    </DirectClientTableRowProvider>
                  {hasMore && onLoadMore && (
                    <tr
                      ref={loadMoreSentinelCallbackRef}
                      style={
                        useBodyVirtualization
                          ? {
                              position: "absolute",
                              top: `${rowVirtualizer.getTotalSize()}px`,
                              left: 0,
                              width: "100%",
                              display: "table",
                              tableLayout: "fixed",
                            }
                          : undefined
                      }
                    >
                      <td colSpan={visibleColumnIndices.length} className="py-2 text-center text-gray-400 text-xs">
                        {isLoadingMore ? (
                          'Завантаження...'
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => onLoadMore()}
                          >
                            Завантажити ще
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                    </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Футер таблиці: візуальна смуга як раніше; KPI без даних — див. /admin/direct/stats */}
      <div
        className="fixed bottom-0 left-0 right-0 z-10 bg-gray-200 min-h-[40px] py-0.5 px-2 border-t border-gray-300"
        aria-label="Футер Direct (без даних)"
      />
    </div>
  );
}
