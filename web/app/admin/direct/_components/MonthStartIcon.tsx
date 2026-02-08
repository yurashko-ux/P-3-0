'use client';
// Піктограмка «З початку місяця»: серп місяця (waxing) + стрілка вправо (як на референс-картинці, без тла)

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
      {/* Серп місяця (waxing): освітлена частина справа, опуклість зліва */}
      <path
        d="M14 6 A 8 8 0 0 1 14 18 A 8 8 0 0 0 14 6 Z"
        fill="currentColor"
      />
      {/* Стрілка вправо — виходить з отвору серпа */}
      <path d="M16 7v10l7-5-7-5z" fill="currentColor" />
    </svg>
  );
}
