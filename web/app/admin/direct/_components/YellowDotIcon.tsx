'use client';
// Жовта крапочка для підрозділу «Записів майбутніх» (емоджі замість styled span — можна копіювати)

export function YellowDotIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
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
