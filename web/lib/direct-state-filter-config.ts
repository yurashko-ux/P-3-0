// web/lib/direct-state-filter-config.ts
// Конфігурація опцій фільтра колонки «Стан» (похідні стани)

import type { DisplayedStateId } from './direct-displayed-state';

export type StateFilterOption = {
  id: DisplayedStateId;
  label: string;
  /** emoji для emoji-станів, або stateId для StateIcon */
  iconType: 'emoji' | 'state';
  emoji?: string;
};

export const STATE_FILTER_OPTIONS: StateFilterOption[] = [
  { id: 'paid-past', label: 'Букінгдата в минулому', iconType: 'emoji', emoji: '⚠️' },
  { id: 'sold', label: 'Продано', iconType: 'emoji', emoji: '🔥' },
  { id: 'rebook', label: 'Перезапис', iconType: 'emoji', emoji: '🔁' },
  { id: 'waiting', label: 'Очікування', iconType: 'emoji', emoji: '⏳' },
  { id: 'broken-heart', label: 'Не продали', iconType: 'emoji', emoji: '💔' },
  { id: 'consultation-past', label: 'Консультація з минулою датою', iconType: 'state' },
  { id: 'consultation-booked', label: 'Запис на консультацію', iconType: 'state' },
  { id: 'new-lead', label: 'Новий лід', iconType: 'state' },
  { id: 'message', label: 'Повідомлення / Лід', iconType: 'state' },
  { id: 'binotel-lead', label: 'Binotel-лід', iconType: 'state' },
];
