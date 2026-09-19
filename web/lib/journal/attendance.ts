// Статуси візиту журналу (attendance) і кольори блоків у календарі.

export type JournalAttendance = 0 | 1 | 2 | -1;

export const JOURNAL_ATTENDANCE_OPTIONS: Array<{
  value: JournalAttendance;
  label: string;
  short: string;
  /** Іконка для кнопки (unicode / символ) */
  icon: string;
  /** Колір іконки в неактивному стані */
  iconColor: string;
}> = [
  { value: 0, label: "Очікування", short: "В очікуванні", icon: "◷", iconColor: "#f97316" },
  { value: 1, label: "Клієнт прийшов", short: "Клієнт прийшов", icon: "+", iconColor: "#22c55e" },
  { value: -1, label: "Не зʼявився", short: "Не зʼявився", icon: "−", iconColor: "#ef4444" },
  { value: 2, label: "Підтверджено", short: "Підтвердив", icon: "✓", iconColor: "#64748b" },
];

export function attendanceBlockStyle(attendance: number | null | undefined): {
  bg: string;
  border: string;
  text: string;
} {
  switch (attendance) {
    case 1:
      return { bg: "#86efac", border: "#22c55e", text: "#14532d" }; // зелений — прийшов
    case 2:
      return { bg: "#93c5fd", border: "#3b82f6", text: "#1e3a8a" }; // синій — підтверджено
    case -1:
      return { bg: "#fca5a5", border: "#ef4444", text: "#7f1d1d" }; // червоний — не зʼявився
    case 0:
    default:
      return { bg: "#fdba74", border: "#f97316", text: "#7c2d12" }; // помаранчевий — очікування
  }
}

/** @deprecated використовуйте attendanceBlockStyle для надійного фону */
export function attendanceBlockClass(attendance: number | null | undefined): string {
  switch (attendance) {
    case 1:
      return "bg-[#86efac] text-[#14532d] border-[#22c55e]";
    case 2:
      return "bg-[#93c5fd] text-[#1e3a8a] border-[#3b82f6]";
    case -1:
      return "bg-[#fca5a5] text-[#7f1d1d] border-[#ef4444]";
    case 0:
    default:
      return "bg-[#fdba74] text-[#7c2d12] border-[#f97316]";
  }
}

export function normalizeAttendance(raw: unknown): JournalAttendance {
  const n = Number(raw);
  if (n === 1 || n === 2 || n === -1 || n === 0) return n;
  return 0;
}

export function attendanceLabel(attendance: number | null | undefined): string {
  const opt = JOURNAL_ATTENDANCE_OPTIONS.find((o) => o.value === attendance);
  return opt?.label || "Очікування";
}
