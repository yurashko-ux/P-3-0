'use client';
// Жовтий серп місяця (форма зі скріна — waxing crescent, роги вправо)

const YELLOW = '#EAB308';

export function YellowCrescentIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`shrink-0 inline-block ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Waxing crescent: видима частина справа, тінь зліва (дуга як на скріні) */}
      <path
        d="M12 4 A 8 8 0 0 1 12 20 A 8 8 0 0 0 9 19.42 A 8 8 0 1 0 9 4.58 A 8 8 0 0 0 12 4 Z"
        fill={YELLOW}
      />
    </svg>
  );
}
