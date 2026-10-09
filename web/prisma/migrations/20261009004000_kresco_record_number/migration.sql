-- Номер запису, створеного в Kresco (немає id Altegio): 00001 і далі за часом.

ALTER TABLE "salon_appointments" ADD COLUMN "krescoRecordNumber" INTEGER;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS n
  FROM "salon_appointments"
  WHERE "altegioRecordId" IS NULL
)
UPDATE "salon_appointments" AS appointment
SET "krescoRecordNumber" = numbered.n
FROM numbered
WHERE appointment.id = numbered.id;

CREATE UNIQUE INDEX "salon_appointments_krescoRecordNumber_key" ON "salon_appointments"("krescoRecordNumber");
