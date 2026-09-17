-- Журнал запису Kresco: довідник послуг і dual-write з Altegio

CREATE TABLE IF NOT EXISTS "salon_services" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "altegioServiceId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'other',
  "durationSec" INTEGER NOT NULL DEFAULT 3600,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "salon_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salon_services_altegioServiceId_key" ON "salon_services" ("altegioServiceId");
CREATE INDEX IF NOT EXISTS "salon_services_kind_idx" ON "salon_services" ("kind");
CREATE INDEX IF NOT EXISTS "salon_services_isActive_idx" ON "salon_services" ("isActive");
CREATE INDEX IF NOT EXISTS "salon_services_title_idx" ON "salon_services" ("title");

CREATE TABLE IF NOT EXISTS "salon_appointments" (
  "id" TEXT NOT NULL,
  "altegioRecordId" INTEGER,
  "altegioVisitId" INTEGER,
  "directClientId" TEXT,
  "altegioClientId" INTEGER,
  "masterId" TEXT,
  "altegioStaffId" INTEGER,
  "staffName" TEXT,
  "datetime" TIMESTAMP(3) NOT NULL,
  "seanceLength" INTEGER NOT NULL DEFAULT 3600,
  "attendance" INTEGER,
  "comment" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "syncError" TEXT,
  "source" TEXT NOT NULL DEFAULT 'altegio',
  "kyivDay" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "salon_appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "salon_appointments_altegioRecordId_key" ON "salon_appointments" ("altegioRecordId");
CREATE INDEX IF NOT EXISTS "salon_appointments_datetime_idx" ON "salon_appointments" ("datetime");
CREATE INDEX IF NOT EXISTS "salon_appointments_kyivDay_idx" ON "salon_appointments" ("kyivDay");
CREATE INDEX IF NOT EXISTS "salon_appointments_directClientId_idx" ON "salon_appointments" ("directClientId");
CREATE INDEX IF NOT EXISTS "salon_appointments_altegioClientId_idx" ON "salon_appointments" ("altegioClientId");
CREATE INDEX IF NOT EXISTS "salon_appointments_altegioStaffId_idx" ON "salon_appointments" ("altegioStaffId");
CREATE INDEX IF NOT EXISTS "salon_appointments_masterId_idx" ON "salon_appointments" ("masterId");
CREATE INDEX IF NOT EXISTS "salon_appointments_status_idx" ON "salon_appointments" ("status");
CREATE INDEX IF NOT EXISTS "salon_appointments_source_idx" ON "salon_appointments" ("source");

CREATE TABLE IF NOT EXISTS "salon_appointment_lines" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "serviceId" TEXT,
  "altegioServiceId" INTEGER,
  "title" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,

  CONSTRAINT "salon_appointment_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "salon_appointment_lines_appointmentId_idx" ON "salon_appointment_lines" ("appointmentId");
CREATE INDEX IF NOT EXISTS "salon_appointment_lines_serviceId_idx" ON "salon_appointment_lines" ("serviceId");

ALTER TABLE "salon_appointments" ADD CONSTRAINT "salon_appointments_directClientId_fkey" FOREIGN KEY ("directClientId") REFERENCES "direct_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salon_appointments" ADD CONSTRAINT "salon_appointments_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "direct_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salon_appointment_lines" ADD CONSTRAINT "salon_appointment_lines_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "salon_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salon_appointment_lines" ADD CONSTRAINT "salon_appointment_lines_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "salon_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
