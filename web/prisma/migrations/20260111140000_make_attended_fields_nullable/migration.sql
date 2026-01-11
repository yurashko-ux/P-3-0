-- AlterTable
-- Змінюємо consultationAttended та paidServiceAttended на nullable Boolean
-- щоб відрізнити "не встановлено" (null) від "не з'явився" (false)

ALTER TABLE "direct_clients" 
  ALTER COLUMN "consultationAttended" DROP NOT NULL,
  ALTER COLUMN "consultationAttended" DROP DEFAULT,
  ALTER COLUMN "paidServiceAttended" DROP NOT NULL,
  ALTER COLUMN "paidServiceAttended" DROP DEFAULT;

-- Встановлюємо NULL для всіх записів, де значення було false (дефолтне)
-- Це дозволить відрізнити старі записи (де attendance не було встановлено)
-- від нових записів (де attendance = -1 явно встановлено)
UPDATE "direct_clients" 
  SET "consultationAttended" = NULL 
  WHERE "consultationAttended" = false;

UPDATE "direct_clients" 
  SET "paidServiceAttended" = NULL 
  WHERE "paidServiceAttended" = false;
