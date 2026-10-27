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
  // Пастельні тони — комфортніше для довгої роботи з календарем.
  switch (attendance) {
    case 1:
      return { bg: "#d9f0df", border: "#b5d9bf", text: "#2f5a3d", strip: "#7aab88" };
    case 2:
      return { bg: "#d9e7f5", border: "#b3c9de", text: "#2f4a66", strip: "#7a98b3" };
    case -1:
      return { bg: "#f2d9d9", border: "#deb3b3", text: "#663030", strip: "#b37a7a" };
    case 0:
    default:
      return { bg: "#f5e4d0", border: "#e0c4a3", text: "#5c3d22", strip: "#6a9e96" };
  }
}

/** @deprecated використовуйте attendanceBlockStyle для надійного фону */
export function attendanceBlockClass(attendance: number | null | undefined): string {
  switch (attendance) {
    case 1:
      return "bg-[#d9f0df] text-[#2f5a3d] border-[#b5d9bf]";
    case 2:
      return "bg-[#d9e7f5] text-[#2f4a66] border-[#b3c9de]";
    case -1:
      return "bg-[#f2d9d9] text-[#663030] border-[#deb3b3]";
    case 0:
    default:
      return "bg-[#f5e4d0] text-[#5c3d22] border-[#e0c4a3]";
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
