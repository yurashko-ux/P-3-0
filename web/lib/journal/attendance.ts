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
  // Як у Altegio: одна бірюзова смуга часу, тіло запису — насичений статус.
  const strip = "#1ab394";
  switch (attendance) {
    case 1:
      return { bg: "#ffe3cc", border: "#f0c4a0", text: "#5c3208", strip };
    case 2:
      return { bg: "#b3bdfd", border: "#a0acfd", text: "#1a6290", strip };
    case -1:
      return { bg: "#ffd6d6", border: "#f0b4b4", text: "#6e1c1c", strip };
    case 0:
    default:
      return { bg: "#9ee5d7", border: "#86dfcd", text: "#3d6b63", strip };
  }
}

/** @deprecated використовуйте attendanceBlockStyle для надійного фону */
export function attendanceBlockClass(attendance: number | null | undefined): string {
  switch (attendance) {
    case 1:
      return "bg-[#ffe3cc] text-[#5c3208] border-[#f0c4a0]";
    case 2:
      return "bg-[#b3bdfd] text-[#1a6290] border-[#a0acfd]";
    case -1:
      return "bg-[#ffd6d6] text-[#6e1c1c] border-[#f0b4b4]";
    case 0:
    default:
      return "bg-[#9ee5d7] text-[#3d6b63] border-[#86dfcd]";
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
