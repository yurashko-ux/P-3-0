// web/app/admin/direct/_components/DirectClientTable.tsx
// Таблиця клієнтів Direct

"use client";

import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { SyntheticEvent, ReactNode } from "react";
import type { DirectClient, DirectStatus, DirectChatStatus } from "@/lib/direct-types";
import { ClientForm } from "./ClientForm";
import { StateHistoryModal } from "./StateHistoryModal";
import { MessagesHistoryModal } from "./MessagesHistoryModal";
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
import { ConsultationFilterDropdown } from "./ConsultationFilterDropdown";
import { RecordFilterDropdown } from "./RecordFilterDropdown";
import { MasterFilterDropdown } from "./MasterFilterDropdown";
import { firstToken } from "./masterFilterUtils";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { BrokenHeartIcon } from "./BrokenHeartIcon";
import { YellowDotHalfRightIcon } from "./YellowDotHalfRightIcon";
import { YellowDotIcon } from "./YellowDotIcon";

type ChatStatusUiVariant = "v1" | "v2";

type ColumnWidthMode = 'fixed' | 'min';

type ColumnWidthConfig = {
  number: { width: number; mode: ColumnWidthMode };
  act: { width: number; mode: ColumnWidthMode };
  avatar: { width: number; mode: ColumnWidthMode };
  name: { width: number; mode: ColumnWidthMode };
  sales: { width: number; mode: ColumnWidthMode };
  days: { width: number; mode: ColumnWidthMode };
  inst: { width: number; mode: ColumnWidthMode };
  state: { width: number; mode: ColumnWidthMode };
  consultation: { width: number; mode: ColumnWidthMode };
  record: { width: number; mode: ColumnWidthMode };
  master: { width: number; mode: ColumnWidthMode };
  phone: { width: number; mode: ColumnWidthMode };
  actions: { width: number; mode: ColumnWidthMode };
};

const DEFAULT_COLUMN_CONFIG: ColumnWidthConfig = {
  number: { width: 16, mode: 'min' },
  act: { width: 40, mode: 'min' },
  avatar: { width: 44, mode: 'min' },
  name: { width: 100, mode: 'min' },
  sales: { width: 50, mode: 'min' },
  days: { width: 40, mode: 'min' },
  inst: { width: 40, mode: 'min' },
  state: { width: 30, mode: 'min' },
  consultation: { width: 80, mode: 'min' },
  record: { width: 80, mode: 'min' },
  master: { width: 60, mode: 'min' },
  phone: { width: 80, mode: 'min' },
  actions: { width: 44, mode: 'min' },
};

/** Порядок колонок: для вимірювання з body, header colgroup і розширення в майбутньому */
const COLUMN_KEYS = [
  'number', 'act', 'avatar', 'name', 'sales', 'days', 'inst', 'state',
  'consultation', 'record', 'master', 'phone', 'actions',
] as const;
type ColumnKey = typeof COLUMN_KEYS[number];

// Старий тип для міграції
type OldColumnWidths = {
  number: number;
  act: number;
  avatar: number;
  name: number;
  sales: number;
  days: number;
  inst: number;
  state: number;
  consultation: number;
  record: number;
  master: number;
  phone: number;
  actions: number;
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
        inst: { width: Math.max(10, Math.min(500, oldWidths.inst || DEFAULT_COLUMN_CONFIG.inst.width)), mode: 'min' },
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
        inst: {
          width: Math.max(10, Math.min(500, parsed.inst?.width || DEFAULT_COLUMN_CONFIG.inst.width)),
          mode: parsed.inst?.mode === 'fixed' ? 'fixed' : 'min'
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
  } else if (state === 'sold') {
    return (
      <span title="Продано!" className="leading-none inline-flex items-center justify-center" style={{ ...iconStyle, fontSize: `${Math.round(size * 0.86)}px` }}>
        🔥
      </span>
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
  /** Режим об'єднання фільтрів колонок (Консультація, Запис, Майстер): 'or' — об'єднання (будь-який), 'and' — взаємообмежуючі (всі) */
  columnFilterMode: 'or' | 'and';
};

type DirectClientTableProps = {
  clients: DirectClient[];
  totalClientsCount?: number;
  statuses: DirectStatus[];
  chatStatuses?: DirectChatStatus[];
  masters?: { id: string; name: string }[];
  filters: DirectFilters;
  onFiltersChange: (filters: DirectFilters) => void;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSortChange: (by: string, order: "asc" | "desc") => void;
  onClientUpdate: (clientId: string, updates: Partial<DirectClient>) => Promise<void>;
  onRefresh: () => Promise<void>;
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
};

type FooterStatsBlock = {
  createdConsultations: number;
  successfulConsultations: number;
  cancelledOrNoShow: number;
  sales: number;
  conversion1Rate?: number;
  conversion2Rate?: number;
  createdPaidSum: number;
  plannedPaidSum: number;
  consultationRescheduledCount?: number;
  returnedClientsCount?: number;
  consultationPlannedFuture?: number;
  consultationPlannedOnlineCount?: number;
  consultationBookedPast?: number;
  consultationBookedPastOnlineCount?: number;
  consultationBookedToday?: number;
  consultationBookedTodayOnlineCount?: number;
  plannedPaidSumToMonthEnd?: number;
  plannedPaidSumNextMonth?: number;
  plannedPaidSumPlus2Months?: number;
  // Деталізовані поля для past (та сама структура що й today)
  consultationCreated?: number;
  consultationOnlineCount?: number;
  consultationPlanned?: number;
  consultationRealized?: number;
  consultationNoShow?: number;
  consultationCancelled?: number;
  noSaleCount?: number;
  newPaidClients?: number;
  recordsCreatedSum?: number;
  recordsRealizedSum?: number;
  rebookingsCount?: number;
  upsalesGoodsSum?: number;
  newClientsCount?: number;
  newLeadsCount?: number;
  noRebookCount?: number;
  recordsCancelledCount?: number;
  recordsNoShowCount?: number;
  turnoverToday?: number;
};

/** Розширення для блоку «Сьогодні» (KPI з піктограмами) */
type FooterTodayStats = FooterStatsBlock & {
  consultationCreated?: number;
  consultationOnlineCount?: number;
  consultationPlanned?: number;
  consultationRealized?: number;
  consultationNoShow?: number;
  consultationCancelled?: number;
  consultationRescheduledCount?: number;
  returnedClientsCount?: number;
  noSaleCount?: number;
  newPaidClients?: number;
  recordsCreatedSum?: number;
  recordsRealizedSum?: number;
  rebookingsCount?: number;
  upsalesGoodsSum?: number;
  newClientsCount?: number;
  newLeadsCount?: number;
  noRebookCount?: number;
  recordsCancelledCount?: number;
  recordsNoShowCount?: number;
  turnoverToday?: number;
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
  chatStatuses = [],
  masters = [],
  filters,
  onFiltersChange,
  sortBy,
  sortOrder,
  onSortChange,
  onClientUpdate,
  onRefresh,
  shouldOpenAddClient,
  onOpenAddClientChange,
  isEditingColumnWidths = false,
  setIsEditingColumnWidths,
  headerPortalRef,
  headerSlotReady = false,
  bodyScrollLeft = 0,
}: DirectClientTableProps) {
  const chatStatusUiVariant = useChatStatusUiVariant();
  const searchParams = useSearchParams();
  const debugActivity = (searchParams?.get("debugActivity") || "").toString().trim() === "1";
  const [editingClient, setEditingClient] = useState<DirectClient | null>(null);
  const [columnWidths, setColumnWidths] = useColumnWidthConfig();
  const [editingConfig, setEditingConfig] = useState<ColumnWidthConfig>(columnWidths);
  const [footerStats, setFooterStats] = useState<{
    past: FooterStatsBlock;
    today: FooterTodayStats;
    future: FooterStatsBlock;
  } | null>(null);
  const [footerStatsError, setFooterStatsError] = useState<string | null>(null);
  const bodyTableRef = useRef<HTMLTableElement | null>(null);
  const [measuredWidths, setMeasuredWidths] = useState<number[]>([]);
  
  // Query-рядок фільтрів для API футера — ті самі фільтри, що й таблиця (KPI по періодах).
  const footerFiltersQuery = useMemo(() => {
    const f = filters;
    const params = new URLSearchParams();
    params.set('statsOnly', '1');
    params.set('statsFullPicture', '1'); // KPI «Заплановано» не залежить від фільтрів колонок
    if (f.statusId) params.set('statusId', f.statusId);
    if (f.masterId) params.set('masterId', f.masterId);
    if (f.source) params.set('source', f.source);
    if (f.search) params.set('search', f.search);
    if (f.hasAppointment === 'true') params.set('hasAppointment', 'true');
    if (f.clientType?.length) params.set('clientType', f.clientType.join(','));
    if (f.act.mode === 'current_month') params.set('actMode', 'current_month');
    else if (f.act.mode === 'year_month' && f.act.year && f.act.month) {
      params.set('actMode', 'year_month');
      params.set('actYear', f.act.year);
      params.set('actMonth', f.act.month);
    }
    if (f.days) params.set('days', f.days);
    if (f.inst?.length) params.set('inst', f.inst.join(','));
    if (f.state?.length) params.set('state', f.state.join(','));
    const c = f.consultation;
    if (c.hasConsultation === true) params.set('consultHasConsultation', 'true');
    if (c.created.mode === 'current_month') params.set('consultCreatedMode', 'current_month');
    else if (c.created.mode === 'year_month' && c.created.year && c.created.month) {
      params.set('consultCreatedMode', 'year_month');
      params.set('consultCreatedYear', c.created.year);
      params.set('consultCreatedMonth', c.created.month);
    }
    if (c.createdPreset) params.set('consultCreatedPreset', c.createdPreset);
    if (c.appointed.mode === 'current_month') params.set('consultAppointedMode', 'current_month');
    else if (c.appointed.mode === 'year_month' && c.appointed.year && c.appointed.month) {
      params.set('consultAppointedMode', 'year_month');
      params.set('consultAppointedYear', c.appointed.year);
      params.set('consultAppointedMonth', c.appointed.month);
    }
    if (c.appointedPreset) params.set('consultAppointedPreset', c.appointedPreset);
    if (c.attendance) params.set('consultAttendance', c.attendance);
    if (c.type) params.set('consultType', c.type);
    if (c.masterIds?.length) params.set('consultMasters', c.masterIds.join('|'));
    const r = f.record;
    if (r.hasRecord === true) params.set('recordHasRecord', 'true');
    if (r.newClient === true) params.set('recordNewClient', 'true');
    if (r.created.mode === 'current_month') params.set('recordCreatedMode', 'current_month');
    else if (r.created.mode === 'year_month' && r.created.year && r.created.month) {
      params.set('recordCreatedMode', 'year_month');
      params.set('recordCreatedYear', r.created.year);
      params.set('recordCreatedMonth', r.created.month);
    }
    if (r.createdPreset) params.set('recordCreatedPreset', r.createdPreset);
    if (r.appointed.mode === 'current_month') params.set('recordAppointedMode', 'current_month');
    else if (r.appointed.mode === 'year_month' && r.appointed.year && r.appointed.month) {
      params.set('recordAppointedMode', 'year_month');
      params.set('recordAppointedYear', r.appointed.year);
      params.set('recordAppointedMonth', r.appointed.month);
    }
    if (r.appointedPreset) params.set('recordAppointedPreset', r.appointedPreset);
    if (r.client) params.set('recordClient', r.client);
    if (r.sum) params.set('recordSum', r.sum);
    if (f.master?.hands) params.set('masterHands', String(f.master.hands));
    if (f.master?.primaryMasterIds?.length) params.set('masterPrimary', f.master.primaryMasterIds.join('|'));
    if (f.master?.secondaryMasterIds?.length) params.set('masterSecondary', f.master.secondaryMasterIds.join('|'));
    params.set('columnFilterMode', (f.columnFilterMode ?? 'and') === 'and' ? 'and' : 'or');
    return params.toString();
  }, [filters]);

  // Джерело даних футера — той самий API, що й таблиця KPI по періодах (/api/admin/direct/clients з фільтрами).
  useEffect(() => {
    const fetchFooterStats = async () => {
      try {
        setFooterStatsError(null);
        const url = `/api/admin/direct/clients?${footerFiltersQuery}&_t=${Date.now()}`;
        const response = await fetch(url, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
        });
        if (!response.ok) {
          setFooterStats(null);
          setFooterStatsError('Не вдалося завантажити статистику футера');
          return;
        }
        const data = await response.json();
        if (data?.ok && data?.periodStats) {
          setFooterStats(data.periodStats);
          setFooterStatsError(null);
        } else {
          setFooterStats(null);
          setFooterStatsError('Не вдалося завантажити статистику футера');
        }
      } catch (err) {
        console.error('[DirectClientTable] Failed to fetch footer stats:', err);
        setFooterStats(null);
        setFooterStatsError('Не вдалося завантажити статистику футера');
      }
    };

    fetchFooterStats();
  }, [footerFiltersQuery]);
  
  // Ширини для header: з body (виміряні) або fallback з columnWidths
  // Мінімум для "Стан": щоб "Стан" + фільтр + відступи не залазили на "Консультація"
  const STATE_MIN_WIDTH = 96;
  const effectiveWidths = COLUMN_KEYS.map((k, i) => {
    const w = measuredWidths[i] ?? (columnWidths as Record<ColumnKey, { width: number }>)[k].width;
    return k === 'state' ? Math.max(w, STATE_MIN_WIDTH) : w;
  });

  const totalTableWidth = effectiveWidths.reduce((a, b) => a + (b ?? 0), 0);

  // Colgroup для header і body — однакові ширини, щоб верхні/нижні колонки збігались
  const headerColgroup = (
    <colgroup>
      {COLUMN_KEYS.map((_, i) => (
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
      inst: {
        width: Math.max(10, Math.min(500, editingConfig.inst.width)),
        mode: editingConfig.inst.mode
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
  const [webhooksClient, setWebhooksClient] = useState<DirectClient | null>(null);
  const [recordHistoryClient, setRecordHistoryClient] = useState<DirectClient | null>(null);
  const [recordHistoryType, setRecordHistoryType] = useState<'paid' | 'consultation'>('paid');
  const [masterHistoryClient, setMasterHistoryClient] = useState<DirectClient | null>(null);
  // Локальні оверрайди для UI переписки, щоб не перезавантажувати всю таблицю після зміни статусу
  const [chatUiOverrides, setChatUiOverrides] = useState<Record<string, Partial<DirectClient>>>({});
  const [fullscreenAvatar, setFullscreenAvatar] = useState<{ src: string; username: string } | null>(null);

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
  const filteredClients = useMemo(() => {
    if (!filters.clientType || filters.clientType.length === 0) {
      return uniqueClients;
    }

    return uniqueClients.filter((client) => {
      const matches: boolean[] = [];
      
      // Перевіряємо кожен вибраний фільтр
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

      // AND логіка: клієнт має відповідати ВСІМ вибраним фільтрам
      return matches.length === filters.clientType.length && matches.every((m) => m === true);
    });
  }, [uniqueClients, filters.clientType]);

  // У активному режимі: спочатку рядки з тригером (updatedAt/createdAt сьогодні, консультація сьогодні, запис сьогодні), потім за updatedAt desc. Лінія відмежування під блоком тригерних.
  // Логіка «сьогодні» узгоджена з рядком таблиці (consultIsToday, paidIsToday) — той самий kyivDayFmt і порівняння.
  const clientsForTable = useMemo(() => {
    const isActiveMode = sortBy === 'updatedAt' && sortOrder === 'desc';
    if (!isActiveMode) return filteredClients;

    const kyivDayFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayKyivDay = kyivDayFmt.format(new Date());
    const dateField: 'updatedAt' | 'createdAt' = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';

    const isConsultDateToday = (dateVal: string | null | undefined): boolean => {
      if (!dateVal) return false;
      try {
        const dateStr = typeof dateVal === 'string' ? dateVal.trim() : String(dateVal);
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
        return !isNaN(appointmentDate.getTime()) && kyivDayFmt.format(appointmentDate) === todayKyivDay;
      } catch {
        return false;
      }
    };

    const hasTrigger = (c: DirectClient): boolean => {
      const mainDate = c[dateField];
      if (mainDate) {
        const mainKyivDay = kyivDayFmt.format(new Date(mainDate));
        if (mainKyivDay === todayKyivDay) return true;
      }
      if (isConsultDateToday(c.consultationBookingDate ?? undefined)) return true;
      if (c.paidServiceDate && kyivDayFmt.format(new Date(c.paidServiceDate)) === todayKyivDay) return true;
      return false;
    };

    return [...filteredClients].sort((a, b) => {
      const aT = hasTrigger(a);
      const bT = hasTrigger(b);
      if (aT !== bT) return aT ? -1 : 1;
      const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tB - tA;
    });
  }, [filteredClients, sortBy, sortOrder]);

  const useColgroupOnBody = filteredClients.length > 0 && measuredWidths.length === COLUMN_KEYS.length;

  // Вимірюємо фактичні ширини колонок з body-таблиці; header colgroup використовує їх
  useLayoutEffect(() => {
    const table = bodyTableRef.current;
    if (!table) return;

    const measure = () => {
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody?.querySelectorAll('tr') ?? []);
      const dataRows = rows.filter((r) => r.cells.length === COLUMN_KEYS.length);
      if (dataRows.length === 0) {
        setMeasuredWidths((prev) => (prev.length ? [] : prev));
        return;
      }
      const nc = COLUMN_KEYS.length;
      const maxWidths = new Array<number>(nc).fill(0);
      for (const row of dataRows) {
        const cells = Array.from(row.cells);
        for (let i = 0; i < nc && i < cells.length; i++) {
          const w = Math.round(cells[i].getBoundingClientRect().width);
          if (w > maxWidths[i]) maxWidths[i] = w;
        }
      }
      setMeasuredWidths(maxWidths);
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(table);
    return () => ro.disconnect();
  }, [filteredClients.length, filteredClients]);

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
                <button
                  className="btn btn-sm btn-circle btn-ghost"
                  onClick={() => setEditingClient(null)}
                >
                  ✕
                </button>
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
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Днів"
                      />
                    </div>
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
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Inst"
                      />
                    </div>
                  </th>
                  <th className="pl-1 pr-2 sm:pl-1 sm:pr-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.state, true)}>
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
                        filters={filters}
                        onFiltersChange={onFiltersChange}
                        columnLabel="Запис"
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
                  <th className="px-1 sm:px-2 py-0 text-[10px] font-semibold text-left" style={getColumnStyle(columnWidths.actions, true)}>Дії</th>
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
                          value={editingConfig.inst.width}
                          onChange={(e) => setEditingConfig({ ...editingConfig, inst: { ...editingConfig.inst, width: parseInt(e.target.value) || 10 } })}
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
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <button
                        onClick={handleSaveColumnWidths}
                        className="btn btn-primary btn-xs w-full"
                      >
                        Зберегти
                      </button>
                    </td>
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
                    <td colSpan={COLUMN_KEYS.length} className="text-center py-8 text-gray-500">
                      Немає клієнтів
                    </td>
                  </tr>
                ) : (
                  (() => {
                    // Визначаємо індекс останнього рядка блоку «сьогодні» (під ним — товста сіра лінія)
                    const kyivDayFmtRow = new Intl.DateTimeFormat('en-CA', {
                      timeZone: 'Europe/Kyiv',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    });
                    const todayKyivDayRow = kyivDayFromISO(new Date().toISOString());
                    const dateField = sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
                    let firstTodayIndex = -1;

                    // Та сама логіка, що для зеленого фону (consultIsToday, paidIsToday)
                    const isDateTodayInKyiv = (dateVal: string | null | undefined, kyivDayFmt: Intl.DateTimeFormat): boolean => {
                      if (!dateVal) return false;
                      try {
                        const dateStr = typeof dateVal === 'string' ? dateVal.trim() : String(dateVal);
                        const isoMatch = dateStr.match(/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[\+\-]\d{2}:\d{2})?)?/);
                        if (isoMatch) {
                          const d = new Date(isoMatch[0]);
                          return !isNaN(d.getTime()) && kyivDayFmt.format(d) === todayKyivDayRow;
                        }
                        for (const part of dateStr.split(/\s+/)) {
                          const d = new Date(part);
                          if (!isNaN(d.getTime()) && part.match(/^\d/)) {
                            return kyivDayFmt.format(d) === todayKyivDayRow;
                          }
                        }
                      } catch {}
                      const fallback = kyivDayFromISO(String(dateVal));
                      return !!fallback && fallback === todayKyivDayRow;
                    };

                    clientsForTable.forEach((client, idx) => {
                      const belongsToToday = (() => {
                        // 1. updatedAt/createdAt сьогодні
                        const mainDate = client[dateField];
                        if (mainDate) {
                          const mainKyivDay = kyivDayFromISO(String(mainDate));
                          if (mainKyivDay && mainKyivDay === todayKyivDayRow) return true;
                        }
                        // 2. Консультація на сьогодні (зелений фон)
                        if (isDateTodayInKyiv(client.consultationBookingDate, kyivDayFmtRow)) return true;
                        // 3. Запис на сьогодні (зелений фон)
                        if (isDateTodayInKyiv(client.paidServiceDate, kyivDayFmtRow)) return true;
                        return false;
                      })();
                      if (belongsToToday && idx > firstTodayIndex) {
                        firstTodayIndex = idx;
                      }
                    });

                    return clientsForTable.map((client, index) => {
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
                                <LeadBadgeIcon />
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
                      <td className="px-1 sm:px-2 py-1 text-xs whitespace-nowrap" style={getColumnStyle(columnWidths.sales, true)}>
                        <span className="flex flex-col items-start leading-none">
                          <span className="text-left">
                            {client.spent !== null && client.spent !== undefined
                              ? `${Math.round(client.spent / 1000).toLocaleString('uk-UA')} тис.`
                              : '-'}
                          </span>
                        </span>
                      </td>
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
                      {/* Переписка: число повідомлень (клік → історія) + текст-статус */}
                      <td
                        className={
                          chatStatusUiVariant === 'v2'
                            ? "px-1 sm:px-2 py-1 text-xs whitespace-normal text-left"
                            : "px-1 sm:px-2 py-1 text-xs whitespace-nowrap overflow-hidden text-left"
                        }
                        style={getColumnStyle(columnWidths.inst, true)}
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
                            <div className="flex items-center justify-start gap-2 min-w-0">
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
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-1 sm:px-1 py-1 text-xs whitespace-nowrap text-left" style={getColumnStyle(columnWidths.state, true)}>
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
                                <div className="flex items-center justify-start">
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
                                <div className="flex items-center justify-start">
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

                          // 2. Продано! — консультація ✅ + активний запис на платну ⏳ (сьогодні або майбутнє)
                          const isPaidFutureOrToday = Boolean(paidKyivDay && paidKyivDay >= todayKyivDay);
                          if (
                            client.consultationAttended === true &&
                            client.paidServiceDate &&
                            isPaidFutureOrToday &&
                            !client.paidServiceCancelled &&
                            client.paidServiceAttended !== false
                          ) {
                            return (
                              <div className="flex items-center justify-start">
                                <span className="inline-flex items-center justify-center">
                                  <span
                                    title="Продано!"
                                    className="text-[24px] leading-none inline-flex items-center justify-center"
                                  >
                                    🔥
                                  </span>
                                </span>
                              </div>
                            );
                          }

                          // 3. Успішна консультація без запису (Не продали)
                          if (client.consultationAttended === true && isConsultPast && (!client.paidServiceDate || !client.signedUpForPaidService)) {
                            return (
                              <div className="flex items-center justify-start">
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

                          // 4. Attendance = -1 для минулої дати (no-show)
                          if (client.paidServiceDate && isPaidPast && client.paidServiceAttended === false) {
                            return (
                              <div className="flex items-center justify-start">
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

                          // 5. Attendance = -1 для майбутньої дати або скасовано
                          if (client.paidServiceDate && !isPaidPast && (client.paidServiceAttended === false || client.paidServiceCancelled)) {
                            return (
                              <div className="flex items-center justify-start">
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
                                <div className="flex items-center justify-start">
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
                              <div className="flex items-center justify-start">
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
                              <div className="flex items-center justify-start">
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
                              <div className="flex items-center justify-start">
                                <span className="inline-flex items-center justify-center">
                                  <StateIcon state={client.state} size={28} />
                                </span>
                              </div>
                            );
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
                              } else if (client.consultationAttended === true && (isPast || isToday)) {
                                // Зелена галочка для минулих дат і сьогодні (клієнт не може прийти в майбутньому)
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
                                <span className="flex flex-col items-start">
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
                                        <span className={`rounded-full px-0 py-0.5 ${
                                          consultIsToday ? 'bg-green-200' : consultCreatedToday ? 'bg-gray-200' : ''
                                        }`}>
                                          {formattedDateStr}{isOnline ? "💻" : "📅"}
                                        </span>
                                        {showDotOnConsultDate ? (
                                          <span
                                            className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                            title={consultDateDotTitle}
                                          />
                                        ) : null}
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

                                  {(() => {
                                    const consultantFull = (client.consultationMasterName || '').toString().trim();
                                    const consultant = shortPersonName(consultantFull);
                                    if (!consultant) return (
                                      <span className="text-[10px] leading-none opacity-50 max-w-[220px] sm:max-w-[320px] truncate text-left">
                                        невідомо
                                      </span>
                                    );
                                    return (
                                      <span
                                        className="text-[10px] leading-none opacity-70 max-w-[220px] sm:max-w-[320px] truncate text-left"
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
                            } else if (client.paidServiceAttended === true && (isPast || isToday)) {
                              // Зелена галочка для минулих дат і сьогодні (клієнт не може прийти в майбутньому)
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
                              <span className="flex flex-col items-start">
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
                                    <span className={`rounded-full px-0 py-0.5 ${
                                      paidIsToday ? 'bg-green-200' : paidCreatedToday ? 'bg-gray-200' : ''
                                    }`}>{dateStr}</span>
                                    {showDotOnPaidDate ? (
                                      <span
                                        className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                        title={paidDotTitle}
                                      />
                                    ) : null}
                                      </span>
                                    </button>{pendingIcon ? (
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

                                {(() => {
                                  const breakdown = (client as any).paidServiceMastersBreakdown as { masterName: string; sumUAH: number }[] | undefined;
                                  const rawHasBreakdown = Array.isArray(breakdown) && breakdown.length > 0;
                                  const totalFromBreakdown = rawHasBreakdown ? breakdown!.reduce((acc, b) => acc + b.sumUAH, 0) : 0;
                                  const ptc = typeof client.paidServiceTotalCost === 'number' ? client.paidServiceTotalCost : null;
                                  const spent = typeof client.spent === 'number' ? client.spent : 0;
                                  // Breakdown може включати items з усіх записів візиту (API /visit/details). Ігноруємо breakdown, якщо:
                                  // 1) сума breakdown не збігається з paidServiceTotalCost; 2) breakdown > 2x spent (підозріло завищений)
                                  const breakdownMismatch =
                                    rawHasBreakdown &&
                                    ((ptc != null && ptc > 0 && Math.abs(totalFromBreakdown - ptc) > Math.max(1000, ptc * 0.15)) ||
                                      (spent > 0 && totalFromBreakdown > spent * 2));
                                  const hasBreakdown = rawHasBreakdown && !breakdownMismatch && totalFromBreakdown > 0;
                                  const displaySum = hasBreakdown ? totalFromBreakdown : (ptc != null && ptc > 0 ? ptc : null);
                                  const displayLabel = hasBreakdown ? 'Сума по майстрах' : 'Сума запису';
                                  if (displaySum != null && displaySum > 0) {
                                    return (
                                      <span
                                        className="text-[10px] leading-none opacity-70 max-w-[220px] sm:max-w-[320px] truncate text-left"
                                        title={`${displayLabel}: ${formatUAHExact(displaySum)}`}
                                      >
                                        <span className="inline-flex items-center">
                                          <span>{formatUAHThousands(displaySum)}</span>
                                          {!hasBreakdown && showPaidCostDot ? (
                                            <span
                                              className="inline-block ml-1 w-[8px] h-[8px] rounded-full bg-red-600 border border-white align-middle translate-y-[1px]"
                                              title={'Тригер: змінилась сума запису'}
                                            />
                                          ) : null}
                                        </span>
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="text-[10px] leading-none opacity-50 max-w-[220px] sm:max-w-[320px] truncate text-left">
                                      невідомо
                                    </span>
                                  );
                                })()}
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
                          const breakdown = (client as any).paidServiceMastersBreakdown as { masterName: string; sumUAH: number }[] | undefined;
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

                          const shouldHighlightMaster =
                            client.consultationAttended === true && Boolean(client.paidServiceDate);
                          const highlightClass = shouldHighlightMaster
                            ? 'rounded-full px-2 py-0.5 bg-[#EAB308] text-gray-900'
                            : '';

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
                            // Майстрів у стовпчик; сума в дужках — тільки число (тис.), голубий фон лише для першого
                            displayText = (
                              <>
                                {sorted.map((b, index) => {
                                  const thousands = Math.round(b.sumUAH / 1000);
                                  const isFirst = index === 0;
                                  const rowClass = isFirst && shouldHighlightMaster ? 'rounded-full px-2 py-0.5 bg-[#EAB308] text-gray-900' : '';
                                  return (
                                    <span key={`${b.masterName}-${b.sumUAH}`} className={rowClass ? `block text-left ${rowClass}` : 'block text-left'}>
                                      {shortPersonName(b.masterName)} ({thousands})
                                    </span>
                                  );
                                })}
                              </>
                            );
                          } else if (showPaidMaster && secondary && secondary.toLowerCase().trim() !== name.toLowerCase().trim()) {
                            displayText = (
                              <>
                                <span>{name}</span>
                                <span className="text-[10px] leading-none opacity-70 ml-0.5">({secondary})</span>
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
                          <span className="font-mono">{client.phone}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-1 sm:px-2 py-1 text-xs text-left" style={getColumnStyle(columnWidths.actions, true)}>
                        <div className="flex justify-start gap-1">
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
      
      {/* Футер — 2 рядки; колонки: З початку = Сьогодні (рівні), До кінця місяця — 50% ширини */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-gray-200 min-h-[40px] py-0.5 px-2 border-t border-gray-300">
        {footerStats ? (
          <div className="grid divide-x divide-gray-300 text-xs" style={{ gridTemplateColumns: '2fr 2fr 1fr' }}>
            {(() => {
              const formatMoney = (value: number) => `${value.toLocaleString('uk-UA')} грн.`;
              const formatThousand = (value: number) => `${(value / 1000).toFixed(1)} тис. грн`;
              const renderBlock = (title: string) => (
                <div className="px-3 relative min-h-[2rem]">
                  <span className="absolute top-0 right-0 text-[10px] font-bold text-gray-700">{title}.</span>
                </div>
              );
              const todayData = footerStats.today as FooterTodayStats;
              const hasTodayKpi = typeof todayData.consultationCreated === 'number';
              const formatThousandVal = (v: number) => String(Math.round((v ?? 0) / 1000));
              const iconSize = 14;
              const BlueCircle2Icon = ({ size = iconSize }: { size?: number }) => (
                <svg className="shrink-0" style={{ width: `${size}px`, height: `${size}px` }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <circle cx="12" cy="12" r="11" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="1.5" />
                  <text x="12" y="12" textAnchor="middle" dominantBaseline="central" fill="#2563EB" fontWeight="bold" fontSize="12" fontFamily="system-ui">2</text>
                </svg>
              );
              const renderPastBlock = () => {
                const pastData = footerStats.past;
                return (
                  <div className="px-3 relative grid gap-0 min-h-[2rem]" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', gridTemplateRows: 'auto auto' }}>
                    {/* 1-й рядок: Консультації */}
                    <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem] min-w-0">
                      <span className="font-medium text-gray-600 shrink-0">Консультації:</span>
                      <span title="Консультацій створено" className="inline-flex items-center gap-1">
                        <StateIcon state="consultation-booked" size={iconSize} />
                        <span>{pastData.consultationCreated ?? 0}</span>
                      </span>
                      <span title="Онлайн консультації: 💻 — {pastData.consultationOnlineCount ?? 0} шт.">💻 {pastData.consultationOnlineCount ?? 0}</span>
                      <span title="Консультації (офлайн): 📅">📅 {((pastData.consultationCreated ?? 0) - (pastData.consultationOnlineCount ?? 0))}</span>
                      <span title="Заброньовані (відбулись): ⏳">⏳ {pastData.consultationBookedPast ?? 0}</span>
                      <span title="Заброньовані онлайн">💻 {pastData.consultationBookedPastOnlineCount ?? 0}</span>
                      <span title="Заброньовані офлайн">📅 {Math.max(0, (pastData.consultationBookedPast ?? 0) - (pastData.consultationBookedPastOnlineCount ?? 0))}</span>
                      <span className="text-green-600" title="Реалізовані: ✅">✅ {pastData.consultationRealized ?? 0}</span>
                      <span className="text-red-600" title="Не прийшли: ❌">❌ {pastData.consultationNoShow ?? 0}</span>
                      <span className="text-orange-600" title="Скасовані: 🚫">🚫 {pastData.consultationCancelled ?? 0}</span>
                      <span title="Немає продажі" className="inline-flex items-center gap-0.5">
                        <BrokenHeartIcon size={iconSize} />
                        <span>{pastData.noSaleCount ?? 0}</span>
                      </span>
                      <span title="Відновлена консультація" className="inline-flex items-center gap-1">
                        <BlueCircle2Icon size={iconSize} />
                        <span>{pastData.consultationRescheduledCount ?? 0}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-x-1 min-h-[1rem] shrink-0 pl-1" />
                    {/* 2-й рядок: Записи | Клієнти */}
                    <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem] min-w-0">
                      <span className="font-medium text-gray-600 shrink-0">Записи:</span>
                      <span title="Записів заплановано (майбутні)" className="inline-flex items-center gap-1 shrink-0">
                        <YellowDotIcon size={iconSize} />
                        <span>{formatThousandVal(pastData.plannedPaidSum ?? 0)}</span>
                      </span>
                      <span title="Нові клієнти" className="inline-flex items-center gap-1 shrink-0">
                        <YellowDotIcon size={iconSize} />
                        <span>{pastData.newClientsCount ?? 0}</span>
                      </span>
                      <span title="Записів створено" className="inline-flex items-center gap-1">📋 {formatThousandVal(pastData.recordsCreatedSum ?? 0)}</span>
                      <span title="Записів заплановано" className="inline-flex items-center gap-1">⏳ {formatThousandVal(pastData.plannedPaidSum ?? 0)}</span>
                      <span className="text-green-600" title="Реалізовано">✅ {formatThousandVal(pastData.recordsRealizedSum ?? 0)}</span>
                      <span title="Перезаписів">🔁 {pastData.rebookingsCount ?? 0}</span>
                      <span title="Допродажі" className="inline-flex items-center gap-1">
                        <img src="/assets/footer-nail-polish.png" alt="" className="inline-block w-3.5 h-3.5 object-contain align-middle [mix-blend-mode:multiply]" />
                        <span>{formatThousandVal(pastData.upsalesGoodsSum ?? 0)}</span>
                      </span>
                      <span title="Немає перезапису">⚠️ {pastData.noRebookCount ?? 0}</span>
                      <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
                        <BlueCircle2Icon size={iconSize} />
                        <span>{pastData.returnedClientsCount ?? 0}</span>
                      </span>
                      <span className="text-orange-600" title="Записи скасовані">🚫 {pastData.recordsCancelledCount ?? 0}</span>
                      <span className="text-red-600" title="Записи: не прийшов">❌ {pastData.recordsNoShowCount ?? 0}</span>
                      <span className="font-bold text-gray-700 shrink-0" title={`Оборот: ${formatThousandVal(pastData.turnoverToday ?? 0)} тис. грн`}>
                        <span className="opacity-90">💰</span> Фін. Рез. <span>{formatThousandVal(pastData.turnoverToday ?? 0)}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-x-1 min-h-[1rem] shrink-0 pl-1">
                      <span className="font-medium text-gray-600">Ліди:</span>
                      <span title="Нові ліди (без Altegio ID)" className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-full bg-[#3b82f6] shrink-0" />
                        <span>{pastData.newLeadsCount ?? 0}</span>
                      </span>
                      <span className="font-medium text-gray-600">Клієнти:</span>
                      <span title="Нові клієнти" className="inline-flex items-center gap-1">
                        <YellowDotIcon size={iconSize} />
                        <span>{pastData.newClientsCount ?? 0}</span>
                      </span>
                      <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
                        <BlueCircle2Icon size={iconSize} />
                        <span>{pastData.returnedClientsCount ?? 0}</span>
                      </span>
                    </div>
                  </div>
                );
              };
              const renderTodayBlock = () => (
                <div className="px-3 relative">
                  {hasTodayKpi ? (
                    <div className="grid gap-0 min-h-[2rem]" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', gridTemplateRows: 'auto auto' }}>
                      {/* 1-й рядок: Консультації */}
                      <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem] min-w-0">
                        <span className="font-medium text-gray-600 shrink-0">Консультації:</span>
                        <span title="Консультацій створено" className="inline-flex items-center gap-1">
                          <StateIcon state="consultation-booked" size={iconSize} />
                          <span>{todayData.consultationCreated ?? 0}</span>
                        </span>
                        <span title="Онлайн консультації">💻 {todayData.consultationOnlineCount ?? 0}</span>
                        <span title="Консультації (офлайн)">📅 {((todayData.consultationCreated ?? 0) - (todayData.consultationOnlineCount ?? 0))}</span>
                        <span title="Заброньовані (на сьогодні)">⏳ {todayData.consultationBookedToday ?? 0}</span>
                        <span title="Заброньовані онлайн">💻 {todayData.consultationBookedTodayOnlineCount ?? 0}</span>
                        <span title="Заброньовані офлайн">📅 {Math.max(0, (todayData.consultationBookedToday ?? 0) - (todayData.consultationBookedTodayOnlineCount ?? 0))}</span>
                        <span className="text-green-600" title="Реалізовані">✅ {todayData.consultationRealized ?? 0}</span>
                        <span className="text-red-600" title="Не прийшли">❌ {todayData.consultationNoShow ?? 0}</span>
                        <span className="text-orange-600" title="Скасовані">🚫 {todayData.consultationCancelled ?? 0}</span>
                        <span title="Немає продажі" className="inline-flex items-center gap-0.5">
                          <BrokenHeartIcon size={iconSize} />
                          <span>{todayData.noSaleCount ?? 0}</span>
                        </span>
                        <span title="Відновлена консультація" className="inline-flex items-center gap-1">
                          <BlueCircle2Icon size={iconSize} />
                          <span>{todayData.consultationRescheduledCount ?? 0}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-x-1 min-h-[1rem] shrink-0 pl-1" />
                      {/* 2-й рядок: Записи | Клієнти */}
                      <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem] min-w-0">
                        <span className="font-medium text-gray-600 shrink-0">Записи:</span>
                        <span title="Записів заплановано (майбутні)" className="inline-flex items-center gap-1 shrink-0">
                          <YellowDotIcon size={iconSize} />
                          <span>{formatThousandVal(todayData.plannedPaidSum ?? 0)}</span>
                        </span>
                        <span title="Нові клієнти" className="inline-flex items-center gap-1 shrink-0">
                          <YellowDotIcon size={iconSize} />
                          <span>{todayData.newClientsCount ?? 0}</span>
                        </span>
                        <span title="Записів створено" className="inline-flex items-center gap-1">📋 {formatThousandVal(todayData.recordsCreatedSum ?? 0)}</span>
                        <span title="Записів заплановано" className="inline-flex items-center gap-1">⏳ {formatThousandVal(todayData.plannedPaidSum ?? 0)}</span>
                        <span className="text-green-600" title="Реалізовано">✅ {formatThousandVal(todayData.recordsRealizedSum ?? 0)}</span>
                        <span title="Перезаписів">🔁 {todayData.rebookingsCount ?? 0}</span>
                        <span title="Допродажі" className="inline-flex items-center gap-1">
                          <img src="/assets/footer-nail-polish.png" alt="" className="inline-block w-3.5 h-3.5 object-contain align-middle [mix-blend-mode:multiply]" />
                          <span>{formatThousandVal(todayData.upsalesGoodsSum ?? 0)}</span>
                        </span>
                        <span title="Немає перезапису">⚠️ {todayData.noRebookCount ?? 0}</span>
                        <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
                          <BlueCircle2Icon size={iconSize} />
                          <span>{todayData.returnedClientsCount ?? 0}</span>
                        </span>
                        <span className="text-orange-600" title="Записи скасовані">🚫 {todayData.recordsCancelledCount ?? 0}</span>
                        <span className="text-red-600" title="Записи: не прийшов">❌ {todayData.recordsNoShowCount ?? 0}</span>
                        <span className="font-bold text-gray-700 shrink-0" title={`Оборот: ${formatThousandVal(todayData.turnoverToday ?? 0)} тис. грн`}>
                          <span className="opacity-90">💰</span> Фін. Рез. <span>{formatThousandVal(todayData.turnoverToday ?? 0)}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-x-1 min-h-[1rem] shrink-0 pl-1">
                        <span className="font-medium text-gray-600">Ліди:</span>
                        <span title="Нові ліди (без Altegio ID)" className="inline-flex items-center gap-1">
                          <span className="inline-block w-3 h-3 rounded-full bg-[#3b82f6] shrink-0" />
                          <span>{todayData.newLeadsCount ?? 0}</span>
                        </span>
                        <span className="font-medium text-gray-600">Клієнти:</span>
                        <span title="Нові клієнти" className="inline-flex items-center gap-1">
                          <YellowDotIcon size={iconSize} />
                          <span>{todayData.newClientsCount ?? 0}</span>
                        </span>
                        <span title="Повернуті клієнти" className="inline-flex items-center gap-1">
                          <BlueCircle2Icon size={iconSize} />
                          <span>{todayData.returnedClientsCount ?? 0}</span>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end min-h-[2rem]" />
                  )}
                </div>
              );
              const renderFutureBlock = () => {
                const futureData = footerStats.future;
                return (
                  <div className="px-3 relative flex flex-col gap-0">
                    <span className="absolute top-0 right-0 text-xs font-bold text-gray-700 inline-flex items-center gap-1">
                      <YellowDotHalfRightIcon size={iconSize} />
                      До кінця місяця.
                    </span>
                    <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem]">
                      <span className="font-medium text-gray-600 shrink-0">Консультацій:</span>
                      <span title="Призначено (майбутні)" className="shrink-0">⏳ {futureData.consultationPlannedFuture ?? 0}</span>
                      <span title="Майбутні онлайн">💻 {futureData.consultationPlannedOnlineCount ?? 0}</span>
                      <span title="Майбутні офлайн">📅 {Math.max(0, (futureData.consultationPlannedFuture ?? 0) - (futureData.consultationPlannedOnlineCount ?? 0))}</span>
                    </div>
                    <div className="flex flex-nowrap overflow-x-auto items-center gap-x-2 gap-y-0 min-h-[1rem]">
                      <span className="font-medium text-gray-600 shrink-0">Записів:</span>
                      <span title="Записів майбутніх" className="inline-flex items-center gap-1 shrink-0">
                        <YellowDotIcon size={iconSize} />
                        <span>{formatThousandVal(futureData.plannedPaidSumToMonthEnd ?? 0)}</span>
                      </span>
                      <span title="До кінця місяця" className="inline-flex items-center gap-1 shrink-0">
                        <YellowDotHalfRightIcon size={iconSize} />
                        <span>{formatThousandVal(futureData.plannedPaidSumToMonthEnd ?? 0)}</span>
                      </span>
                      <span title="Наступного місяця" className="inline-flex items-center gap-1 shrink-0">➡️ {formatThousandVal(futureData.plannedPaidSumNextMonth ?? 0)}</span>
                      <span title="+2 міс." className="inline-flex items-center gap-1 shrink-0">⏭️ {formatThousandVal(futureData.plannedPaidSumPlus2Months ?? 0)}</span>
                    </div>
                  </div>
                );
              };
              return (
                <>
                  {renderPastBlock()}
                  {renderTodayBlock()}
                  {renderFutureBlock()}
                </>
              );
            })()}
          </div>
        ) : (
          <div className="text-[9px] text-gray-600">
            {footerStatsError || 'Статистика футера недоступна'}
          </div>
        )}
      </div>
    </div>
  );
}
