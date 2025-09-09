// web/components/CounterPill.tsx
"use client";

export default function CounterPill({
  value,
  className = "",
}: {
  value: number | string;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full bg-gray-100 text-gray-700 " +
        "px-2 py-0.5 text-sm leading-none " +
        className
      }
    >
      {value}
    </span>
  );
}
