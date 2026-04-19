// Утиліти для відображення останньої активності (ManyChat) та посилання пошуку в Altegio

/** Базовий URL списку клієнтів Altegio з увімкненим quick_search (query додається в кінці). */
export const ALTEGIO_CLIENTS_BASE_SEARCH_URL =
  "https://app.alteg.io/clients/1169323/base/?fields%5B0%5D=name&fields%5B1%5D=phone&fields%5B2%5D=email&fields%5B3%5D=sold_amount&fields%5B4%5D=visits_count&fields%5B5%5D=discount&fields%5B6%5D=last_visit_date&fields%5B7%5D=first_visit_date&order_by=id&order_by_direction=desc&page=1&page_size=25&segment=&operation=AND&filters%5B0%5D%5Boperation%5D=OR&filters%5B0%5D%5Bfilters%5D%5B0%5D%5Boperation%5D=AND&filters%5B0%5D%5Bfilters%5D%5B0%5D%5Bfilters%5D%5B0%5D%5Boperation%5D=AND&filters%5B1%5D%5Btype%5D=quick_search&filters%5B1%5D%5Bstate%5D%5Bvalue%5D=";

export function buildAltegioClientsSearchUrl(query: string): string {
  const q = (query || "").toString().trim();
  return `${ALTEGIO_CLIENTS_BASE_SEARCH_URL}${encodeURIComponent(q)}`;
}

/** Один найважливіший тригер з масиву ключів активності. */
export function getTriggerDescription(activityKeys: string[]): string {
  if (!activityKeys || activityKeys.length === 0) return "";

  const triggerMap: Record<string, string> = {
    message: "Нове повідомлення",
    binotel_call: "Дзвінок (Binotel)",
    callbackReminder: "Нагадування «передзвонити»",
    paidServiceDate: "Запис на платну послугу",
    paidServiceRecordCreatedAt: "Створення запису на платну послугу",
    paidServiceAttended: "Відвідування платної послуги",
    paidServiceCancelled: "Скасування платної послуги",
    paidServiceTotalCost: "Зміна вартості платної послуги",
    consultationBookingDate: "Запис на консультацію",
    consultationRecordCreatedAt: "Створення запису на консультацію",
    consultationAttended: "Відвідування консультації",
    consultationCancelled: "Скасування консультації",
  };

  const priority: Record<string, number> = {
    message: 10,
    binotel_call: 9,
    paidServiceDate: 8,
    callbackReminder: 7,
    paidServiceRecordCreatedAt: 8,
    consultationBookingDate: 8,
    paidServiceAttended: 6,
    consultationAttended: 6,
    paidServiceCancelled: 5,
    consultationCancelled: 5,
    paidServiceTotalCost: 4,
  };

  const validKeys = activityKeys.filter((key) => triggerMap[key]);
  if (validKeys.length === 0) return "";

  if (validKeys.length === 1) {
    return triggerMap[validKeys[0]];
  }

  const sortedByPriority = validKeys.sort((a, b) => {
    const priorityA = priority[a] || 0;
    const priorityB = priority[b] || 0;
    return priorityB - priorityA;
  });

  return triggerMap[sortedByPriority[0]];
}

/** Дата та час для lastActivityAt (dd.mm.yy HH:mm). */
export function formatActivityDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  } catch {
    return "";
  }
}
