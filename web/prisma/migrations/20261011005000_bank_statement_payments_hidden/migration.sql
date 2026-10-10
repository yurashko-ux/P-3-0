-- Чужі платежі ФОП Засадна можна сховати з Платежів, не стираючи рядок виписки.
ALTER TABLE "bank_statement_items" ADD COLUMN "paymentsHiddenAt" TIMESTAMP(3);
