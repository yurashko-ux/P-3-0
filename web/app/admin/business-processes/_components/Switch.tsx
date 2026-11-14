// Перемикач «увімкнено / вимкнено» у стилі розділу.
"use client";

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-xs text-gray-700 disabled:opacity-50"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? "border-[#7cc49a] bg-[#8fd1aa]" : "border-slate-300 bg-slate-200"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.25)] transition-[left] ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}
