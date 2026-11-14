-- Бізнес-процеси: конструктор процесів і версії їхніх налаштувань.
CREATE TABLE IF NOT EXISTS "business_processes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'task_report',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_processes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "business_processes_isActive_idx" ON "business_processes"("isActive");

CREATE TABLE IF NOT EXISTS "business_process_versions" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_process_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "business_process_versions_processId_version_key" ON "business_process_versions"("processId", "version");

DO $$ BEGIN
    ALTER TABLE "business_process_versions" ADD CONSTRAINT "business_process_versions_processId_fkey"
        FOREIGN KEY ("processId") REFERENCES "business_processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
