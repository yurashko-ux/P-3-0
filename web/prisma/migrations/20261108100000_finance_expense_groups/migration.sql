-- Групи розходу: створюються в Касі, статті розходу належать групі.
CREATE TABLE IF NOT EXISTS "finance_expense_groups" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_expense_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "finance_expense_groups_title_key" ON "finance_expense_groups"("title");

-- Групи фінзвіту, з яких починаємо
INSERT INTO "finance_expense_groups" ("id", "title", "sortOrder") VALUES
  ('grp_salary', 'Зарплата', 10),
  ('grp_rent', 'Оренда', 20),
  ('grp_marketing', 'Маркетинг', 30),
  ('grp_household', 'Господарські розходи', 40),
  ('grp_accounting', 'Бухгалтерія, податки', 50),
  ('grp_management', 'Управління та інвестиції', 60)
ON CONFLICT DO NOTHING;

ALTER TABLE "altegio_payment_purposes" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
