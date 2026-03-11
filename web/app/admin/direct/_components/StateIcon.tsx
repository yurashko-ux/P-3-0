// web/app/admin/direct/_components/StateIcon.tsx
// Компонент для відображення піктограми стану (SVG для new-lead/message/lead/consultation, emoji для інших)

"use client";

const iconStyle = (size: number) => ({ width: `${size}px`, height: `${size}px` });

const STATE_EMOJI: Record<string, string> = {
  client: "👤",
  "consultation-no-show": "❌",
  "consultation-rescheduled": "🔁",
  "all-good": "✅",
  "too-expensive": "💰",
  sold: "🔥",
};

export function StateIcon({ state, size = 36 }: { state: string | null; size?: number }) {
  const s = iconStyle(size);

  if (state === 'consultation' || state === 'consultation-booked') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={s}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#2563eb" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M12 18 L13.5 19.5 L16 17" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (state === 'message') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={s}>
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  }
  if (state === 'new-lead') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={s} aria-label="Новий лід">
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#3b82f6" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#3b82f6"/>
        <circle cx="13" cy="14" r="1" fill="#3b82f6"/>
        <circle cx="16" cy="14" r="1" fill="#3b82f6"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#3b82f6"/>
      </svg>
    );
  }
  if (state === 'lead') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={s}>
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#10b981" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#10b981"/>
        <circle cx="13" cy="14" r="1" fill="#10b981"/>
        <circle cx="16" cy="14" r="1" fill="#10b981"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#10b981"/>
      </svg>
    );
  }
  if (state === 'binotel-lead') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={s} aria-label="Binotel-лід">
        <path d="M7 14 C7 10.686 9.686 8 13 8 C16.314 8 19 10.686 19 14 C19 17.314 16.314 20 13 20 L7 20 C4.791 20 3 18.209 3 16 C3 13.791 4.791 12 7 12" stroke="#AF0087" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1" fill="#AF0087"/>
        <circle cx="13" cy="14" r="1" fill="#AF0087"/>
        <circle cx="16" cy="14" r="1" fill="#AF0087"/>
        <path d="M7 20 L5 22 L7 22 Z" fill="#AF0087"/>
      </svg>
    );
  }
  if (state === 'consultation-past') {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={s}>
        <rect x="5" y="6" width="18" height="18" rx="2" fill="#ec4899" stroke="#db2777" strokeWidth="1.5"/>
        <path d="M8 4 L8 10 M20 4 L20 10" stroke="#db2777" strokeWidth="2" strokeLinecap="round"/>
        <path d="M5 12 L23 12" stroke="#db2777" strokeWidth="1.5"/>
        <circle cx="14" cy="18" r="3" fill="#ffffff"/>
        <path d="M12 18 L13.5 19.5 L16 17" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  // Іконка «повернуто клієнтів» / «відновлено консультацій» — синя 2 у світло-синьому колі (як BlueCircle2Icon у DirectClientTable)
  if (state === 'returned') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={s} aria-label="Повернуто / Відновлено">
        <circle cx="12" cy="12" r="11" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="1.5"/>
        <text x="12" y="12" textAnchor="middle" dominantBaseline="central" fill="#2563EB" fontWeight="bold" fontSize="12" fontFamily="system-ui">2</text>
      </svg>
    );
  }

  const emoji = state ? (STATE_EMOJI[state] ?? "💬") : "💬";
  return (
    <span
      className="leading-none inline-flex items-center justify-center"
      style={{ fontSize: `${Math.round(size * 0.86)}px` }}
      aria-hidden
    >
      {emoji}
    </span>
  );
}
