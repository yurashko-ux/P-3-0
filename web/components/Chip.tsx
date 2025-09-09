// web/components/Chip.tsx
"use client";

export default function Chip({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full bg-blue-600 text-white " +
        "px-2.5 py-0.5 text-sm leading-none " +
        className
      }
    >
      {text}
    </span>
  );
}
