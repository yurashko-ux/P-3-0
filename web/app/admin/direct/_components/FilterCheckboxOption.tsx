"use client";

type Props = {
  label: string;
  selected: boolean;
  count: number | string | null;
  onClick: () => void;
};

/** Рядок опції фільтра з чекбоксом — як у InstFilterDropdown (Direct). */
export function FilterCheckboxOption({ label, selected, count, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${
        selected ? "bg-blue-50 text-blue-700" : "text-gray-700"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span
          className={`inline-flex shrink-0 items-center justify-center w-3 h-3 rounded border ${
            selected ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"
          }`}
        >
          {selected ? (
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
              <path
                d="M10 3L4.5 8.5L2 6"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="text-gray-500 font-medium tabular-nums shrink-0 ml-2">
        {count != null ? count : "…"}
      </span>
    </button>
  );
}
