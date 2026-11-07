/** Кнопка навігації в стилі плиток Каси: м’який фон, тонка рамка, тінь. */
export function navTileClass(active: boolean): string {
  const base =
    "inline-flex shrink-0 items-center rounded-lg border border-slate-200/80 px-2 py-1 text-[10px] font-medium leading-tight shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_10px_-6px_rgba(15,23,42,0.28)] transition-[transform,box-shadow,filter] duration-150 ease-out hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_6px_12px_-6px_rgba(15,23,42,0.32)] active:translate-y-px active:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400";
  return `${base} ${active ? "bg-[#dbe7f5] font-semibold text-blue-800" : "bg-[#f3f5f8] text-gray-800"}`;
}
