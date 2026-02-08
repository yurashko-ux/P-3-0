'use client';
// Піктограмка «До кінця місяця»: місяць що спадає (waning) + стрілка вправо зліва від місяця

export function MonthEndIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`shrink-0 inline-block ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Стрілка вправо зліва */}
      <path d="M0 6v12l6-6-6-6z" fill="currentColor" />
      {/* Waning crescent: великий серп (освітлена частина зліва), видно місяць */}
      <path
        d="M14 6 A 8 8 0 0 0 14 18 A 8 8 0 0 1 14 6 Z"
        fill="currentColor"
        transform="translate(4, 0)"
      />
    </svg>
  );
}
