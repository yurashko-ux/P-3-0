// Колонка «Запис» у таблиці Direct: показуємо або платний запис, або консультацію (вони взаємовиключні).
// Правило: актуальне (сьогодні/майбутнє) важливіше за минуле; якщо обидва актуальні або обидва минулі — платний запис.
// Консультація лишається в колонці, доки не зʼявиться платний запис.

export type DirectRecordSlot = "paid" | "consultation" | null;

type SlotClient = {
  signedUpForPaidService?: boolean | null;
  paidServiceDate?: string | Date | null;
  consultationBookingDate?: string | Date | null;
};

const kyivDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toKyivDay(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).trim());
  if (isNaN(d.getTime())) return null;
  return kyivDayFmt.format(d);
}

export function todayKyivDay(): string {
  return kyivDayFmt.format(new Date());
}

export function pickDirectRecordSlot(client: SlotClient, today: string = todayKyivDay()): DirectRecordSlot {
  const paidDay = client.signedUpForPaidService ? toKyivDay(client.paidServiceDate) : null;
  const consultDay = toKyivDay(client.consultationBookingDate);
  if (!paidDay) return consultDay ? "consultation" : null;
  if (!consultDay) return "paid";
  if (paidDay >= today) return "paid";
  if (consultDay >= today) return "consultation";
  return "paid";
}

/** Дата, яку показує колонка «Запис» (для сортування). */
export function directRecordSlotDate(client: SlotClient, today: string = todayKyivDay()): string | Date | null {
  const slot = pickDirectRecordSlot(client, today);
  if (slot === "paid") return client.paidServiceDate ?? null;
  if (slot === "consultation") return client.consultationBookingDate ?? null;
  return null;
}
