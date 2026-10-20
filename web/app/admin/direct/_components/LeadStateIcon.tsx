// Іконка стану ліда: синя хмарка в день першого контакту, далі зелена «повідомлення».

"use client";

import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { StateIcon } from "./StateIcon";

export function LeadStateIcon({
  firstContactDate,
  size = 18,
}: {
  firstContactDate?: string | null;
  size?: number;
}) {
  const today = kyivDayFromISO(new Date().toISOString());
  const firstDay = firstContactDate ? kyivDayFromISO(firstContactDate) : "";
  const isNewToday = Boolean(firstDay && firstDay === today);
  const title = isNewToday
    ? "Новий лід (перший контакт сьогодні)"
    : "Повідомлення / Лід (перший контакт раніше)";

  return (
    <span className="inline-flex items-center justify-center" title={title}>
      <StateIcon state={isNewToday ? "new-lead" : "message"} size={size} />
    </span>
  );
}
