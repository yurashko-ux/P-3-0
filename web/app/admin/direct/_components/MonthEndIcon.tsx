'use client';
// Піктограмка «До кінця місяця»: місяць що спадає (waning) без зірок + стрілка вправо зліва від місяця

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
      <path d="M2 7l6 5-6 5V7z" fill="currentColor" />
      {/* Waning crescent: серп (освітлена частина зліва), viewBox 12-24 для місяця */}
      <g transform="translate(12, 0)">
        <path
          d="M10 6 A 6 6 0 0 0 10 18 A 6 6 0 0 1 10 6 Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}
