'use client';
// Піктограмка «З початку місяця»: місяць який зростає (waxing) + стрілка вправо справа від місяця

export function MonthStartIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`shrink-0 inline-block ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Waxing crescent: великий серп (освітлена частина справа), видно місяць */}
      <path
        d="M10 6 A 8 8 0 0 1 10 18 A 8 8 0 0 0 10 6 Z"
        fill="currentColor"
      />
      {/* Стрілка вправо справа від місяця */}
      <path d="M18 6v12l6-6-6-6z" fill="currentColor" />
    </svg>
  );
}
