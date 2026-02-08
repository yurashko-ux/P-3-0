'use client';
// Піктограмка «З початку місяця»: місяць який зростає (waxing) + стрілка вправо справа від місяця. Тільки зберегти, не використовувати в поточному завданні.

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
      {/* Waxing crescent: серп (освітлена частина справа), viewBox 0-12 для місяця */}
      <g transform="translate(0, 0)">
        <path
          d="M10 6 A 6 6 0 0 1 10 18 A 6 6 0 0 0 10 6 Z"
          fill="currentColor"
        />
      </g>
      {/* Стрілка вправо справа від місяця */}
      <path d="M16 7l6 5-6 5V7z" fill="currentColor" transform="translate(2, 0)" />
    </svg>
  );
}
