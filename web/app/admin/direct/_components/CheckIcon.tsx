'use client';
// SVG-іконка галочки для attendance (зелена = прийшов, синя = підтвердив запис)

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
