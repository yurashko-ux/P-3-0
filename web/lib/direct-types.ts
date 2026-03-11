// web/lib/direct-types.ts
// TypeScript типи для розділу Direct Manager

import type { DirectClientStateLog } from './direct-state-log';

export type DirectClient = {
  id: string; // UUID або timestamp-based ID
  instagramUsername: string; // Нікнейм в Instagram
  firstName?: string;
  lastName?: string;
  phone?: string; // Телефон з Altegio (зберігаємо як приходить з API)
  spent?: number; // Загальна сума витрат клієнта (з Altegio API)
  visits?: number; // Кількість візитів клієнта (з Altegio API)
  lastVisitAt?: string; // ISO date - дата останнього успішного візиту (Altegio last_visit_date)
  daysSinceLastVisit?: number; // Днів з останнього візиту (рахується в API для UI)
  lastActivityAt?: string; // ISO date - коли була остання “реальна активність” (що підняла клієнта вгору)
  lastActivityKeys?: string[]; // Які поля/тригери змінились в останній активності (для підсвіток у таблиці)
  source: 'instagram' | 'tiktok' | 'other'; // Джерело реклами
  state?: 'client' | 'consultation' | 'consultation-booked' | 'consultation-no-show' | 'consultation-rescheduled' | 'hair-extension' | 'other-services' | 'all-good' | 'too-expensive' | 'message'; // Системний стан: Клієнт, Консультація, Запис на консультацію, Клієнт не з'явився, Перенос дати запису на консультацію, Нарощування волосся, Інші послуги, Все чудово, Все добре але занадто дорого, Повідомлення
  firstContactDate: string; // ISO date - дата першого контакту
  statusId: string; // ID статусу зі списку статусів
  statusSetAt?: string; // ISO - коли встановлено статус
  masterId?: string; // ID майстра (відповідальний)
  masterManuallySet?: boolean; // Чи був відповідальний вибраний вручну
  consultationDate?: string; // ISO date - дата консультації
  visitedSalon: boolean; // Чи прийшов клієнт в салон на консультацію (Конверсія 1)
  visitDate?: string; // ISO date - дата візиту в салон
  signedUpForPaidService: boolean; // Чи записався на платну послугу (Конверсія 2)
  paidServiceDate?: string; // ISO date - дата запису на платну послугу
  paidServiceRecordCreatedAt?: string; // ISO date - коли створено запис в Altegio (за records/webhook log)
  paidServiceAttendanceSetAt?: string; // ISO date - коли встановлено paidServiceAttended/paidServiceCancelled (з вебхуків)
  paidServiceAttended?: boolean | null; // Чи прийшов на платну послугу (null = не встановлено, true = прийшов, false = не з'явився)
  paidServiceAttendanceValue?: 1 | 2; // 1 = зелена галочка, 2 = синя галочка (тільки коли paidServiceAttended=true)
  paidServiceCancelled?: boolean; // 🚫 Скасовано до дати запису (attendance=-1 до дня візиту)
  paidServiceDeletedInAltegio?: boolean; // Візит/запис видалено в Altegio (404) — не перезаписувати з вебхуків/sync
  paidServiceTotalCost?: number; // Сума поточного запису на платну послугу (грн, з вебхуків Altegio)
  paidServiceVisitId?: number; // ID візиту в Altegio (для breakdown з API)
  paidServiceRecordId?: number; // ID запису в візиті (для breakdown тільки по цьому record)
  paidServiceVisitBreakdown?: { masterName: string; sumUAH: number }[]; // Розбиття сум по майстрах з API
  signupAdmin?: string; // Хто записав (ім'я адміна)
  comment?: string; // Коментар/нотатки
  consultationBookingDate?: string; // ISO date - дата запису на консультацію
  consultationRecordCreatedAt?: string; // ISO date - коли створено запис в Altegio (за records/webhook log)
  consultationAttendanceSetAt?: string; // ISO date - коли встановлено consultationAttended/consultationCancelled (з вебхуків)
  consultationAttended?: boolean | null; // Чи прийшов на консультацію (null = не встановлено, true = прийшов, false = не з'явився)
  consultationAttendanceValue?: 1 | 2; // 1 = зелена галочка, 2 = синя галочка (тільки коли consultationAttended=true)
  consultationCancelled?: boolean; // 🚫 Скасовано до дати консультації (attendance=-1 до дня візиту)
  consultationDeletedInAltegio?: boolean; // Візит/запис видалено в Altegio (404) — не перезаписувати з вебхуків/sync
  consultationAttemptNumber?: number; // Номер спроби консультації (2/3/…), збільшуємо тільки після no-show
  consultationMasterId?: string; // ID майстра, який провів консультацію
  consultationMasterName?: string; // Ім'я майстра, який провів консультацію
  serviceMasterAltegioStaffId?: number; // Поточний майстер (Altegio staffId) з усіх записів (paid/consultation)
  serviceMasterName?: string; // Поточний майстер (Altegio staffName) з усіх записів (paid/consultation)
  serviceSecondaryMasterName?: string; // Допоміжний майстер для платного запису (2-й не-адмін у paid-групі за день)
  paidServiceHands?: 2 | 4 | 6; // 2/4/6 рук — з кількості non-admin staff у paid-групі (KV)
  serviceMasterHistory?: string; // Історія змін майстра (JSON): [{ kyivDay, masterName, source }]
  paidServiceIsRebooking?: boolean; // 🔁 Чи є поточний запис на платну послугу "перезаписом"
  paidServiceRebookFromKyivDay?: string; // YYYY-MM-DD (Europe/Kyiv) — день attended, після якого створено перезапис
  paidServiceRebookFromMasterName?: string; // Майстер, якому атрибутуємо перезапис (перший receivedAt у attended-групі)
  paidServiceRebookFromMasterId?: string; // ID майстра (DirectMaster), якщо знайдено
  paidRecordsInHistoryCount?: number; // Кількість платних записів в історії (records:log). 0 = перший платний запис (вогник)
  isOnlineConsultation?: boolean; // Чи це онлайн-консультація
  signedUpForPaidServiceAfterConsultation?: boolean; // Записалась на послугу після консультації
  telegramNotificationSent?: boolean; // Чи було відправлено повідомлення в Telegram про відсутній Instagram
  chatStatusId?: string; // Поточний статус переписки (id з DirectChatStatus)
  chatStatusSetAt?: string; // ISO - коли статус реально змінився
  chatStatusCheckedAt?: string; // ISO - коли адмін підтвердив актуальність
  chatStatusAnchorMessageId?: string; // id повідомлення, на якому зафіксовано зміну статусу (крапка в чаті)
  chatStatusAnchorMessageReceivedAt?: string; // ISO receivedAt повідомлення, на якому зафіксовано зміну статусу
  chatStatusAnchorSetAt?: string; // ISO - коли зафіксували anchor
  chatStatusName?: string; // Назва статусу (для tooltip у таблиці)
  chatStatusBadgeKey?: string; // badgeKey (1..10) для відображення бейджа
  callStatusId?: string; // Поточний статус дзвінків (id з DirectCallStatus)
  callStatusSetAt?: string; // ISO - коли встановили статус дзвінків
  callStatusName?: string; // Назва статусу дзвінків (для таблиці)
  callStatusBadgeKey?: string; // badgeKey (1..10) для бейджа статусу дзвінків
  callStatusLogs?: Array<{ statusName: string; changedAt: string }>; // Історія змін статусів дзвінків
  binotelCallsCount?: number; // Кількість дзвінків з Binotel (історія по лінії 0930007800)
  messagesTotal?: number; // Кількість повідомлень (з DirectMessage)
  chatNeedsAttention?: boolean; // Чи є нові вхідні після останнього підтвердження
  altegioClientId?: number; // ID клієнта в Altegio (якщо знайдено)
  lastMessageAt?: string; // ISO date - останнє повідомлення
  createdAt: string; // ISO date - коли створено запис
  updatedAt: string; // ISO date - останнє оновлення
  last5States?: DirectClientStateLog[]; // Останні 5 станів для відображення в таблиці
};

export type DirectChatStatus = {
  id: string;
  name: string;
  color: string;
  badgeKey: string;
  order: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type DirectCallStatus = {
  id: string;
  name: string;
  color: string;
  badgeKey: string;
  order: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type DirectClientChatStatusLog = {
  id: string;
  clientId: string;
  fromStatusId?: string | null;
  toStatusId?: string | null;
  changedAt: string;
  changedBy?: string | null;
  note?: string | null;
  fromStatus?: Pick<DirectChatStatus, 'id' | 'name' | 'color'> | null;
  toStatus?: Pick<DirectChatStatus, 'id' | 'name' | 'color'> | null;
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
