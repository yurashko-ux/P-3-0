// web/components/Chip.tsx
"use client";

export default function Chip({
  text,
  tone = "pipeline",
  className = "",
}: {
  text: string;
  tone?: "pipeline" | "status";
  className?: string;
}) {
  const toneCls =
    tone === "pipeline"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-slate-100 text-slate-700 border-slate-300";

  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-sm leading-none " +
        toneCls +
        " " +
        className
      }
    >
      {text}
    </span>
  );
}
