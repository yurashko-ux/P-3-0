// web/lib/direct-types.ts
// TypeScript типи для розділу Direct Manager

import type { DirectClientStateLog } from './direct-state-log';

export type DirectClient = {
  id: string; // UUID або timestamp-based ID
  instagramUsername: string; // Нікнейм в Instagram
  firstName?: string;
  lastName?: string;
  source: 'instagram' | 'tiktok' | 'other'; // Джерело реклами
  state?: 'lead' | 'client' | 'consultation' | 'hair-extension' | 'other-services' | 'all-good' | 'too-expensive' | 'message'; // Системний стан: Лід, Клієнт, Консультація, Нарощування волосся, Інші послуги, Все чудово, Все добре але занадто дорого, Повідомлення
  firstContactDate: string; // ISO date - дата першого контакту
  statusId: string; // ID статусу зі списку статусів
  masterId?: string; // ID майстра (відповідальний)
  masterManuallySet?: boolean; // Чи був відповідальний вибраний вручну
  consultationDate?: string; // ISO date - дата консультації
  visitedSalon: boolean; // Чи прийшов клієнт в салон на консультацію (Конверсія 1)
  visitDate?: string; // ISO date - дата візиту в салон
  signedUpForPaidService: boolean; // Чи записався на платну послугу (Конверсія 2)
  paidServiceDate?: string; // ISO date - дата запису на платну послугу
  signupAdmin?: string; // Хто записав (ім'я адміна)
  comment?: string; // Коментар/нотатки
  altegioClientId?: number; // ID клієнта в Altegio (якщо знайдено)
  lastMessageAt?: string; // ISO date - останнє повідомлення
  createdAt: string; // ISO date - коли створено запис
  updatedAt: string; // ISO date - останнє оновлення
  last5States?: DirectClientStateLog[]; // Останні 5 станів для відображення в таблиці
};

export type DirectStatus = {
  id: string; // UUID
  name: string; // Назва статусу (напр. "Новий", "Консультація", "Записався")
  color: string; // Колір для відображення (hex)
  order: number; // Порядок сортування
  isDefault: boolean; // Чи це статус за замовчуванням для нових клієнтів
  createdAt: string;
};

export type DirectStats = {
  totalClients: number;
  byStatus: Record<string, number>; // Кількість клієнтів по кожному статусу
  conversion1: {
    // Конверсія 1: Запис на консультацію → Візит в салон
    consultationsWithMaster: number; // Записані на консультацію з майстром
    visitedSalon: number; // Реально прийшли в салон
    rate: number; // Конверсія в %
  };
  conversion2: {
    // Конверсія 2: Візит в салон → Запис на платну послугу
    visitedSalon: number; // Прийшли в салон
    signedUpForPaid: number; // Записалися на платну послугу
    rate: number; // Конверсія в %
  };
  overallConversion: {
    // Загальна конверсія: Запис на консультацію → Запис на платну послугу
    consultationsWithMaster: number;
    signedUpForPaid: number;
    rate: number;
  };
};
