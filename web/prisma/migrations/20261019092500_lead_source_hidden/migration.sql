-- Приховування джерела зі списку вибору (ручне призначення джерела для лідів без ad_id).
-- Не впливає на вже проставлені ліди і статистику.
ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;
