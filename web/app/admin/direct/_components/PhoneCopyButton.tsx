"use client";

import { useState } from "react";

function formatPhoneTooltip(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) {
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  }
  if (d.length === 12 && d.startsWith("380")) {
    return `+380 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  return phone.trim();
}

function showCopiedToast(): void {
  if (typeof document === "undefined") return;
  const toast = document.createElement("div");
  toast.textContent = "скопійовано";
  toast.style.cssText = [
    "position: fixed",
    "top: 16px",
    "right: 16px",
    "z-index: 10050",
    "padding: 10px 14px",
    "border-radius: 10px",
    "color: #fff",
    "background: #16a34a",
    "font-size: 13px",
    "font-weight: 600",
    "box-shadow: 0 8px 24px rgba(0,0,0,0.16)",
  ].join(";");
  document.body.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 1500);
}

/** Зелена трубка: копіює телефон і показує «скопійовано». */
export function PhoneCopyButton({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  const display = formatPhoneTooltip(phone);
  return (
    <button
      type="button"
      className="inline-flex h-5 w-5 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
      title={copied ? "скопійовано" : display}
      aria-label={`Скопіювати телефон ${display}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(display);
          setCopied(true);
          showCopiedToast();
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.4 21 3 13.6 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.02l-2.2 2.19z" />
      </svg>
    </button>
  );
}
