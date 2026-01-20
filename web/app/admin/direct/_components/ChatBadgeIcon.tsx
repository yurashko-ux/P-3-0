// web/app/admin/direct/_components/ChatBadgeIcon.tsx
// Вбудований набір бейджів (10 шт) для статусів переписки.

'use client';

import React from 'react';

export const CHAT_BADGE_KEYS = Array.from({ length: 10 }, (_, i) => `badge_${i + 1}` as const);
export type ChatBadgeKey = (typeof CHAT_BADGE_KEYS)[number];

const badgeStyle: Record<string, { bg: string; fg: string; label: string }> = {
  badge_1: { bg: '#0ea5e9', fg: '#ffffff', label: '1' },
  badge_2: { bg: '#22c55e', fg: '#ffffff', label: '2' },
  badge_3: { bg: '#f97316', fg: '#ffffff', label: '3' },
  badge_4: { bg: '#a855f7', fg: '#ffffff', label: '4' },
  badge_5: { bg: '#ef4444', fg: '#ffffff', label: '5' },
  badge_6: { bg: '#14b8a6', fg: '#ffffff', label: '6' },
  badge_7: { bg: '#64748b', fg: '#ffffff', label: '7' },
  badge_8: { bg: '#eab308', fg: '#111827', label: '8' },
  badge_9: { bg: '#3b82f6', fg: '#ffffff', label: '9' },
  badge_10: { bg: '#111827', fg: '#ffffff', label: '10' },
};

export function ChatBadgeIcon({ badgeKey, title, size = 16 }: { badgeKey: string | null | undefined; title?: string; size?: number }) {
  const key = (badgeKey || '').toString().trim() || 'badge_1';
  const cfg = badgeStyle[key] || badgeStyle.badge_1;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold leading-none shrink-0"
      title={title}
      style={{
        width: size,
        height: size,
        backgroundColor: cfg.bg,
        color: cfg.fg,
        fontSize: Math.max(9, Math.round(size * 0.55)),
      }}
      aria-label={title || key}
    >
      {cfg.label}
    </span>
  );
}

export function ChatCloudIcon({ size = 18, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label={title || 'Переписка'}
    >
      <path
        d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12"
        stroke="#10b981"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14" r="1" fill="#10b981" />
      <circle cx="13" cy="14" r="1" fill="#10b981" />
      <circle cx="16" cy="14" r="1" fill="#10b981" />
      <path d="M7 20 L5 22 L7 22 Z" fill="#10b981" />
    </svg>
  );
}

