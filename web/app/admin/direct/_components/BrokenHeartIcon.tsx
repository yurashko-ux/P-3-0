'use client';
// Піктограмка «Без продажу» — розламане серце (дві половинки злегка розсунуті)

import { useId } from 'react';

export function BrokenHeartIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const heartPath =
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
  return (
    <svg
      className={`shrink-0 inline-block text-orange-500 ${className}`}
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <clipPath id={`broken-heart-left-${id}`}>
          <rect x="0" y="0" width="11" height="24" />
        </clipPath>
        <clipPath id={`broken-heart-right-${id}`}>
          <rect x="13" y="0" width="11" height="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#broken-heart-left-${id})`} style={{ transform: 'translateX(-1.2px)' }}>
        <path d={heartPath} fill="currentColor" />
      </g>
      <g clipPath={`url(#broken-heart-right-${id})`} style={{ transform: 'translateX(1.2px)' }}>
        <path d={heartPath} fill="currentColor" />
      </g>
    </svg>
  );
}
