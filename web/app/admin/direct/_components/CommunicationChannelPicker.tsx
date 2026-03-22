// web/app/admin/direct/_components/CommunicationChannelPicker.tsx
// Вибір каналу комунікації іконками (колонка «Комунікація» у Direct)

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  DIRECT_COMMUNICATION_CHANNELS,
  type DirectCommunicationChannel,
} from "@/lib/direct-communication-channel";

type Props = {
  value: DirectCommunicationChannel | null | undefined;
  onChange: (next: DirectCommunicationChannel | null) => void | Promise<void>;
  /** Трохи більший тригер у формі клієнта */
  size?: "table" | "form";
};

/** Без класів btn (DaisyUI): вони стискали <img> у flex і піктограми зникали */
export function CommunicationChannelPicker({ value, onChange, size = "table" }: Props) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const imgClass =
    size === "form"
      ? "h-6 w-6 shrink-0 object-contain block pointer-events-none select-none"
      : "h-[18px] w-[18px] shrink-0 object-contain block pointer-events-none select-none";

  const triggerClass =
    size === "form"
      ? "inline-flex items-center justify-center h-9 min-h-9 min-w-9 px-2 rounded-lg bg-base-200/35 hover:bg-base-200/65 active:bg-base-200/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 cursor-pointer"
      : "inline-flex items-center justify-center h-7 min-h-7 min-w-7 px-1 rounded-md bg-base-200/30 hover:bg-base-200/60 active:bg-base-200/75 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 cursor-pointer";

  const menuItemClass =
    "inline-flex items-center justify-center h-8 w-8 shrink-0 rounded-md hover:bg-base-200/75 active:bg-base-200/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 cursor-pointer border-0 bg-transparent p-0";

  const updatePosition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuApproxH = 220;
    let top = r.bottom + 4;
    if (top + menuApproxH > window.innerHeight - 8) {
      top = Math.max(8, r.top - menuApproxH - 4);
    }
    setMenuStyle({
      position: "fixed",
      top,
      left: Math.min(r.left, window.innerWidth - 96),
      zIndex: 999999,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => setOpen(false);
    const onResize = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = DIRECT_COMMUNICATION_CHANNELS.find((c) => c.value === value);

  const menu =
    open && typeof document !== "undefined" ? (
      <div
        ref={menuRef}
        className="p-1.5 bg-base-100 rounded-lg shadow-lg flex flex-col gap-1 items-stretch min-w-[2.25rem]"
        style={menuStyle}
        role="listbox"
        aria-label="Обрати канал комунікації"
      >
        <button
          type="button"
          className={`${menuItemClass} w-full text-xs text-base-content/70`}
          title="Не обрано"
          onClick={async () => {
            setOpen(false);
            await Promise.resolve(onChange(null));
          }}
        >
          —
        </button>
        {DIRECT_COMMUNICATION_CHANNELS.map((c) => (
          <button
            key={c.value}
            type="button"
            className={menuItemClass}
            title={c.labelUk}
            role="option"
            aria-selected={value === c.value}
            onClick={async () => {
              setOpen(false);
              await Promise.resolve(onChange(c.value));
            }}
          >
            <img src={c.iconSrc} alt="" className={imgClass} width={size === "form" ? 24 : 18} height={size === "form" ? 24 : 18} />
          </button>
        ))}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={triggerClass}
        onClick={() => {
          setOpen((o) => !o);
        }}
        title={current?.labelUk ?? "Комунікація: не обрано"}
        aria-label="Комунікація"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current ? (
          <img
            src={current.iconSrc}
            alt=""
            className={imgClass}
            width={size === "form" ? 24 : 18}
            height={size === "form" ? 24 : 18}
          />
        ) : (
          <span className="text-xs text-base-content/55 tabular-nums leading-none px-0.5">—</span>
        )}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}
