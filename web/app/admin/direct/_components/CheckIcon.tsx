'use client';
// SVG-іконки для attendance: CheckIcon (зелена outline) = прийшов, ConfirmedCheckIcon (синій badge) = підтвердив запис

export function CheckIcon({
  size = 14,
  className = '',
  colorClass = 'text-green-600',
}: {
  size?: number;
  className?: string;
  colorClass?: string;
}) {
  return (
    <svg
      className={`${colorClass} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** Синій заливений badge з білою галочкою — для attendance=2 (підтвердив запис). Масштаб 0.8 щоб візуально збігався з зеленою outline-галочкою. */
export function ConfirmedCheckIcon({
  size = 14,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <g transform="translate(2.4, 2.4) scale(0.8)">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="#2563EB" />
        <path
          d="M7 12.5L10.5 16L17 9.5"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
