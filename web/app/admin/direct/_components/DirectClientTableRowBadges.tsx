"use client";

/** Компактні бейджі для типу контакту / витрат у колонці «Повне імʼя» */

export function LeadBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <circle cx="10" cy="10" r="7.2" fill="#3b82f6" stroke="#2563eb" strokeWidth="1.2" />
    </svg>
  );
}

export function BinotelLeadBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Binotel-лід"
    >
      <circle cx="10" cy="10" r="7.2" fill="#AF0087" stroke="#8B006E" strokeWidth="1.2" />
    </svg>
  );
}

export function SpendCircleBadge({ size = 18, number }: { size?: number; number?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Кружок за витрати"
    >
      <circle cx="12" cy="12" r="9" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.2" />
      {typeof number === "number" ? (
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fontWeight="700"
          fill="#111827"
        >
          {number}
        </text>
      ) : null}
    </svg>
  );
}

export function SpendStarBadge({
  size = 18,
  number,
  fontSize = 12,
}: {
  size?: number;
  number?: number;
  fontSize?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Зірка за витрати"
    >
      <path
        d="M10 1.5L12.7 7.2L18.8 7.6L14.1 11.5L15.6 17.8L10 14.5L4.4 17.8L5.9 11.5L1.2 7.6L7.3 7.2Z"
        fill="#fbbf24"
        stroke="#f59e0b"
        strokeWidth="1.2"
      />
      {typeof number === "number" ? (
        <text
          x="10"
          y="11.5"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={fontSize}
          fontWeight="700"
          fill="#111827"
        >
          {number}
        </text>
      ) : null}
    </svg>
  );
}

export function SpendMegaBadge({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="Бейдж за витрати понад 1 млн"
    >
      <polygon points="12,2 22,9 19,22 5,22 2,9" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.2" />
      <circle cx="12" cy="12.5" r="4.8" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.2" />
    </svg>
  );
}

export function ClientBadgeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <circle cx="10" cy="10" r="7.6" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.2" />
      <circle cx="10" cy="8.2" r="2.2" fill="#111827" opacity="0.85" />
      <path
        d="M5.9 14.85c1.22-2.1 2.84-3.05 4.1-3.05s2.88.95 4.1 3.05"
        stroke="#111827"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}
