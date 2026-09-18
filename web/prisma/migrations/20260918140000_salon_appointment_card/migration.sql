-- Учасники візиту, товари в записі, лог змін

CREATE TABLE IF NOT EXISTS "salon_appointment_participants" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "altegioStaffId" INTEGER NOT NULL,
    "staffName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'master',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "salon_appointment_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salon_appointment_participants_appointmentId_altegioStaffId_key"
  ON "salon_appointment_participants"("appointmentId", "altegioStaffId");
CREATE INDEX IF NOT EXISTS "salon_appointment_participants_appointmentId_idx"
  ON "salon_appointment_participants"("appointmentId");
CREATE INDEX IF NOT EXISTS "salon_appointment_participants_altegioStaffId_idx"
  ON "salon_appointment_participants"("altegioStaffId");

CREATE TABLE IF NOT EXISTS "salon_appointment_good_lines" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "altegioGoodId" INTEGER,
    CONSTRAINT "salon_appointment_good_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "salon_appointment_good_lines_appointmentId_idx"
  ON "salon_appointment_good_lines"("appointmentId");
CREATE INDEX IF NOT EXISTS "salon_appointment_good_lines_productId_idx"
  ON "salon_appointment_good_lines"("productId");
CREATE INDEX IF NOT EXISTS "salon_appointment_good_lines_storageId_idx"
  ON "salon_appointment_good_lines"("storageId");

CREATE TABLE IF NOT EXISTS "salon_appointment_change_logs" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    CONSTRAINT "salon_appointment_change_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "salon_appointment_change_logs_appointmentId_idx"
  ON "salon_appointment_change_logs"("appointmentId");
CREATE INDEX IF NOT EXISTS "salon_appointment_change_logs_at_idx"
  ON "salon_appointment_change_logs"("at");

DO $$ BEGIN
  ALTER TABLE "salon_appointment_participants"
    ADD CONSTRAINT "salon_appointment_participants_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "salon_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "salon_appointment_good_lines"
    ADD CONSTRAINT "salon_appointment_good_lines_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "salon_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "salon_appointment_good_lines"
    ADD CONSTRAINT "salon_appointment_good_lines_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "warehouse_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "salon_appointment_good_lines"
    ADD CONSTRAINT "salon_appointment_good_lines_storageId_fkey"
    FOREIGN KEY ("storageId") REFERENCES "warehouse_storages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "salon_appointment_change_logs"
    ADD CONSTRAINT "salon_appointment_change_logs_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "salon_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
