// Статуси візиту журналу (attendance) і кольори блоків у календарі.

export type JournalAttendance = 0 | 1 | 2 | -1;

export const JOURNAL_ATTENDANCE_OPTIONS: Array<{
  value: JournalAttendance;
  label: string;
  /** Короткий підпис на кнопці */
  short: string;
}> = [
  { value: 0, label: "Очікування", short: "Очікування" },
  { value: 2, label: "Підтверджено", short: "Підтверджено" },
  { value: 1, label: "Клієнт прийшов", short: "Прийшов" },
  { value: -1, label: "Не зʼявився", short: "Не зʼявився" },
];

/** Фон блоку в календарі за статусом (як у Altegio). */
export function attendanceBlockClass(attendance: number | null | undefined): string {
  switch (attendance) {
    case 1:
      return "bg-[#4ade80] text-[#14532d] border-[#22c55e]"; // зелений — прийшов
    case 2:
      return "bg-[#60a5fa] text-[#1e3a8a] border-[#3b82f6]"; // синій — підтверджено
    case -1:
      return "bg-[#f87171] text-[#7f1d1d] border-[#ef4444]"; // червоний — не зʼявився
    case 0:
    default:
      return "bg-[#fb923c] text-[#7c2d12] border-[#f97316]"; // помаранчевий — очікування
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
