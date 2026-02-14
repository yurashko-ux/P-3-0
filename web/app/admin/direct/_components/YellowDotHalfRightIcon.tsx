'use client';
// Права половина жовтої крапочки — для підрозділу «До кінця місяця» (емоджі замість SVG — можна копіювати)

export function YellowDotHalfRightIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`shrink-0 inline-block leading-none ${className}`}
      style={{ fontSize: `${Math.round(size * 0.9)}px` }}
      aria-hidden
    >
      🟡
    </span>
  );
}
