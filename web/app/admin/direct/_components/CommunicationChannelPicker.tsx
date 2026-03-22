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
  /** Трохи більша кнопка у формі клієнта */
  size?: "table" | "form";
};

export function CommunicationChannelPicker({ value, onChange, size = "table" }: Props) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Таблиця: компактні піктограми без «важких» рамок */
  const imgClass = size === "form" ? "h-6 w-6 object-contain" : "h-4 w-4 object-contain";
  const btnClass =
    size === "form"
      ? "btn btn-ghost btn-sm h-9 min-h-9 px-2 rounded-lg border-0 shadow-none bg-base-200/30 hover:bg-base-200/60"
      : "btn btn-ghost btn-xs h-7 min-h-7 px-1 rounded-md border-0 shadow-none bg-base-200/25 hover:bg-base-200/55";

  const updatePosition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuApproxH = 200;
    let top = r.bottom + 4;
    if (top + menuApproxH > window.innerHeight - 8) {
      top = Math.max(8, r.top - menuApproxH - 4);
    }
    setMenuStyle({
      position: "fixed",
      top,
      left: Math.min(r.left, window.innerWidth - 88),
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
        className="p-1 bg-base-100 rounded-lg shadow-lg flex flex-col gap-0.5 min-w-[2rem] border-0 outline-none ring-0"
        style={menuStyle}
        role="listbox"
        aria-label="Обрати канал комунікації"
      >
        <button
          type="button"
          className="btn btn-ghost btn-xs justify-center h-7 min-h-7 w-full px-0 border-0 shadow-none hover:bg-base-200/70"
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
            className="btn btn-ghost btn-xs p-0 h-7 min-h-7 w-7 min-w-7 flex items-center justify-center border-0 shadow-none hover:bg-base-200/70"
            title={c.labelUk}
            role="option"
            aria-selected={value === c.value}
            onClick={async () => {
              setOpen(false);
              await Promise.resolve(onChange(c.value));
            }}
          >
            <img src={c.iconSrc} alt={c.labelUk} className={imgClass} />
          </button>
        ))}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={btnClass}
        onClick={() => {
          setOpen((o) => !o);
        }}
        title={current?.labelUk ?? "Комунікація: не обрано"}
        aria-label="Комунікація"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current ? (
          <img src={current.iconSrc} alt={current.labelUk} className={imgClass} />
        ) : (
          <span className="text-xs text-base-content/50 px-1">—</span>
        )}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}
