"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  text: string;
};

/** Попап-підказка при наведенні на лічильник кампанії / групи. */
export function InactiveBaseCounterHoverTip({ children, text }: Props) {
  return (
    <span className="relative inline-flex group/counter-tip">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 bottom-[calc(100%+6px)] z-[100] hidden w-max max-w-[240px] -translate-x-1/2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[10px] font-normal leading-snug text-slate-900 shadow-lg group-hover/counter-tip:block"
      >
        {text}
      </span>
    </span>
  );
}
