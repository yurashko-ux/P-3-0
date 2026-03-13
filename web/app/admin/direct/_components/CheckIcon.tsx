'use client';
// Зелена галочка = emoji ✅, синя = ConfirmedCheckIcon (SVG badge, +50% розмір)

/** Синій заливений badge з білою галочкою — для attendance=2. Розмір у 1.5× для візуальної помітності. */
export function ConfirmedCheckIcon({
  size = 21,
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
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#2563EB" />
      <path
        d="M7 12.5L10.5 16L17 9.5"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
