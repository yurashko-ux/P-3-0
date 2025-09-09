// web/components/CounterPill.tsx
"use client";

export default function CounterPill({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number | string;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-sm leading-none align-middle select-none " +
        className
      }
    >
      <span className="font-medium mr-1">{label}:</span>
      <span className="tabular-nums">{value ?? 0}</span>
    </span>
  );
}
