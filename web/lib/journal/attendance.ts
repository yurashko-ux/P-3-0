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
  /** Верхня смуга картки (як у Altegio) */
  strip: string;
} {
  // Насичені кольори карток як у журналі Altegio: зелена смуга часу, тіло за статусом.
  switch (attendance) {
    case 1:
      return { bg: "#bdf3d4", border: "#8ed9ae", text: "#1d5c3a", strip: "#5dce80" };
    case 2:
      return { bg: "#d9c8f8", border: "#c0aaea", text: "#433560", strip: "#5dce80" };
    case -1:
      return { bg: "#f6c9c4", border: "#e3a8a2", text: "#6b3030", strip: "#e07070" };
    case 0:
    default:
      return { bg: "#ffb7a4", border: "#f09a86", text: "#6a3a2e", strip: "#5dce80" };
  }
}

/** @deprecated використовуйте attendanceBlockStyle для надійного фону */
export function attendanceBlockClass(attendance: number | null | undefined): string {
  switch (attendance) {
    case 1:
      return "bg-[#bdf3d4] text-[#1d5c3a] border-[#8ed9ae]";
    case 2:
      return "bg-[#d9c8f8] text-[#433560] border-[#c0aaea]";
    case -1:
      return "bg-[#f6c9c4] text-[#6b3030] border-[#e3a8a2]";
    case 0:
    default:
      return "bg-[#ffb7a4] text-[#6a3a2e] border-[#f09a86]";
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
