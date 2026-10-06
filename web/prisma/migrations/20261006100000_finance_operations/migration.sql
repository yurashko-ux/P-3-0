-- Вхідний платіж Kresco зі зрізом ланцюжка на момент оплати.

CREATE TABLE IF NOT EXISTS "finance_operations" (
    "id" TEXT NOT NULL,
    "kyivDay" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "appointmentId" TEXT,
    "directClientId" TEXT,
    "clientName" TEXT,
    "leadAgency" TEXT,
    "consultationAt" TIMESTAMP(3),
    "consultationMasterId" TEXT,
    "consultationMasterName" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "finance_operation_lines" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "staffName" TEXT,
    "altegioStaffId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "finance_operation_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "finance_operations_kyivDay_idx" ON "finance_operations"("kyivDay");
CREATE INDEX IF NOT EXISTS "finance_operations_appointmentId_idx" ON "finance_operations"("appointmentId");
CREATE INDEX IF NOT EXISTS "finance_operations_directClientId_idx" ON "finance_operations"("directClientId");
CREATE INDEX IF NOT EXISTS "finance_operations_leadAgency_idx" ON "finance_operations"("leadAgency");
CREATE INDEX IF NOT EXISTS "finance_operations_method_idx" ON "finance_operations"("method");
CREATE INDEX IF NOT EXISTS "finance_operation_lines_operationId_idx" ON "finance_operation_lines"("operationId");
CREATE INDEX IF NOT EXISTS "finance_operation_lines_altegioStaffId_idx" ON "finance_operation_lines"("altegioStaffId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_appointmentId_fkey'
  ) THEN
    ALTER TABLE "finance_operations"
      ADD CONSTRAINT "finance_operations_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "salon_appointments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_operations_directClientId_fkey'
  ) THEN
    ALTER TABLE "finance_operations"
      ADD CONSTRAINT "finance_operations_directClientId_fkey"
      FOREIGN KEY ("directClientId") REFERENCES "direct_clients"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_operation_lines_operationId_fkey'
  ) THEN
    ALTER TABLE "finance_operation_lines"
      ADD CONSTRAINT "finance_operation_lines_operationId_fkey"
      FOREIGN KEY ("operationId") REFERENCES "finance_operations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
