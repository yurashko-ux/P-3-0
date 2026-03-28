// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { SyntheticEvent, ReactNode } from "react";
import type { DirectClient, DirectStatus, DirectChatStatus, DirectCallStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";
import { StateHistoryModal } from "./StateHistoryModal";
import { MessagesHistoryModal } from "./MessagesHistoryModal";
import { BinotelCallHistoryModal } from "./BinotelCallHistoryModal";
import { BinotelCallTypeIcon } from "./BinotelCallTypeIcon";
import { BinotelCallsFilterDropdown } from "./BinotelCallsFilterDropdown";
import { InlineCallRecordingPlayer } from "./InlineCallRecordingPlayer";
import { PlayRecordingButton } from "./PlayRecordingButton";
import { ClientWebhooksModal } from "./ClientWebhooksModal";
import { RecordHistoryModal } from "./RecordHistoryModal";
import { MasterHistoryModal } from "./MasterHistoryModal";
import { getChatBadgeStyle } from "./ChatBadgeIcon";
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
import { DirectStatusCell } from "./DirectStatusCell";
import { firstToken } from "./masterFilterUtils";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { isKyivCalendarDayEqualToReference } from "@/lib/direct-kyiv-today";
import { clientShowsF4SoldFireNow } from "@/lib/direct-f4-client-match";
import { CommunicationChannelPicker } from "./CommunicationChannelPicker";
import { ConfirmedCheckIcon } from "./CheckIcon";
import { StateIcon } from "./StateIcon";

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

/** Формат дати ДД.ММ.РР (08.03.26) */
function formatDateDDMMYY(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return '-';
  }
}

/** Формат дати й часу для tooltip (08.03.26 14:35) */
function formatDateDDMMYYHHMM(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

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

function BinotelLeadBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Binotel-лід"
    >
      <circle cx="10" cy="10" r="7.2" fill="#AF0087" stroke="#8B006E" strokeWidth="1.2" />
    </svg>
  );
}

function SpendCircleBadge({ size = 18, number }: { size?: number; number?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Кружок за витрати"
    >
      <circle cx="12" cy="12" r="9" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.2" />
      {typeof number === 'number' ? (
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fontWeight="700"
          fill="#111827"
        >
          {number}
        </text>
      ) : null}
    </svg>
  );
}

function SpendStarBadge({
  size = 18,
  number,
  fontSize = 12,
}: {
  size?: number;
  number?: number;
  fontSize?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Зірка за витрати"
    >
      <path
        d="M10 1.5L12.7 7.2L18.8 7.6L14.1 11.5L15.6 17.8L10 14.5L4.4 17.8L5.9 11.5L1.2 7.6L7.3 7.2Z"
        fill="#fbbf24"
        stroke="#f59e0b"
        strokeWidth="1.2"
      />
      {typeof number === 'number' ? (
        <text
          x="10"
          y="11.5"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={fontSize}
          fontWeight="700"
          fill="#111827"
        >
          {number}
        </text>
      ) : null}
    </svg>
  );
}

function SpendMegaBadge({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Бейдж за витрати понад 1 млн"
    >
      <polygon
        points="12,2 22,9 19,22 5,22 2,9"
        fill="#fbbf24"
        stroke="#fbbf24"
        strokeWidth="1.2"
      />
      <circle cx="12" cy="12.5" r="4.8" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.2" />
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
  onClick,
}: {
  avatarSrc: string | null;
  onError: (e: SyntheticEvent<HTMLImageElement, Event>) => void;
  onLoad?: () => void;
  onClick?: () => void;
}) {
  // Завжди рендеримо однаковий слот, щоб рядки вирівнювались.
  // Якщо аватарки нема — лишається пустий кружок.
  return (
    <div 
      className={`w-10 h-10 rounded-full shrink-0 border border-slate-200 bg-slate-50 overflow-hidden ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      onClick={onClick}
    >
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

// Допоміжна функція для отримання стилів колонки (width/minWidth — тільки якщо немає colgroup)
const getColumnStyle = (config: { width: number; mode: ColumnWidthMode }, useColgroup: boolean): React.CSSProperties => {
  if (useColgroup) return {};
  return config.mode === 'fixed'
    ? { width: `${config.width}px`, minWidth: `${config.width}px`, maxWidth: `${config.width}px` }
    : { minWidth: `${config.width}px` };
};

// Sticky стилі для перших колонок; ширини лишає colgroup, щоб header/body збігались
const getStickyColumnStyle = (
  _config: { width: number; mode: ColumnWidthMode },
  left: number,
  isHeader: boolean = false
): React.CSSProperties => ({
  position: 'sticky' as const,
  left: `${left}px`,
  zIndex: isHeader ? 21 : 10,
  ...(isHeader ? {} : { backgroundColor: '#ffffff' }),
});

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
    const w = measuredWidths[i] ?? (columnWidths as Record<ColumnKey, { width: number }>)[k].width;
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
  const getStickyLeft = (columnIndex: number): number => {
    let left = 0;
    for (let i = 0; i < columnIndex && i < 4; i++) left += effectiveWidths[i] ?? 0;
    return left;
  };
  
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
      binotel_call: 'Дзвінок (Binotel)',
      paidServiceDate: 'Запис на платну послугу',
      paidServiceRecordCreatedAt: 'Створення запису на платну послугу',
      paidServiceAttended: 'Відвідування платної послуги',
      paidServiceCancelled: 'Скасування платної послуги',
      paidServiceTotalCost: 'Зміна вартості платної послуги',
      consultationBookingDate: 'Запис на консультацію',
      consultationRecordCreatedAt: 'Створення запису на консультацію',
      consultationAttended: 'Відвідування консультації',
      consultationCancelled: 'Скасування консультації',
    };
    
    // Пріоритети трігерів (вищий номер = вищий пріоритет)
    const priority: Record<string, number> = {
      message: 10, // Найважливіший
      binotel_call: 9, // Між message (10) та записами (8)
      paidServiceDate: 8,
      paidServiceRecordCreatedAt: 8,
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



  // Майстрів передаємо з page (masters prop). НЕ завантажуємо історію станів для всіх клієнтів одразу - це створює зайве навантаження
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

  const useColgroupOnBody = filteredClients.length > 0 && measuredWidths.length === COLUMN_KEYS.length;

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
              <tbody>
                {clientsForTable.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnIndices.length} className="py-8 px-4">
                      <div className="text-center text-gray-500 text-sm max-w-2xl mx-auto whitespace-normal">
                        {emptyTableMessage}
                      </div>
                    </td>
                  </tr>
                ) : (
                  (() => {
                    // Визначаємо індекс останнього рядка блоку «сьогодні» (під ним — товста сіра лінія)
                    const todayKyivDayRow = kyivDayFromISO(new Date().toISOString());
                    const dateField = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
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

                    return (
                    <>
                    {clientsForTable.map((client, index) => {
                    const activityKeys = client.lastActivityKeys ?? [];
                    const hasActivity = (k: string) => activityKeys.includes(k);
                    const hasPrefix = (p: string) => activityKeys.some((k) => k.startsWith(p));
                    const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
                    const todayKyivDayForDots = kyivDayFromISO(new Date().toISOString());
                    const activityIsToday = client.lastActivityAt
                      ? kyivDayFromISO(client.lastActivityAt) === todayKyivDayForDots
                      : false;
                    const lastMessageAtToday = client.lastMessageAt
                      ? kyivDayFromISO(client.lastMessageAt) === todayKyivDayForDots
                      : false;

                    const showMessageDot = hasActivity('message');
                    const showPaidDot = hasPrefix('paidService');
                    const showConsultDot = hasPrefix('consultation');
                    const showMasterDot = isActiveMode && activityIsToday && Boolean(
                      hasActivity('masterId') ||
                        hasPrefix('serviceMaster') ||
                        hasPrefix('consultationMaster')
                    );
                    const paidAttendanceChanged = Boolean(hasActivity('paidServiceAttended') || hasActivity('paidServiceCancelled'));
                    const paidDateChanged = Boolean(hasActivity('paidServiceDate'));
                    const paidRecordCreatedChanged = Boolean(hasActivity('paidServiceRecordCreatedAt'));
                    const consultAttendanceChanged = Boolean(
                      hasActivity('consultationAttended') || hasActivity('consultationCancelled')
                    );
                    const consultDateChanged = Boolean(hasActivity('consultationBookingDate'));
                    const consultRecordCreatedChanged = Boolean(hasActivity('consultationRecordCreatedAt'));
                    // Одна крапочка на клієнта: winningKey — подія з найновішим часом сьогодні (щоб крапка переїжджала при створенні запису після повідомлення).
                    // Якщо дат немає — fallback на пріоритет за списком.
                    const DOT_PRIORITY: string[] = [
                      'statusId', 'chatStatusId', 'message', 'binotel_call',
                      'consultationAttended', 'consultationCancelled', 'consultationBookingDate', 'consultationRecordCreatedAt',
                      'paidServiceAttended', 'paidServiceCancelled', 'paidServiceDate', 'paidServiceRecordCreatedAt',
                      'paidServiceTotalCost',
                    ];
                    const inTodayBlock = activityIsToday || lastMessageAtToday;
                    const getKeyDate = (key: string): number | null => {
                      const raw =
                        key === 'message' ? client.lastMessageAt
                        : key === 'consultationRecordCreatedAt' ? (client as any).consultationRecordCreatedAt
                        : key === 'consultationBookingDate' ? client.consultationBookingDate
                        : (key === 'consultationAttended' || key === 'consultationCancelled') ? (client as any).consultationAttendanceSetAt
                        : key === 'statusId' ? client.statusSetAt
                        : key === 'chatStatusId' ? (client as any).chatStatusSetAt
                        : key === 'binotel_call' ? (client as any).binotelLatestCallStartTime
                        : key === 'paidServiceRecordCreatedAt' ? (client as any).paidServiceRecordCreatedAt
                        : key === 'paidServiceDate' ? client.paidServiceDate
                        : (key === 'paidServiceAttended' || key === 'paidServiceCancelled') ? (client as any).paidServiceAttendanceSetAt
                        : null;
                      if (!raw) return null;
                      const t = new Date(raw).getTime();
                      return Number.isFinite(t) ? t : null;
                    };
                    const candidateKeys = isActiveMode && inTodayBlock
                      ? DOT_PRIORITY.filter((k) => hasActivity(k) || (
                          k === 'message' && lastMessageAtToday ||
                          (k === 'consultationRecordCreatedAt' && (client as any).consultationRecordCreatedAt && kyivDayFromISO(String((client as any).consultationRecordCreatedAt)) === todayKyivDayForDots) ||
                          (k === 'consultationBookingDate' && client.consultationBookingDate && kyivDayFromISO(String(client.consultationBookingDate)) === todayKyivDayForDots) ||
                          (k === 'statusId' && client.statusSetAt && kyivDayFromISO(String(client.statusSetAt)) === todayKyivDayForDots) ||
                          (['consultationAttended', 'consultationCancelled'].includes(k) && (client as any).consultationAttendanceSetAt && kyivDayFromISO(String((client as any).consultationAttendanceSetAt)) === todayKyivDayForDots) ||
                          (k === 'paidServiceRecordCreatedAt' && (client as any).paidServiceRecordCreatedAt && kyivDayFromISO(String((client as any).paidServiceRecordCreatedAt)) === todayKyivDayForDots) ||
                          (k === 'paidServiceDate' && client.paidServiceDate && kyivDayFromISO(String(client.paidServiceDate)) === todayKyivDayForDots)
                        ))
                      : [];
                    const winningKeyByTime = candidateKeys.length > 0
                      ? candidateKeys.reduce<{ key: string; ts: number } | null>((best, k) => {
                          const ts = getKeyDate(k);
                          if (ts == null) return best;
                          if (!best || ts > best.ts) return { key: k, ts };
                          return best;
                        }, null)?.key ?? null
                      : null;
                    let fallbackKey: string | null = null;
                    if (isActiveMode && inTodayBlock && !winningKeyByTime) {
                      if (lastMessageAtToday) {
                        fallbackKey = 'message';
                      } else {
                      const consultSetToday = (client as any).consultationAttendanceSetAt
                        && kyivDayFromISO(String((client as any).consultationAttendanceSetAt)) === todayKyivDayForDots;
                      const statusSetToday = client.statusSetAt
                        && kyivDayFromISO(String(client.statusSetAt)) === todayKyivDayForDots;
                      if (consultSetToday && (client.consultationAttended !== null || (client as any).consultationCancelled)) {
                        fallbackKey = (client as any).consultationCancelled ? 'consultationCancelled' : 'consultationAttended';
                      } else if (statusSetToday) {
                        fallbackKey = 'statusId';
                      } else if (client.paidServiceDate && (client.paidServiceAttended !== null || (client as any).paidServiceCancelled)) {
                        const paidCreatedAt = (client as any).paidServiceRecordCreatedAt;
                        const paidCreatedToday = paidCreatedAt && kyivDayFromISO(String(paidCreatedAt)) === todayKyivDayForDots;
                        if (paidCreatedToday) fallbackKey = (client as any).paidServiceCancelled ? 'paidServiceCancelled' : 'paidServiceAttended';
                        else fallbackKey = (client as any).paidServiceCancelled ? 'paidServiceCancelled' : 'paidServiceAttended';
                      } else if ((client as any).consultationRecordCreatedAt && kyivDayFromISO(String((client as any).consultationRecordCreatedAt)) === todayKyivDayForDots) {
                        fallbackKey = 'consultationRecordCreatedAt';
                      } else if (client.consultationBookingDate && kyivDayFromISO(String(client.consultationBookingDate)) === todayKyivDayForDots) {
                        fallbackKey = 'consultationBookingDate';
                      }
                      }
                    }
                    const winningKey = winningKeyByTime ?? fallbackKey;
                    const showStatusDot = winningKey === 'statusId';
                    const kyivDayFmtRow = new Intl.DateTimeFormat('en-CA', {
                      timeZone: 'Europe/Kyiv',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    });
                    const todayKyivDayRow = kyivDayFmtRow.format(new Date());
                    const updatedKyivDayRow = client.updatedAt ? kyivDayFmtRow.format(new Date(client.updatedAt)) : '';

                    const showBorder = isActiveMode ? index === firstTodayIndex : index === firstCreatedTodayIndex;
                    return (
                      <>
                        <tr key={client.id} className={showBorder ? "border-b-[3px] border-gray-300" : ""}>
                      <td className="px-1 sm:px-2 py-1 text-xs" style={getStickyColumnStyle(columnWidths.number, getStickyLeft(0), false)}>{index + 1}</td>
                      <td className="px-0 py-1 text-xs whitespace-nowrap" style={getStickyColumnStyle(columnWidths.act, getStickyLeft(1), false)}>
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
                            {(() => {
                              const u = client.updatedAt ? new Date(client.updatedAt).getTime() : 0;
                              const m = client.lastMessageAt ? new Date(client.lastMessageAt).getTime() : 0;
                              const effectiveAct = Math.max(u, m);
                              const effectiveActDate = Number.isFinite(effectiveAct) && effectiveAct > 0 ? new Date(effectiveAct).toISOString() : null;
                              return effectiveActDate ? formatDateShortYear(effectiveActDate) : '-';
                            })()}
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
                      <td className="px-0 py-1" style={getStickyColumnStyle(columnWidths.avatar, getStickyLeft(2), false)}>
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
                              onClick={avatarSrc ? () => setFullscreenAvatar({ src: avatarSrc, username }) : undefined}
                            />
                          );
                        })()}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap overflow-hidden" style={getStickyColumnStyle(columnWidths.name, getStickyLeft(3), false)}>
                        <span className="flex flex-col leading-none min-w-0">
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
                            // Динамічне обчислення spend з колонки "Продажі" (client.spent)
                            // Цифри в бейджах оновлюються автоматично при зміні spend
                            const spendRaw = (client.spent ?? 0) as unknown;
                            const spendValue = (() => {
                              if (typeof spendRaw === "string") {
                                const cleaned = spendRaw.replace(/\s+/g, "");
                                const num = Number(cleaned);
                                return Number.isFinite(num) ? num : 0;
                              }
                              const num = Number(spendRaw);
                              return Number.isFinite(num) ? num : 0;
                            })();
                            // Умови відображення бейджів
                            const spendShowMega = spendValue > 1000000;
                            const spendShowStar = spendValue >= 100000;
                            const spendShowCircleTen = spendValue >= 20000 && spendValue < 100000;
                            const spendShowCircleOne = spendValue >= 10000 && spendValue < 20000;
                            const spendShowCircleEmpty = spendValue < 10000;
                            // Динамічне обчислення цифр для кружечків (десятки тисяч: 20k-90k)
                            const spendCircleRaw = Math.floor(spendValue / 10000);
                            const spendCircleNumber = Math.min(9, Math.max(2, spendCircleRaw));
                            // Динамічне обчислення цифр для зірок (сотні тисяч: 100k-900k)
                            const spendStarRaw = Math.floor(spendValue / 100000);
                            const spendStarNumber = Math.min(9, Math.max(1, spendStarRaw));
                            const spendShowStarNumber = spendValue > 200000;
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
                                  onClick={(e) => e.stopPropagation()}
                                >
                                {spendShowMega ? (
                                  <SpendMegaBadge />
                                ) : spendShowStar ? (
                                  <SpendStarBadge
                                    size={spendShowStarNumber ? 22 : 18}
                                    number={spendShowStarNumber ? spendStarNumber : undefined}
                                    fontSize={spendShowStarNumber ? 8 : 12}
                                  />
                                ) : spendShowCircleTen ? (
                                  <SpendCircleBadge number={spendCircleNumber} />
                                ) : spendShowCircleOne ? (
                                  <SpendCircleBadge number={1} />
                                ) : spendShowCircleEmpty ? (
                                  <SpendCircleBadge />
                                ) : (
                                  <ClientBadgeIcon />
                                )}
                                </a>
                              ) : (
                                <a
                                  href={instagramUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
                                  title="Клік для копіювання Instagram username"
                                  aria-label="Копіювати Instagram username"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    const usernameToCopy = client.instagramUsername?.trim();
                                    if (usernameToCopy && usernameToCopy !== "NO INSTAGRAM" && !usernameToCopy.startsWith("no_instagram_") && !usernameToCopy.startsWith("missing_instagram_")) {
                                      try {
                                        await navigator.clipboard.writeText(usernameToCopy);
                                        // Тимчасово змінюємо title для візуального фідбеку
                                        const target = e.currentTarget;
                                        const originalTitle = target.title;
                                        target.title = `Скопійовано: ${usernameToCopy}`;
                                        setTimeout(() => {
                                          target.title = originalTitle;
                                        }, 2000);
                                      } catch (err) {
                                        console.error('Помилка копіювання:', err);
                                        // Fallback для старих браузерів
                                        const textArea = document.createElement('textarea');
                                        textArea.value = usernameToCopy;
                                        textArea.style.position = 'fixed';
                                        textArea.style.left = '-999999px';
                                        document.body.appendChild(textArea);
                                        textArea.select();
                                        try {
                                          document.execCommand('copy');
                                          const target = e.currentTarget;
                                          const originalTitle = target.title;
                                          target.title = `Скопійовано: ${usernameToCopy}`;
                                          setTimeout(() => {
                                            target.title = originalTitle;
                                          }, 2000);
                                        } catch (fallbackErr) {
                                          console.error('Помилка fallback копіювання:', fallbackErr);
                                        }
                                        document.body.removeChild(textArea);
                                      }
                                    }
                                  }}
                                >
                                  {client.instagramUsername?.startsWith('binotel_') ? <BinotelLeadBadgeIcon /> : <LeadBadgeIcon />}
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
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                        <span className="min-w-0 overflow-hidden">{username}</span>
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
                            const nameOneLineTruncated = nameOneLine.length > 20 
                              ? nameOneLine.substring(0, 20) + "..." 
                              : nameOneLine;
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
                                onClick={(e) => e.stopPropagation()}
                              >
                                {spendShowMega ? (
                                  <SpendMegaBadge />
                                ) : spendShowStar ? (
                                  <SpendStarBadge
                                    size={spendShowStarNumber ? 22 : 18}
                                    number={spendShowStarNumber ? spendStarNumber : undefined}
                                    fontSize={spendShowStarNumber ? 8 : 12}
                                  />
                                ) : spendShowCircleTen ? (
                                  <SpendCircleBadge number={spendCircleNumber} />
                                ) : spendShowCircleOne ? (
                                  <SpendCircleBadge number={1} />
                                ) : spendShowCircleEmpty ? (
                                  <SpendCircleBadge />
                                ) : (
                                  <ClientBadgeIcon />
                                )}
                              </a>
                            ) : (
                              <a
                                href={instagramUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
                                title="Клік для копіювання Instagram username"
                                aria-label="Копіювати Instagram username"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const usernameToCopy = client.instagramUsername?.trim();
                                  if (usernameToCopy && usernameToCopy !== "NO INSTAGRAM" && !usernameToCopy.startsWith("no_instagram_") && !usernameToCopy.startsWith("missing_instagram_")) {
                                    try {
                                      await navigator.clipboard.writeText(usernameToCopy);
                                      // Тимчасово змінюємо title для візуального фідбеку
                                      const target = e.currentTarget;
                                      const originalTitle = target.title;
                                      target.title = `Скопійовано: ${usernameToCopy}`;
                                      setTimeout(() => {
                                        target.title = originalTitle;
                                      }, 2000);
                                    } catch (err) {
                                      console.error('Помилка копіювання:', err);
                                      // Fallback для старих браузерів
                                      const textArea = document.createElement('textarea');
                                      textArea.value = usernameToCopy;
                                      textArea.style.position = 'fixed';
                                      textArea.style.left = '-999999px';
                                      document.body.appendChild(textArea);
                                      textArea.select();
                                      try {
                                        document.execCommand('copy');
                                        const target = e.currentTarget;
                                        const originalTitle = target.title;
                                        target.title = `Скопійовано: ${usernameToCopy}`;
                                        setTimeout(() => {
                                          target.title = originalTitle;
                                        }, 2000);
                                      } catch (fallbackErr) {
                                        console.error('Помилка fallback копіювання:', fallbackErr);
                                      }
                                      document.body.removeChild(textArea);
                                    }
                                  }
                                }}
                              >
                                {client.instagramUsername?.startsWith('binotel_') ? <BinotelLeadBadgeIcon /> : <LeadBadgeIcon />}
                              </a>
                            );

                            return (
                              <>
                                <div className="flex items-center gap-1 min-w-0 max-w-full">
                                  {typeBadge}
                                {isNormalInstagram ? (
                                  <a
                                    href={`https://instagram.com/${username}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                      className="link link-primary flex items-center gap-1 min-w-0 max-w-full"
                                    title={`${nameOneLine} - https://instagram.com/${username}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                      <span className="min-w-0 truncate" title={nameOneLine}>{nameOneLineTruncated}</span>
                                      {visitsSuffix ? (
                                        <span className="shrink-0 opacity-80">{` ${visitsSuffix}`}</span>
                                      ) : null}
                                  </a>
                                ) : (
                                    <span className="flex items-center gap-1 min-w-0 max-w-full" title={nameOneLine}>
                                      <span className="min-w-0 truncate">{nameOneLineTruncated}</span>
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
                      {!hideSalesColumn && (
                        <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap" style={getColumnStyle(columnWidths.sales, true)}>
                          <span className="flex flex-col items-start leading-none">
                            <span className="text-left">
                              {client.spent !== null && client.spent !== undefined
                                ? `${Math.round(client.spent / 1000).toLocaleString('uk-UA')} тис.`
                                : '-'}
                            </span>
                          </span>
                        </td>
                      )}
                      {/* Днів з останнього візиту (після “Продажі”) */}
                      <td className="px-1 sm:px-1 py-1 text-xs whitespace-nowrap tabular-nums text-left" style={getColumnStyle(columnWidths.days, true)}>
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

                          // Формуємо tooltip з датою останнього візиту (тільки з Altegio API)
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
                              className={`inline-flex items-center justify-start rounded-full px-2 py-0.5 tabular-nums text-[12px] font-normal leading-none ${cls}`}
                              title={tooltipText}
                            >
                              {hasDays ? days : "-"}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-0.5 py-1 align-middle" style={getColumnStyle(columnWidths.communication, true)}>
                        <CommunicationChannelPicker
                          value={client.communicationChannel}
                          onChange={async (next) => {
                            await onClientUpdate(client.id, { communicationChannel: next });
                          }}
                        />
                      </td>
                      {/* Переписка: число повідомлень (клік → історія) + текст-статус */}
                      <td
                        className={
                          chatStatusUiVariant === 'v2'
                            ? "px-1 sm:px-2 py-1 text-xs whitespace-normal text-left align-top"
                            : "px-1 sm:px-2 py-1 text-xs whitespace-nowrap overflow-hidden text-left align-top"
                        }
                        style={{ ...getColumnStyle(columnWidths.inst, true), minHeight: INST_CALLS_CELL_MIN_HEIGHT }}
                      >
                          {(() => {
                          const total =
                            typeof (client as any).messagesTotal === 'number' ? (client as any).messagesTotal : 0;
                          const needs = Boolean((client as any).chatNeedsAttention);
                          const showInstDot = winningKey === 'message';
                          const showChatStatusDot = winningKey === 'chatStatusId';
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

                              const lastMessageDateStr = formatDateDDMMYY(client.lastMessageAt);
                              return (
                            <span className="flex flex-col items-start gap-0.5">
                                <div className="flex items-center justify-start gap-2 min-w-0">
                                <button
                                className={`relative inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums hover:opacity-80 transition-opacity ${countClass} text-[12px] font-normal leading-none`}
                                onClick={() => setMessagesHistoryClient(client)}
                                title={needs ? 'Є нові повідомлення — відкрити історію' : 'Відкрити історію повідомлень'}
                                type="button"
                                >
                                {total}
                                {showInstDot ? (
                                  <CornerRedDot title="Тригер: нове повідомлення" />
                                ) : null}
                                </button>

                              {showStatus ? (
                                <WithCornerRedDot
                                  show={showChatStatusDot}
                                  title="Тригер: змінився/встановлений статус переписки"
                                  dotClassName="-top-[5px] -right-[4px]"
                                >
                                  <span
                                    className={
                                      chatStatusUiVariant === 'v2'
                                        ? 'inline-flex min-w-0 max-w-[50px] items-start rounded-full px-2 py-0.5 text-[11px] font-normal leading-[1.05]'
                                        : 'inline-flex min-w-0 max-w-[50px] items-center rounded-full px-2 py-0.5 text-[11px] font-normal leading-none overflow-hidden'
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
                                </WithCornerRedDot>
                              ) : null}
                            </div>
                                {lastMessageDateStr !== '-' ? (
                                  <span
                                    className="text-[10px] leading-none opacity-60"
                                    title={`Останнє повідомлення: ${lastMessageDateStr}`}
                                  >
                                    {lastMessageDateStr}
                                  </span>
                                ) : null}
                            </span>
                          );
                        })()}
                      </td>
                      <td
                        className="px-2 sm:px-3 py-1 text-xs text-center align-top"
                        style={{ ...getColumnStyle(columnWidths.calls, true), minHeight: INST_CALLS_CELL_MIN_HEIGHT }}
                      >
                        {(client as any).binotelCallsCount != null &&
                        (client as any).binotelCallsCount > 0 ? (
                          <span
                            className="inline-flex flex-col items-center gap-0.5"
                            title={formatDateDDMMYYHHMM((client as any).binotelLatestCallStartTime)}
                          >
                            <span className="inline-flex items-center gap-1">
                              <WithCornerRedDot
                                show={winningKey === 'binotel_call'}
                                title="Тригер: дзвінок Binotel"
                                dotClassName="-top-[5px] -right-[4px]"
                              >
                                <button
                                  type="button"
                                  onClick={() => setBinotelHistoryClient(client)}
                                  className="inline-flex items-center"
                                  title={`Історія дзвінків Binotel. Останній: ${formatDateDDMMYYHHMM((client as any).binotelLatestCallStartTime)}`}
                                >
                                  <BinotelCallTypeIcon
                                    callType={(client as any).binotelLatestCallType || "incoming"}
                                    success={["ANSWER", "VM-SUCCESS", "SUCCESS"].includes(
                                      (client as any).binotelLatestCallDisposition || ""
                                    )}
                                    size={18}
                                  />
                                </button>
                              </WithCornerRedDot>
                              {(() => {
                                const disp = (client as any).binotelLatestCallDisposition || "";
                                const isSuccess = ["ANSWER", "VM-SUCCESS", "SUCCESS"].includes(disp);
                                const hasRecording =
                                  (client as any).binotelLatestCallRecordingUrl ||
                                  (client as any).binotelLatestCallGeneralID;
                                if (!hasRecording || !isSuccess) return null;
                                return (
                                  <PlayRecordingButton
                                    recordingUrl={(client as any).binotelLatestCallRecordingUrl}
                                    generalCallID={(client as any).binotelLatestCallGeneralID}
                                    title="Прослухати останній запис"
                                    onPlayRequest={(url) => setInlineRecordingUrl(url)}
                                    listenDisabled={!canListenCalls}
                                  />
                                );
                              })()}
                            </span>
                            {(() => {
                              const startTime = (client as any).binotelLatestCallStartTime;
                              const dateStr = formatDateDDMMYY(startTime);
                              if (dateStr === '-') return null;
                              return (
                                <span
                                  className="text-[10px] leading-none opacity-60"
                                  title={formatDateDDMMYYHHMM(startTime)}
                                >
                                  {dateStr}
                                </span>
                              );
                            })()}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="px-2 sm:px-3 py-1 text-xs text-left align-top"
                        style={getColumnStyle(columnWidths.callStatus, true)}
                      >
                        {(client.altegioClientId || client.instagramUsername?.startsWith('binotel_')) ? (
                          <DirectStatusCell
                            client={client}
                            statuses={statuses}
                            showDot={showStatusDot}
                            dotTitle="Тригер: змінився/встановлений статус"
                            onStatusChange={async (u) => {
                              await onClientUpdate(u.clientId, {
                                statusId: u.statusId,
                                ...(client.instagramUsername && { _fallbackInstagram: client.instagramUsername }),
                              });
                            }}
                            onMenuOpen={onStatusMenuOpen}
                          />
                        ) : null}
                      </td>
                      <td className="px-3 sm:px-4 py-1 text-xs whitespace-nowrap text-left align-top" style={getColumnStyle(columnWidths.state, true)}>
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

                          // Нова логіка відображення стану (див. .cursor/rules/direct-state-icons.mdc)
                          const isPaidFutureOrToday = Boolean(paidKyivDay && paidKyivDay >= todayKyivDay);
                          const isPaidToday = Boolean(paidKyivDay && paidKyivDay === todayKyivDay);

                          const stateDatePaid = formatDateDDMMYY(client.paidServiceRecordCreatedAt);
                          const stateDateConsult = formatDateDDMMYY(client.consultationRecordCreatedAt);
                          const stateDateLead = formatDateDDMMYY(client.firstContactDate || client.createdAt);

                          // 1. 🔥 Вогник — та сама формула, що F4 у статистиці (див. direct-f4-client-match)
                          if (clientShowsF4SoldFireNow(client)) {
                            const title = stateDatePaid !== '-' ? `Новий клієнт (F4): перший платний запис у місяці. Дата встановлення: ${stateDatePaid}` : "Новий клієнт (F4): перший платний запис у місяці. Натисніть для історії станів";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <span className="text-[24px] leading-none inline-flex items-center justify-center">🔥</span>
                                  </button>
                                </span>
                                {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
                              </div>
                            );
                          }

                          // 2. Червона дата (букінгдата < сьогодні) → ⚠️ Жовтий трикутник
                          if (client.paidServiceDate && isPaidPast) {
                            const title = stateDatePaid !== '-' ? `Букінгдата в минулому. Дата встановлення: ${stateDatePaid}` : "Букінгдата в минулому. Натисніть для історії станів";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <span className="text-[20px] leading-none inline-flex items-center justify-center">⚠️</span>
                                  </button>
                                </span>
                                {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
                              </div>
                            );
                          }

                          // 3. Червона дата + немає перезапису (no-show або cancelled) — ⚠️ окремо обробляється нижче

                          // 4. 🔁 Перезапис — дата створення поточного запису = букінгдата попереднього (paidServiceIsRebooking)
                          if (
                            client.paidServiceDate &&
                            isPaidToday &&
                            hasPaidReschedule &&
                            !client.paidServiceCancelled &&
                            client.paidServiceAttended !== false
                          ) {
                            const title = stateDatePaid !== '-' ? `Перезапис. Дата встановлення: ${stateDatePaid}` : "Перезапис: дата створення = букінг-день попереднього. Натисніть для історії станів";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <span className="text-[18px] leading-none inline-flex items-center justify-center">🔁</span>
                                  </button>
                                </span>
                                {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
                              </div>
                            );
                          }

                          // 5. 🔁 Перезапис на майбутнє — та сама умова paidServiceIsRebooking
                          if (
                            client.paidServiceDate &&
                            isPaidFutureOrToday &&
                            hasPaidReschedule &&
                            !client.paidServiceCancelled &&
                            client.paidServiceAttended !== false
                          ) {
                            const title = stateDatePaid !== '-' ? `Перезапис на майбутнє. Дата встановлення: ${stateDatePaid}` : "Перезапис на майбутнє. Натисніть для історії станів";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <span className="text-[18px] leading-none inline-flex items-center justify-center">🔁</span>
                                  </button>
                                </span>
                                {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
                              </div>
                            );
                          }

                          // 6. Букінгдата сьогодні або в майбутньому → ⏳ (винятки: 🔥 Продаж, 🔁 Перезапис — вже оброблені)
                          if (client.paidServiceDate && isPaidFutureOrToday) {
                            const title = stateDatePaid !== '-' ? `Очікування. Дата встановлення: ${stateDatePaid}` : "Очікування: букінгдата сьогодні або в майбутньому. Натисніть для історії станів";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <span className="text-[20px] leading-none inline-flex items-center justify-center">⏳</span>
                                  </button>
                                </span>
                                {stateDatePaid !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDatePaid}</span>}
                              </div>
                            );
                          }

                          // 3. Успішна консультація без запису (Не продали)
                          if (client.consultationAttended === true && isConsultPast && (!client.paidServiceDate || !client.signedUpForPaidService)) {
                            // Дата під 💔: спочатку коли встановлено відвідування, потім створення запису в Altegio, потім дата букінгу
                            const neProdalyIso =
                              (client as any).consultationAttendanceSetAt ??
                              client.consultationRecordCreatedAt ??
                              client.consultationBookingDate;
                            const stateDateNeProdaly = formatDateDDMMYY(neProdalyIso);
                            const title = stateDateNeProdaly !== '-' ? `Не продали. Дата встановлення: ${stateDateNeProdaly}` : "Не продали. Натисніть для історії станів";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <span className="text-[24px] leading-none inline-flex items-center justify-center">💔</span>
                                  </button>
                                </span>
                                {stateDateNeProdaly !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateNeProdaly}</span>}
                              </div>
                            );
                          }

                          // Консультація з минулою датою + відсутній платний запис — рожевий календар
                          if (
                            client.consultationBookingDate &&
                            isConsultPast &&
                            (!client.paidServiceDate || !client.signedUpForPaidService)
                          ) {
                            const title = stateDateConsult !== '-' ? `Консультація з минулою датою. Дата встановлення: ${stateDateConsult}` : "Консультація з минулою датою (немає платного запису)";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <StateIcon state="consultation-past" size={28} />
                                  </button>
                                </span>
                                {stateDateConsult !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateConsult}</span>}
                              </div>
                            );
                          }

                          // Якщо немає платної послуги, але є консультація - показуємо стан консультації
                          if (client.consultationBookingDate) {
                            const title = stateDateConsult !== '-' ? `Консультація. Дата встановлення: ${stateDateConsult}` : "Консультація";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <StateIcon state="consultation-booked" size={28} />
                                  </button>
                                </span>
                                {stateDateConsult !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateConsult}</span>}
                              </div>
                            );
                          }

                          // Binotel-лід: магентова хмарка (#AF0087)
                          if (client.state === 'binotel-lead') {
                            const title = stateDateLead !== '-' ? `Binotel-лід (дзвінок). Дата: ${stateDateLead}` : "Binotel-лід (дзвінок з номера без клієнта в Direct)";
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="inline-flex items-center justify-center">
                                  <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                    <StateIcon state="binotel-lead" size={28} />
                                  </button>
                                </span>
                                {stateDateLead !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateLead}</span>}
                              </div>
                            );
                          }

                          // Лід без консультації/запису: Новий лід (синя хмарка) — перший контакт сьогодні; зелена — з наступного дня
                          if (!client.altegioClientId && !client.paidServiceDate && !client.consultationBookingDate) {
                            const firstDate = client.firstContactDate || client.createdAt;
                            const firstDateObj = firstDate ? new Date(firstDate) : null;
                            if (firstDateObj && !isNaN(firstDateObj.getTime())) {
                              const kyivDayFmtLead = new Intl.DateTimeFormat('en-CA', {
                                timeZone: 'Europe/Kyiv',
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                              });
                              const todayKyivStr = kyivDayFmtLead.format(new Date());
                              const firstKyivStr = kyivDayFmtLead.format(firstDateObj);
                              const todayStart = new Date(todayKyivStr + 'T00:00:00.000Z').getTime();
                              const firstStart = new Date(firstKyivStr + 'T00:00:00.000Z').getTime();
                              const daysSinceFirst = Math.floor((todayStart - firstStart) / 86400000);
                              if (daysSinceFirst === 0) {
                                const title = stateDateLead !== '-' ? `Новий лід. Дата встановлення: ${stateDateLead}` : "Новий лід (перший контакт сьогодні). Натисніть для історії станів";
                                return (
                                  <div className="flex flex-col items-start gap-0.5">
                                    <span className="inline-flex items-center justify-center">
                                      <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                        <StateIcon state="new-lead" size={28} />
                                      </button>
                                    </span>
                                    {stateDateLead !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateLead}</span>}
                                  </div>
                                );
                              }
                              const title = stateDateLead !== '-' ? `Повідомлення / Лід. Дата встановлення: ${stateDateLead}` : "Повідомлення / Лід (перший контакт раніше). Натисніть для історії станів";
                              return (
                                <div className="flex flex-col items-start gap-0.5">
                                  <span className="inline-flex items-center justify-center">
                                    <button type="button" className="hover:opacity-70 transition-opacity p-0" title={title} onClick={() => setStateHistoryClient(client)}>
                                      <StateIcon state="message" size={28} />
                                    </button>
                                  </span>
                                  {stateDateLead !== '-' && <span className="text-[10px] leading-none opacity-60">{stateDateLead}</span>}
                                </div>
                              );
                            }
                          }

                          return '';
                          })()}
                      </td>
                      {(() => {
                        // Перевіряємо, чи консультація створена сьогодні та чи має сьогоднішню дату (для фону колонки)
                        const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
                          timeZone: 'Europe/Kyiv',
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        });
                        const todayKyivDay = kyivDayFmt.format(new Date());
                        
                        const consultCreatedAtDate = client.consultationRecordCreatedAt
                          ? new Date(client.consultationRecordCreatedAt)
                          : null;
                        const consultCreatedToday = consultCreatedAtDate && !isNaN(consultCreatedAtDate.getTime())
                          ? kyivDayFmt.format(consultCreatedAtDate) === todayKyivDay
                          : false;
                        
                        // Перевіряємо, чи дата консультації = сьогодні (для зеленого фону)
                        const consultIsToday = client.consultationBookingDate
                          ? (() => {
                              try {
                                const dateValue = typeof client.consultationBookingDate === 'string' 
                                  ? client.consultationBookingDate.trim() 
                                  : client.consultationBookingDate;
                                const dateStr = typeof dateValue === 'string' ? dateValue : String(dateValue);
                                const isoDateMatch = dateStr.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/);
                                if (!isoDateMatch) {
                                  const parts = dateStr.split(/\s+/);
                                  for (const part of parts) {
                                    const testDate = new Date(part);
                                    if (!isNaN(testDate.getTime()) && part.match(/^\d/)) {
                                      return kyivDayFmt.format(testDate) === todayKyivDay;
                                    }
                                  }
                                  return false;
                                }
                                const appointmentDate = new Date(isoDateMatch[0]);
                                if (isNaN(appointmentDate.getTime())) {
                                  return false;
                                }
                                return kyivDayFmt.format(appointmentDate) === todayKyivDay;
                              } catch {
                                return false;
                              }
                            })()
                          : false;
                        
                        return (
                          <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-left" style={getColumnStyle(columnWidths.consultation, true)}>
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
                              const formattedDateStr = formatDateShortYear(dateStr);
                              const isOnline = client.isOnlineConsultation || false;
                              
                              // Форматуємо дату створення запису для tooltip (коли створено запис в Altegio)
                              const createdAtDate = client.consultationRecordCreatedAt
                                ? new Date(client.consultationRecordCreatedAt)
                                : null;
                              const createdAtStr = createdAtDate && !isNaN(createdAtDate.getTime())
                                ? createdAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                                : null;
                              // Перевіряємо, чи запис створено сьогодні
                              const consultCreatedToday = createdAtDate && !isNaN(createdAtDate.getTime())
                                ? kyivDayFmt.format(createdAtDate) === todayKyivDay
                                : false;
                              
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
                              // - Виняток: attendance=2 (підтвердив запис) — синю галочку показуємо і для майбутніх дат
                              // - ⏳ показуємо у день консультації та для майбутніх, якщо attendance ще нема
                              // - ❓ показуємо лише з наступного дня (коли дата < сьогодні, Kyiv) і attendance ще нема
                              const consultStatusDateEst = formatDateDDMMYYHHMM(client.consultationAttendanceSetAt ?? client.consultationRecordCreatedAt);
                              const attIconCls = "text-[14px] leading-none";
                              const consultAttendanceValue = (client as any).consultationAttendanceValue;
                              const showConsultCheck = consultAttendanceValue === 2 ? true : (isPast || isToday);
                              let attendanceIcon = null;
                              if (client.consultationCancelled) {
                                attendanceIcon = (
                                  <span className={`text-orange-600 ${attIconCls}`} title={consultStatusDateEst !== '-' ? `Скасовано до дати консультації. Дата встановлення статусу: ${consultStatusDateEst}` : "Скасовано до дати консультації"}>
                                    🚫
                                  </span>
                                );
                              } else if (client.consultationAttended === true && showConsultCheck) {
                                const isConfirmed = consultAttendanceValue === 2;
                                attendanceIcon = (
                                  <span
                                    className={`inline-flex items-center justify-center ${attIconCls}`}
                                    title={consultStatusDateEst !== '-' ? `${isConfirmed ? 'Клієнтка підтвердила запис на консультацію' : 'Клієнтка прийшла на консультацію'}. Дата встановлення статусу: ${consultStatusDateEst}` : (isConfirmed ? 'Клієнтка підтвердила запис на консультацію' : 'Клієнтка прийшла на консультацію')}
                                  >
                                    {isConfirmed ? (
                                      <ConfirmedCheckIcon size={17} />
                                    ) : (
                                      <span className="text-[14px] leading-none">✅</span>
                                    )}
                                  </span>
                                );
                              } else if (client.consultationAttended === false && (isPast || isToday)) {
                                attendanceIcon = (
                                  <span className={`text-red-600 ${attIconCls}`} title={consultStatusDateEst !== '-' ? `Клієнтка не з'явилася на консультацію. Дата встановлення статусу: ${consultStatusDateEst}` : "Клієнтка не з'явилася на консультацію"}>
                                    ❌
                                  </span>
                                );
                              } else if (isPast) {
                                attendanceIcon = (
                                  <span
                                    className={`text-gray-500 ${attIconCls}`}
                                    title={consultStatusDateEst !== '-' ? `Немає підтвердження відвідування консультації. Дата встановлення статусу: ${consultStatusDateEst}` : "Немає підтвердження відвідування консультації (встановіть attendance в Altegio)"}
                                  >
                                    ❓
                                  </span>
                                );
                              } else {
                                attendanceIcon = (
                                  <span className={`text-gray-700 ${attIconCls}`} title={consultStatusDateEst !== '-' ? `Присутність: Очікується. Дата встановлення статусу: ${consultStatusDateEst}` : "Присутність: Очікується"}>
                                    ⏳
                                  </span>
                                );
                              }
                              
                              const baseTitle = isPast 
                                ? (isOnline ? "Минулий запис на онлайн-консультацію" : "Минулий запис на консультацію")
                                : (isOnline ? "Майбутній запис на онлайн-консультацію" : "Майбутній запис на консультацію");
const dateEstablished = formatDateDDMMYYHHMM(client.consultationRecordCreatedAt);
                              const dateEstablishedDisplay = formatDateDDMMYY(client.consultationRecordCreatedAt);
                              const consultantFull = (client.consultationMasterName || '').toString().trim();
                              let tooltipTitle = dateEstablished !== '-'
                                ? `${baseTitle}\nЗапис створено: ${dateEstablished}`
                                : baseTitle;
                              if (consultantFull) {
                                tooltipTitle += `\nМайстер: ${consultantFull}`;
                              }
                              
                              const consultAttendanceDotTitle = "Тригер: змінилась присутність консультації";
                              const consultDateDotTitle = 'Тригер: змінилась дата консультації';
                              // Якщо змінився статус присутності — крапочка біля іконки статусу (синя галочка)
                              // Fallback: якщо lastActivityKeys перезаписано пізнішим синком, але статус встановлено сьогодні — показуємо на галочці
                              const isConsultStatusSetToday = Boolean(
                                client.consultationAttendanceSetAt &&
                                kyivDayFromISO(String(client.consultationAttendanceSetAt)) === todayKyivDayForDots
                              );
                              const hasConsultAttendanceChange =
                                hasActivity('consultationAttended') ||
                                hasActivity('consultationCancelled') ||
                                ((winningKey === 'consultationBookingDate' || winningKey === 'consultationRecordCreatedAt') &&
                                  (client as any).consultationAttendanceValue === 2 &&
                                  isConsultStatusSetToday);
                              // Крапка біля статусу (⏳/✅/❌), а не біля букінгдати: для consultationBookingDate/consultationRecordCreatedAt показуємо на іконці статусу
                              const showDotOnConsultDate = false;
                              const consultationWinningKeys = ['consultationAttended', 'consultationCancelled', 'consultationBookingDate', 'consultationRecordCreatedAt'];
                              const showConsultAttendanceDotEffective = Boolean(
                                (winningKey === 'consultationAttended' || winningKey === 'consultationCancelled') ||
                                (winningKey === 'consultationBookingDate' || winningKey === 'consultationRecordCreatedAt') ||
                                (hasConsultAttendanceChange && consultationWinningKeys.includes(winningKey ?? ''))
                              );
                              const hasPaidRecord = Boolean(client.signedUpForPaidService && client.paidServiceDate);
                              const compactConsultView = isPast && client.consultationAttended === true && hasPaidRecord;

                              if (compactConsultView) {
                                const compactTooltip = `Клієнтка прийшла на консультацію. Букінг: ${formattedDateStr}. Запис створено: ${dateEstablished}`;
                                return (
                                  <button
                                    type="button"
                                    className="p-0 w-full inline-flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-50"
                                    title={`${compactTooltip}\nНатисніть, щоб переглянути історію консультацій`}
                                    onClick={() => {
                                      if (!client.altegioClientId) return;
                                      setRecordHistoryType('consultation');
                                      setRecordHistoryClient(client);
                                    }}
                                    disabled={!client.altegioClientId}
                                  >
                                    <span className="text-[14px] leading-none text-green-600">✅</span>
                                  </button>
                                );
                              }

                              return (
                                <span className="flex flex-col items-start gap-0.5">
                                  <span className="flex items-center gap-[1ch]">
                                    <button
                                      className={
                                        "p-0 " +
                                        (isToday
                                          ? "text-green-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                          : isPast
                                          ? "text-amber-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                          : "text-blue-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50")
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
                                        <WithCornerRedDot show={showDotOnConsultDate} title={consultDateDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                          <span className={`rounded-full px-0 py-0.5 ${
                                            consultIsToday ? 'bg-green-200' : consultCreatedToday ? 'bg-gray-200' : ''
                                          }`}>
                                            {formattedDateStr}{isOnline ? "💻" : "📅"}
                                          </span>
                                        </WithCornerRedDot>
                                      </span>
                                    </button>{typeof client.consultationAttemptNumber === 'number' &&
                                    client.consultationAttemptNumber >= 2 ? (
                                      <span
                                        className="inline-flex items-center justify-center rounded-full bg-white border border-blue-300 text-blue-600 font-bold text-[12px] w-[20px] h-[20px]"
                                        title={`Повторна спроба консультації №${client.consultationAttemptNumber}`}
                                      >
                                        {client.consultationAttemptNumber}
                                      </span>
                                    ) : null}{attendanceIcon ? (
                                      <WithCornerRedDot show={showConsultAttendanceDotEffective} title={consultAttendanceDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                        {attendanceIcon}
                                      </WithCornerRedDot>
                                    ) : null}
                                  </span>

                                  {dateEstablishedDisplay !== '-' ? (
                                    <span
                                      className="text-[10px] leading-none opacity-60 max-w-[220px] sm:max-w-[320px] truncate text-left"
                                      title={`Запис створено: ${dateEstablished}${consultantFull ? `\nМайстер: ${consultantFull}` : ''}`}
                                    >
                                      {dateEstablishedDisplay}
                                    </span>
                                  ) : null}
                                </span>
                              );
                            } catch (err) {
                              console.error('[DirectClientTable] Error formatting consultationBookingDate:', err, client.consultationBookingDate);
                              return "";
                            }
                          })()
                        ) : (client as any).consultationDeletedInAltegio ? (
                          <span className="text-gray-500 italic" title="Візит/запис видалено в Altegio (404), консультацію очищено">
                            Видалено в Altegio
                          </span>
                        ) : (
                          ""
                        )}
                          </td>
                        );
                      })()}
                      {(() => {
                        // Перевіряємо, чи запис платної послуги створено сьогодні (для фону колонки)
                        const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
                          timeZone: 'Europe/Kyiv',
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        });
                        const todayKyivDay = kyivDayFmt.format(new Date());
                        const paidCreatedAtDate = client.paidServiceRecordCreatedAt
                          ? new Date(client.paidServiceRecordCreatedAt)
                          : null;
                        const paidCreatedToday = paidCreatedAtDate && !isNaN(paidCreatedAtDate.getTime())
                          ? kyivDayFmt.format(paidCreatedAtDate) === todayKyivDay
                          : false;
                        
                        // Перевіряємо, чи дата запису = сьогодні (для зеленого фону)
                        const paidIsToday = client.paidServiceDate
                          ? kyivDayFmt.format(new Date(client.paidServiceDate)) === todayKyivDay
                          : false;
                        
                        return (
                          <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-left" style={getColumnStyle(columnWidths.record, true)}>
                            {client.signedUpForPaidService && client.paidServiceDate ? (
                              (() => {
                                const paidKyivDay = kyivDayFmt.format(new Date(client.paidServiceDate)); // YYYY-MM-DD
                                const isPast = paidKyivDay < todayKyivDay;
                                const isToday = paidKyivDay === todayKyivDay;
                                const isPastOrToday = paidKyivDay <= todayKyivDay;
                                const dateStr = formatDateShortYear(client.paidServiceDate);
                                
                                // Форматуємо дату створення запису для tooltip (коли створено запис в Altegio)
                                const createdAtStr = paidCreatedAtDate && !isNaN(paidCreatedAtDate.getTime())
                                  ? paidCreatedAtDate.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                                  : null;
                            
                            // Визначаємо значок attendance
                            // Правило:
                            // - ✅/❌/🚫 показуємо тільки для минулих дат (не для майбутніх!)
                            // - Виняток: attendance=2 (підтвердив запис) — синю галочку показуємо і для майбутніх дат
                            // - ⏳ показуємо у день запису та для майбутніх, якщо attendance ще нема
                            // - ❓ показуємо лише з наступного дня (коли дата < сьогодні, Kyiv) і attendance ще нема
                            const paidStatusDateEst = formatDateDDMMYYHHMM(client.paidServiceAttendanceSetAt ?? client.paidServiceRecordCreatedAt);
                            const attIconCls = "text-[14px] leading-none";
                            const paidAttendanceValue = (client as any).paidServiceAttendanceValue;
                            const showPaidCheck = paidAttendanceValue === 2 ? true : (isPast || isToday);
                            let attendanceIcon = null;
                            if (client.paidServiceCancelled) {
                              attendanceIcon = (
                                <span className={`text-orange-600 ${attIconCls}`} title={paidStatusDateEst !== '-' ? `Скасовано до дати запису. Дата встановлення статусу: ${paidStatusDateEst}` : "Скасовано до дати запису"}>
                                  🚫
                                </span>
                              );
                            } else if (client.paidServiceAttended === true && showPaidCheck) {
                              const isConfirmed = paidAttendanceValue === 2;
                              attendanceIcon = (
                                <span
                                  className={`inline-flex items-center justify-center ${attIconCls}`}
                                  title={paidStatusDateEst !== '-' ? `${isConfirmed ? 'Клієнтка підтвердила запис на платну послугу' : 'Клієнтка прийшла на платну послугу'}. Дата встановлення статусу: ${paidStatusDateEst}` : (isConfirmed ? 'Клієнтка підтвердила запис на платну послугу' : 'Клієнтка прийшла на платну послугу')}
                                >
                                  {isConfirmed ? (
                                    <ConfirmedCheckIcon size={17} />
                                  ) : (
                                    <span className="text-[14px] leading-none">✅</span>
                                  )}
                                </span>
                              );
                            } else if (client.paidServiceAttended === false && isPast) {
                              attendanceIcon = (
                                <span className={`text-red-600 ${attIconCls}`} title={paidStatusDateEst !== '-' ? `Клієнтка не з'явилася на платну послугу. Дата встановлення статусу: ${paidStatusDateEst}` : "Клієнтка не з'явилася на платну послугу"}>
                                  ❌
                                </span>
                              );
                            } else if (isPast) {
                              attendanceIcon = (
                                <span
                                  className={`text-gray-500 ${attIconCls}`}
                                  title={paidStatusDateEst !== '-' ? `Немає підтвердження відвідування платної послуги. Дата встановлення статусу: ${paidStatusDateEst}` : "Немає підтвердження відвідування платної послуги (встановіть attendance в Altegio)"}
                                >
                                  ❓
                                </span>
                              );
                            } else {
                              attendanceIcon = (
                                <span className={`text-gray-700 ${attIconCls}`} title={paidStatusDateEst !== '-' ? `Присутність: Очікується. Дата встановлення статусу: ${paidStatusDateEst}` : "Присутність: Очікується"}>
                                  ⏳
                                </span>
                              );
                            }

                            // pendingIcon більше не потрібен, бо ⏳ входить в attendanceIcon (сьогодні/майбутнє при null)
                            const pendingIcon = null;
                            const paidRecordCreatedDate = formatDateDDMMYYHHMM(client.paidServiceRecordCreatedAt);
                            const paidRecordCreatedDateDisplay = formatDateDDMMYY(client.paidServiceRecordCreatedAt);
                            const baseTitle = isPast ? "Минулий запис на платну послугу" : "Майбутній запис на платну послугу";
                            const tooltipTitle = paidRecordCreatedDate !== '-' ? `${baseTitle}\nЗапис створено: ${paidRecordCreatedDate}` : baseTitle;
                            // Сума запису (перенесена з колонки Сума)
                            const breakdown = client.paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
                            const rawHasBreakdown = Array.isArray(breakdown) && breakdown.length > 0;
                            const totalFromBreakdown = rawHasBreakdown ? breakdown!.reduce((acc, b) => acc + b.sumUAH, 0) : 0;
                            const ptc = typeof client.paidServiceTotalCost === 'number' ? client.paidServiceTotalCost : null;
                            const spent = typeof client.spent === 'number' ? client.spent : 0;
                            const breakdownMismatch =
                              rawHasBreakdown &&
                              ((ptc != null && ptc > 0 && Math.abs(totalFromBreakdown - ptc) > Math.max(1000, ptc * 0.15)) ||
                                (spent > 0 && totalFromBreakdown > spent * 2));
                            const hasBreakdown = rawHasBreakdown && !breakdownMismatch && totalFromBreakdown > 0;
                            const displaySum = hasBreakdown ? totalFromBreakdown : (ptc != null && ptc > 0 ? ptc : null);
                            const displayLabel = hasBreakdown ? 'Сума по майстрах' : 'Сума запису';
                            
                            const paidDotTitle = 'Тригер: змінився запис';
                            // Одна крапочка на клієнта: winningKey визначає, де показувати.
                            // Якщо є перезапис і winningKey стосується запису — крапочка на іконці перезапису (пріоритет).
                            const paidColumnKeys = ['paidServiceDate', 'paidServiceRecordCreatedAt', 'paidServiceTotalCost'];
                            const hasRebook = Boolean(client.paidServiceIsRebooking);
                            const winningKeyIsPaidColumn = paidColumnKeys.includes(winningKey ?? '');
                            const showDotOnPaidRebook = hasRebook && winningKeyIsPaidColumn;
                            const showDotOnPaidDate = winningKey === 'paidServiceDate' && !hasRebook;
                            const showDotOnPaidRecordCreated = winningKey === 'paidServiceRecordCreatedAt' && !hasRebook;
                            const showDotOnPaidTotalCost = Boolean(winningKey === 'paidServiceTotalCost' && displaySum != null && displaySum > 0) && !hasRebook;
                            const showPaidAttendanceDotEffective = winningKey === 'paidServiceAttended' || winningKey === 'paidServiceCancelled';
                            const showDotOnPaidPending = Boolean(winningKey === 'paidServiceAttended' || winningKey === 'paidServiceCancelled') && !attendanceIcon && pendingIcon;

                            return (
                              <span className="flex flex-col items-start gap-0.5">
                                <span className="flex items-center gap-[1ch]">
                                <button
                                  className={
                                    "p-0 " +
                                    (isToday
                                      ? "text-green-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                      : isPast
                                      ? "text-amber-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50"
                                      : "text-blue-600 font-medium hover:underline disabled:hover:no-underline disabled:opacity-50")
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
                                    <WithCornerRedDot show={showDotOnPaidDate || showDotOnPaidRecordCreated} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                      <span className={`rounded-full px-0 py-0.5 ${
                                        paidIsToday ? 'bg-green-200' : paidCreatedToday ? 'bg-gray-200' : ''
                                      }`}>{dateStr}</span>
                                    </WithCornerRedDot>
                                      </span>
                                    </button>
                                    {pendingIcon ? (
                                  <WithCornerRedDot show={showDotOnPaidPending} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                    {pendingIcon}
                                  </WithCornerRedDot>
                                ) : null}{client.paidServiceIsRebooking ? (
                                  <WithCornerRedDot show={showDotOnPaidRebook} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                    <span
                                      className="text-purple-700 text-[14px] leading-none"
                                      title={`Перезапис 🔁\nСтворено в день: ${client.paidServiceRebookFromKyivDay || '-'}\nАтрибутовано: ${shortPersonName(client.paidServiceRebookFromMasterName) || '-'}`}
                                    >
                                      🔁
                                    </span>
                                  </WithCornerRedDot>
                                ) : null}{attendanceIcon ? (
                                  <WithCornerRedDot show={showPaidAttendanceDotEffective} title={paidDotTitle} dotClassName="-top-[5px] -right-[4px]">
                                    {attendanceIcon}
                                  </WithCornerRedDot>
                                ) : null}
                                </span>

                                {paidRecordCreatedDateDisplay !== '-' || (!hideFinances && displaySum != null && displaySum > 0) ? (
                                  <span
                                    className="text-[10px] leading-none opacity-60 max-w-[220px] sm:max-w-[320px] truncate text-left inline-flex items-center gap-0.5 flex-wrap"
                                    title={paidRecordCreatedDate !== '-' ? `Запис створено: ${paidRecordCreatedDate}${!hideFinances && displaySum != null && displaySum > 0 ? ` · ${displayLabel}: ${formatUAHExact(displaySum)}` : ''}` : (!hideFinances && displaySum != null && displaySum > 0 ? `${displayLabel}: ${formatUAHExact(displaySum)}` : '')}
                                  >
                                    {paidRecordCreatedDateDisplay !== '-' ? paidRecordCreatedDateDisplay : ''}
                                    {paidRecordCreatedDateDisplay !== '-' && !hideFinances && displaySum != null && displaySum > 0 ? ', ' : ''}
                                    {!hideFinances && displaySum != null && displaySum > 0 ? (
                                      <span className="relative inline-flex items-center">
                                        {formatUAHThousands(displaySum)}
                                        {showDotOnPaidTotalCost ? (
                                          <span className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle" title="Тригер: змінилась вартість платної послуги" />
                                        ) : null}
                                      </span>
                                    ) : ''}
                                  </span>
                                ) : null}
                              </span>
                            );
                          })()
                        ) : (client as any).paidServiceDeletedInAltegio ? (
                          <span className="text-gray-500 italic" title="Візит/запис видалено в Altegio (404), платний блок очищено">
                            Видалено в Altegio
                          </span>
                        ) : (
                          ""
                        )}
                          </td>
                        );
                      })()}
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-left" style={getColumnStyle(columnWidths.master, true)}>
                        {(() => {
                          // Колонка "Майстер":
                          // - Якщо є платний запис — показуємо майстра з Altegio (serviceMasterName)
                          // - Якщо serviceMasterName відсутній — показуємо відповідального (masterId) як fallback,
                          //   щоб тригер masterId мав “місце в UI” для крапочки.
                          const full = (client.serviceMasterName || '').trim();
                          const breakdown = client.paidServiceVisitBreakdown as { masterName: string; sumUAH: number }[] | undefined;
                          const totalFromBreakdownM = Array.isArray(breakdown) && breakdown.length > 0 ? breakdown!.reduce((a, b) => a + b.sumUAH, 0) : 0;
                          const ptcM = typeof client.paidServiceTotalCost === 'number' ? client.paidServiceTotalCost : null;
                          const spentM = typeof client.spent === 'number' ? client.spent : 0;
                          const breakdownMismatchM =
                            Array.isArray(breakdown) &&
                            breakdown!.length > 0 &&
                            ((ptcM != null && ptcM > 0 && Math.abs(totalFromBreakdownM - ptcM) > Math.max(1000, ptcM * 0.15)) ||
                              (spentM > 0 && totalFromBreakdownM > spentM * 2));
                          // Показуємо breakdown тільки якщо він узгоджений з paidServiceTotalCost (інакше API міг повернути items з усіх записів візиту)
                          const hasBreakdown = Array.isArray(breakdown) && breakdown.length > 0 && client.paidServiceDate && !breakdownMismatchM;
                          // Першим ставимо майстра з breakdown, чиє ім'я збігається з майстром консультації (хто продав)
                          const consultationPrimary = (client.consultationMasterName || '').trim() ? firstToken((client.consultationMasterName || '').toString().trim()).toLowerCase() : '';
                          const orderPrimary = full ? firstToken(full).toLowerCase() : '';
                          const paidMasterName = shortPersonName(full) || (hasBreakdown ? shortPersonName(breakdown![0].masterName) : '');
                          const responsibleRaw =
                            client.masterId ? (masters.find((m) => m.id === client.masterId)?.name || '') : '';
                          const responsibleName = shortPersonName(responsibleRaw);

                          const showPaidMaster = Boolean(client.paidServiceDate && paidMasterName);
                          const showResponsibleMaster = Boolean(!showPaidMaster && responsibleName);

                          if (!showPaidMaster && !showResponsibleMaster) return '';

                          const shouldHighlightMaster = false;
                          const highlightClass = '';

                          const secondaryFull = ((client as any).serviceSecondaryMasterName || '').trim();
                          const secondary = shortPersonName(secondaryFull);

                          const name = showPaidMaster ? paidMasterName : responsibleName;
                          let displayText: React.ReactNode = name;
                          if (hasBreakdown) {
                            // Упорядковуємо: першим — майстер з breakdown, чиє ім'я збігається з consultationMasterName; решта — за іменем
                            const sorted = [...breakdown!].sort((a, b) => {
                              const aFirst = firstToken(a.masterName).toLowerCase();
                              const bFirst = firstToken(b.masterName).toLowerCase();
                              if (consultationPrimary && aFirst === consultationPrimary) return -1;
                              if (consultationPrimary && bFirst === consultationPrimary) return 1;
                              return aFirst.localeCompare(bFirst);
                            });
                            // Майстрів у стовпчик; суми не показуємо (без дужок)
                            displayText = (
                              <>
                                {sorted.map((b, index) => {
                                  const isFirst = index === 0;
                                  const rowClass = isFirst && shouldHighlightMaster ? 'rounded-full px-2 py-0.5 bg-[#EAB308] text-gray-900' : '';
                                  return (
                                    <span key={`${b.masterName}-${b.sumUAH}`} className={rowClass ? `block text-left ${rowClass}` : 'block text-left'}>
                                      {shortPersonName(b.masterName)}
                                    </span>
                                  );
                                })}
                              </>
                            );
                          } else if (showPaidMaster && secondary && secondary.toLowerCase().trim() !== name.toLowerCase().trim()) {
                            displayText = (
                              <>
                                <span>{name}</span>
                                <span className="text-[10px] leading-none opacity-70 ml-0.5"> · {secondary}</span>
                              </>
                            );
                          }
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
                              {showPaidMaster ? (
                                <button
                                  type="button"
                                  className="hover:underline text-left"
                                  title={`${historyTitle}\n\nНатисніть, щоб відкрити повну історію`}
                                  onClick={() => setMasterHistoryClient(client)}
                                >
                                  <span className={`flex ${hasBreakdown ? 'flex-col items-start gap-0.5' : 'inline-flex items-center flex-wrap gap-x-1'} ${!hasBreakdown ? highlightClass : ''}`}>
                                    {hasBreakdown ? displayText : <span>{displayText}</span>}
                                    {showMasterDot ? (
                                      <span
                                        className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                        title="Тригер: змінився майстер"
                                      />
                                    ) : null}
                                  </span>
                                </button>
                              ) : (
                                <span className="text-left" title={`Відповідальний: ${name}`}>
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
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap text-left" style={getColumnStyle(columnWidths.phone, true)}>
                        {client.phone ? (
                          (() => {
                            const digits = (client.phone || "").replace(/\D/g, "");
                            const tel = digits.startsWith("380") && digits.length >= 12
                              ? `+${digits.slice(0, 12)}`
                              : digits.startsWith("0") && digits.length >= 9
                                ? `+38${digits}`
                                : digits.length >= 10
                                  ? `+${digits}`
                                  : null;
                            return tel ? (
                              <a href={`tel:${tel}`} className="link link-hover font-mono">
                                {client.phone}
                              </a>
                            ) : (
                              <span className="font-mono">{client.phone}</span>
                            );
                          })()
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      {!hideActionsColumn && (
                        <td className="px-1 sm:px-2 py-1 text-xs text-left" style={getColumnStyle(columnWidths.actions, true)}>
                          <div className="flex justify-start gap-1">
                            <button
                              className="btn btn-xs btn-ghost"
                              onClick={() => setEditingClient(client)}
                              title="Редагувати"
                            >
                              ✏️
                            </button>
                          </div>
                        </td>
                      )}
                      </tr>
                      </>
                    );
                  })}
                  {hasMore && onLoadMore && (
                    <tr ref={loadMoreSentinelCallbackRef}>
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
                    );
                  })()
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
