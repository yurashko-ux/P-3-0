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
      {/* Права половина кола: вертикальна лінія по центру (12,2)-(12,22) + дуга праворуч (sweep 0 = проти годинникової) */}
      <path
        d="M 12 2 L 12 22 A 10 10 0 0 0 12 2 Z"
        fill={YELLOW}
      />
    </svg>
  );
}
