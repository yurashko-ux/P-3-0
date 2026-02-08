'use client';
// Права половина жовтої крапочки (розріз по вертикалі) — для підрозділу «До кінця місяця»

const YELLOW = '#EAB308';

export function YellowDotHalfRightIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`shrink-0 inline-block ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Права половина кола (вертикальний розріз по центру) */}
      <path
        d="M12 2 A 10 10 0 0 1 12 22 A 10 10 0 0 1 12 2 Z"
        fill={YELLOW}
      />
    </svg>
  );
}
