'use client';
// Жовта крапочка для підрозділу «Записів майбутніх»

export function YellowDotIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`shrink-0 inline-block rounded-full bg-[#EAB308] ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
