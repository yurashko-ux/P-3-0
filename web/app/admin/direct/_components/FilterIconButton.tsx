"use client";

interface FilterIconButtonProps {
  active: boolean;
  onClick: () => void;
  title: string;
}

export function FilterIconButton({ active, onClick, title }: FilterIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center w-6 h-6 rounded border-2 hover:bg-base-300 transition-colors ${
        active ? "bg-blue-100 text-blue-600 border-blue-500" : "text-gray-500 border-gray-500"
      }`}
      title={title}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 3h8M3 6h6M4.5 9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
