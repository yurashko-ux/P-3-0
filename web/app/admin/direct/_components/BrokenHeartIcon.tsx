'use client';
// Піктограмка «Без продажу» — розламане серце (емоджі замість SVG — можна копіювати)

export function BrokenHeartIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`shrink-0 inline-block leading-none ${className}`}
      style={{ fontSize: `${Math.round(size * 0.9)}px` }}
      aria-hidden
    >
      💔
    </span>
  );
}
