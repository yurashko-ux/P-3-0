// Аватар у слоті + червоні крапки в куті (Direct таблиця)
"use client";

import type { SyntheticEvent, ReactNode } from "react";

export function AvatarSlot({
  avatarSrc,
  onError,
  onLoad,
  onClick,
}: {
  avatarSrc: string | null;
  onError: (e: SyntheticEvent<HTMLImageElement, Event>) => void;
  onLoad?: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className={`w-10 h-10 rounded-full shrink-0 border border-slate-200 bg-slate-50 overflow-hidden ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
      onClick={onClick}
    >
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

export function CornerRedDot({ title, className }: { title: string; className?: string }) {
  return (
    <span
      className={`absolute ${className || "-top-[4px] -right-[4px]"} w-[8px] h-[8px] rounded-full bg-red-600 border border-white`}
      title={title}
      aria-label={title}
    />
  );
}

export function WithCornerRedDot({
  show,
  title,
  children,
  dotClassName,
}: {
  show: boolean;
  title: string;
  children: ReactNode;
  dotClassName?: string;
}) {
  return (
    <span className="relative inline-flex">
      {children}
      {show ? <CornerRedDot title={title} className={dotClassName} /> : null}
    </span>
  );
}
