-- Додаємо badgeKey до direct_chat_statuses (вибір бейджа з фіксованого набору)
ALTER TABLE "direct_chat_statuses"
  ADD COLUMN "badgeKey" TEXT NOT NULL DEFAULT 'badge_1';

